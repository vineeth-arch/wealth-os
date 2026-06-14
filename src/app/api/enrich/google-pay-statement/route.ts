import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServer } from "@/lib/supabase/server";
import {
  parseGooglePayStatement, matchGooglePayStatement, planGooglePayWrites,
  type GpayMatchableTxn, type GpayMatchableAccount, type GpayTxnState, type GpayWrite,
} from "@/lib/ingest/parsers/google-pay-statement";
import { resolveGpayCategory } from "@/lib/ingest/google-pay-category-map";
import { categoryIndex, guardCategory } from "@/lib/server/rules";
import type { GooglePayStatementEntry } from "@/lib/ingest/types";

export const runtime = "nodejs";

/**
 * Enrich already-committed bank/credit_card transactions from a Google Pay official "Transaction
 * statement" (.md). ENRICHMENT ONLY — never inserts, never touches `description_raw`/amount/date. A
 * matched entry layers its merchant onto `merchant`, appends one replaceable `GPay: …` notes line, and
 * (only over an Uncategorized-Review row) applies a light mapped category. Account routing by funding
 * last-4 + UPI-ID tiebreak sharpen precision. Unmatched entries are reported read-only, never inserted.
 *
 * `mode=preview` returns the match report (incl. reconciliation deltas + per-bank breakdown) WITHOUT
 * writing; `mode=apply` performs them. Deterministic → preview == apply. Idempotent across re-uploads.
 */
export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const form = await request.formData();
  const file = form.get("file");
  const mode = form.get("mode") === "apply" ? "apply" : "preview";
  if (!(file instanceof File)) return NextResponse.json({ error: "file is required" }, { status: 400 });

  let parsed: ReturnType<typeof parseGooglePayStatement>;
  try {
    parsed = parseGooglePayStatement(await file.text());
  } catch (e) {
    return NextResponse.json({ error: `parse failed: ${(e as Error).message}` }, { status: 422 });
  }
  const entries = parsed.entries;
  if (entries.length === 0) return NextResponse.json({ error: "no Google Pay statement rows parsed" }, { status: 422 });

  // Enrichable accounts: bank + credit_card, with the last-4 of account_number for routing.
  const { data: acctRows, error: acctErr } = await supabase.from("accounts")
    .select("id,kind,account_number").eq("user_id", user.id);
  if (acctErr) return NextResponse.json({ error: `accounts: ${acctErr.message}` }, { status: 500 });
  const accounts: GpayMatchableAccount[] = (acctRows ?? [])
    .filter((a) => a.kind === "bank" || a.kind === "credit_card")
    .map((a) => ({ id: a.id as string, kind: a.kind as string, last4: ((a.account_number as string | null) ?? "").replace(/\D/g, "").slice(-4) }));
  const enrichable = new Set(accounts.map((a) => a.id));
  if (enrichable.size === 0) {
    return NextResponse.json({
      mode, parsed: entries.length, matched: 0, ambiguous: 0, unmatched: entries.length, applied: 0,
      reconciliation: parsed.reconciliation, byBank: {}, transferCount: 0, preview: [],
      unmatchedPreview: previewUnmatched(entries),
      note: "No bank or credit-card account is imported yet — enrichment has nothing to match against.",
    });
  }

  // Committed txns on enrichable accounts (paginate past 1000), with current state.
  const matchable: GpayMatchableTxn[] = [];
  const txnStates = new Map<string, GpayTxnState>();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.from("transactions")
      .select("id,account_id,txn_date,amount_paise,ref_no,upi_ref,description_raw,merchant,notes,category_source,enrichment_ref")
      .eq("user_id", user.id).order("id").range(from, from + PAGE - 1);
    if (error) return NextResponse.json({ error: `transactions: ${error.message}` }, { status: 500 });
    const page = data ?? [];
    for (const t of page) {
      const accountId = t.account_id as string;
      if (!enrichable.has(accountId)) continue;
      const id = t.id as string;
      const refText = `${(t.ref_no as string | null) ?? ""} ${(t.upi_ref as string | null) ?? ""} ${(t.description_raw as string) ?? ""}`;
      matchable.push({ id, accountId, txnDate: t.txn_date as string, amountPaise: t.amount_paise as number, refText });
      txnStates.set(id, {
        id,
        merchant: (t.merchant as string | null) ?? null,
        notes: (t.notes as string | null) ?? null,
        categorySource: (t.category_source as string) ?? "default",
        enrichmentRef: (t.enrichment_ref as string | null) ?? null,
      });
    }
    if (page.length < PAGE) break;
  }

  const { matched, ambiguous, unmatched, byBank } = matchGooglePayStatement(entries, matchable, accounts);
  const entriesByRef = new Map(entries.map((e) => [e.rowRef, e]));

  const catIdx = await categoryIndex(supabase, user.id);
  const resolveCategory = (name: string): { id: string } | null => {
    const g = guardCategory(name, catIdx);
    return "error" in g ? null : { id: g.id };
  };

  const plan = planGooglePayWrites(matched, entriesByRef, txnStates, resolveCategory);
  const transferCount = matched.filter((m) => m.isTransfer).length;

  const preview = plan.slice(0, 300).map((w) => {
    const e = entriesByRef.get(w.upiTxnId)!;
    const m = matched.find((x) => x.upiTxnId === w.upiTxnId);
    const target = resolveGpayCategory(e).categoryName;
    return {
      txnId: w.id,
      merchant: w.merchant ?? (txnStates.get(w.id)?.merchant ?? ""),
      mmLabel: e.merchantText,
      bank: `${e.fundingBankName} ${e.fundingBankLast4}`,
      confidence: m?.confidence ?? "",
      categoryApplied: w.categoryId ? (target ?? "") : "",
      categorySuggested: w.suggestedCategoryName ?? "",
      changed: w.changed,
    };
  });

  const result = {
    mode, parsed: entries.length, matched: matched.length, ambiguous: ambiguous.length,
    unmatched: unmatched.length, applied: 0, transferCount,
    reconciliation: parsed.reconciliation, byBank, preview,
    unmatchedPreview: previewUnmatched(unmatched),
  };

  if (mode === "preview") return NextResponse.json(result);

  // mode === apply: write only the changed rows (each row's notes/merchant/category differ → per-row).
  let applied = 0;
  for (const w of plan) {
    if (!w.changed) continue;
    const { error } = await supabase.from("transactions").update(buildUpdate(w)).eq("id", w.id).eq("user_id", user.id);
    if (error) return NextResponse.json({ error: `apply ${w.id}: ${error.message}` }, { status: 500 });
    applied++;
  }
  return NextResponse.json({ ...result, applied });
}

function buildUpdate(w: GpayWrite): Record<string, unknown> {
  const u: Record<string, unknown> = { notes: w.notes, enrichment_source: "google_pay_statement", enrichment_ref: w.upiTxnId };
  if (w.merchant !== undefined) u.merchant = w.merchant;
  if (w.categoryId) { u.category_id = w.categoryId; u.category_source = "google_pay_statement"; }
  return u;
}

/** Read-only preview of entries that matched nothing — likely an un-imported funding account / timing gap. */
function previewUnmatched(entries: GooglePayStatementEntry[]) {
  return entries.slice(0, 100).map((e) => ({
    txnDate: e.txnDate, amountPaise: e.amountPaise,
    party: e.party || "(unknown payee)", bank: `${e.fundingBankName} ${e.fundingBankLast4}`,
  }));
}
