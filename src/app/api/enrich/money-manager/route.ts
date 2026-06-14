import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServer } from "@/lib/supabase/server";
import { parseMoneyManager } from "@/lib/ingest/parsers/money-manager";
import {
  matchMoneyManager, planMoneyManagerWrites,
  type MmTxnState, type MmWrite,
} from "@/lib/ingest/money-manager";
import { resolveMmCategory } from "@/lib/ingest/money-manager-category-map";
import { categoryIndex, guardCategory } from "@/lib/server/rules";
import type { MatchableTxn } from "@/lib/ingest/enrich";
import type { MoneyManagerEntry } from "@/lib/ingest/types";

export const runtime = "nodejs";

/**
 * Enrich already-committed bank/credit_card transactions from a Money Manager (.xlsx) export.
 * ENRICHMENT ONLY — never inserts a transaction, never touches `description_raw`/amount/date. A matched
 * MM entry layers its richer merchant text onto `merchant`, appends one replaceable `MM: …` notes line,
 * and (only over an Uncategorized-Review row) applies the mapped Halan category. Unmatched MM entries
 * are reported read-only, never inserted (that would double-count a separate ledger).
 *
 * `mode=preview` returns the match report and the exact changes WITHOUT writing; `mode=apply` performs
 * them. Matching is deterministic, so preview == apply. Idempotent across re-uploads (mm_row_ref).
 */
export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const form = await request.formData();
  const file = form.get("file");
  const mode = form.get("mode") === "apply" ? "apply" : "preview";
  if (!(file instanceof File)) return NextResponse.json({ error: "file is required" }, { status: 400 });

  let entries: MoneyManagerEntry[];
  try {
    entries = parseMoneyManager(Buffer.from(await file.arrayBuffer())).entries;
  } catch (e) {
    return NextResponse.json({ error: `parse failed: ${(e as Error).message}` }, { status: 422 });
  }
  if (entries.length === 0) return NextResponse.json({ error: "no Money Manager rows parsed" }, { status: 422 });

  // Accounts we may enrich: bank + credit_card only (ignore broker / asset_snapshot).
  const { data: acctRows, error: acctErr } = await supabase.from("accounts")
    .select("id,kind").eq("user_id", user.id);
  if (acctErr) return NextResponse.json({ error: `accounts: ${acctErr.message}` }, { status: 500 });
  const enrichable = new Set((acctRows ?? []).filter((a) => a.kind === "bank" || a.kind === "credit_card").map((a) => a.id as string));
  if (enrichable.size === 0) {
    return NextResponse.json({
      mode, parsed: entries.length, matched: 0, ambiguous: 0, unmatched: entries.length, applied: 0,
      sipFlagged: 0, preview: [], unmatchedPreview: previewUnmatched(entries),
      note: "No bank or credit-card account is imported yet — enrichment has nothing to match against.",
    });
  }

  // Committed txns on enrichable accounts (paginate past Supabase's 1000-row cap), with current state.
  const matchable: MatchableTxn[] = [];
  const txnStates = new Map<string, MmTxnState>();
  const descById = new Map<string, string>();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.from("transactions")
      .select("id,account_id,txn_date,amount_paise,description_raw,merchant,notes,category_source,mm_row_ref")
      .eq("user_id", user.id).order("id").range(from, from + PAGE - 1);
    if (error) return NextResponse.json({ error: `transactions: ${error.message}` }, { status: 500 });
    const page = data ?? [];
    for (const t of page) {
      const accountId = t.account_id as string;
      if (!enrichable.has(accountId)) continue;
      const id = t.id as string;
      matchable.push({ id, accountId, txnDate: t.txn_date as string, amountPaise: t.amount_paise as number });
      txnStates.set(id, {
        id,
        merchant: (t.merchant as string | null) ?? null,
        notes: (t.notes as string | null) ?? null,
        categorySource: (t.category_source as string) ?? "default",
        mmRowRef: (t.mm_row_ref as string | null) ?? null,
      });
      descById.set(id, (t.description_raw as string) ?? "");
    }
    if (page.length < PAGE) break;
  }

  const { matched, ambiguous, unmatchedMM } = matchMoneyManager(matchable, entries);
  const entriesByRef = new Map(entries.map((e) => [e.rowRef, e]));

  // Resolve target category NAMES to ids, refusing Leakage(14)/Review(15) — same guard as rules/AI.
  const catIdx = await categoryIndex(supabase, user.id);
  const resolveCategory = (name: string): { id: string } | null => {
    const g = guardCategory(name, catIdx);
    return "error" in g ? null : { id: g.id };
  };

  const plan = planMoneyManagerWrites(matched, entriesByRef, txnStates, resolveCategory);

  // SIP double-count flag: matched MM entries that map to the SIP invest leaf (verify against a broker import).
  const sipFlagged = matched.filter((m) => {
    const e = entriesByRef.get(m.mmRowRef);
    return e && resolveMmCategory(e).categoryName === "SIP Mutual Fund";
  }).length;

  const preview = plan.slice(0, 300).map((w) => {
    const e = entriesByRef.get(w.mmRowRef)!;
    const target = resolveMmCategory(e).categoryName;
    return {
      txnId: w.id,
      description: descById.get(w.id) ?? "",
      currentMerchant: txnStates.get(w.id)?.merchant ?? "",
      newMerchant: w.merchant ?? (txnStates.get(w.id)?.merchant ?? ""),
      mmLabel: e.merchantText,
      categoryApplied: w.categoryId ? (target ?? "") : "",
      categorySuggested: w.suggestedCategoryName ?? "",
      changed: w.changed,
    };
  });

  if (mode === "preview") {
    return NextResponse.json({
      mode, parsed: entries.length, matched: matched.length, ambiguous: ambiguous.length,
      unmatched: unmatchedMM.length, applied: 0, sipFlagged, preview,
      unmatchedPreview: previewUnmatched(unmatchedMM),
    });
  }

  // mode === apply: write only the changed rows. Per-row (each row's notes/merchant/category differ).
  let applied = 0;
  for (const w of plan) {
    if (!w.changed) continue;
    const update = buildUpdate(w);
    const { error } = await supabase.from("transactions").update(update).eq("id", w.id).eq("user_id", user.id);
    if (error) return NextResponse.json({ error: `apply ${w.id}: ${error.message}` }, { status: 500 });
    applied++;
  }

  return NextResponse.json({
    mode, parsed: entries.length, matched: matched.length, ambiguous: ambiguous.length,
    unmatched: unmatchedMM.length, applied, sipFlagged, preview,
    unmatchedPreview: previewUnmatched(unmatchedMM),
  });
}

function buildUpdate(w: MmWrite): Record<string, unknown> {
  const u: Record<string, unknown> = { notes: w.notes, enrichment_source: "money_manager", mm_row_ref: w.mmRowRef };
  if (w.merchant !== undefined) u.merchant = w.merchant;
  if (w.categoryId) { u.category_id = w.categoryId; u.category_source = "money_manager"; }
  return u;
}

/** Read-only preview of MM entries that matched nothing — likely cash / timing gap / un-imported account. */
function previewUnmatched(entries: MoneyManagerEntry[]) {
  return entries.slice(0, 100).map((e) => ({
    loggedAt: e.loggedAt,
    amountPaise: e.amountPaise,
    category: e.categoryRaw,
    label: e.merchantText,
  }));
}
