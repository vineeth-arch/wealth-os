import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServer } from "@/lib/supabase/server";
import {
  parseGooglePayStatement, matchGooglePayStatement, planGooglePayWrites,
  type GpayMatchableTxn, type GpayMatchableAccount, type GpayTxnState, type GpayWrite,
} from "@/lib/ingest/parsers/google-pay-statement";
import { resolveGpayCategory } from "@/lib/ingest/google-pay-category-map";
import { categoryIndex, guardCategory } from "@/lib/server/rules";
import type { GooglePayStatementEntry } from "@/lib/ingest/types";
import { fetchAllRows } from "@/lib/supabase/paginate";
import { runBounded } from "@/lib/concurrency";

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
  let rawTxns: Array<{ id: string; account_id: string; txn_date: string; amount_paise: number; ref_no: string | null; upi_ref: string | null; description_raw: string; merchant: string | null; notes: string | null; category_source: string | null; enrichment_ref: string | null }>;
  try {
    rawTxns = await fetchAllRows((from, to) =>
      supabase.from("transactions")
        .select("id,account_id,txn_date,amount_paise,ref_no,upi_ref,description_raw,merchant,notes,category_source,enrichment_ref")
        .eq("user_id", user.id).order("id").range(from, to));
  } catch (e) {
    return NextResponse.json({ error: `transactions: ${(e as Error).message}` }, { status: 500 });
  }
  for (const t of rawTxns) {
    const accountId = t.account_id;
    if (!enrichable.has(accountId)) continue;
    const id = t.id;
    const refText = `${t.ref_no ?? ""} ${t.upi_ref ?? ""} ${t.description_raw ?? ""}`;
    matchable.push({ id, accountId, txnDate: t.txn_date, amountPaise: t.amount_paise, refText });
    txnStates.set(id, {
      id,
      merchant: t.merchant ?? null,
      notes: t.notes ?? null,
      categorySource: t.category_source ?? "default",
      enrichmentRef: t.enrichment_ref ?? null,
    });
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

  // mode === apply: write only the changed rows (each row's notes/merchant/category differ, so a
  // value-grouped .in() update doesn't apply here); bounded concurrency instead of a serial loop.
  const changed = plan.filter((w) => w.changed);
  const { completed: applied, error: applyError } = await runBounded(changed, 10, (w) =>
    supabase.from("transactions").update(buildUpdate(w)).eq("id", w.id).eq("user_id", user.id)
      .then((r) => ({ error: r.error?.message ?? null })));
  if (applyError) return NextResponse.json({ error: `apply: ${applyError}`, ...result, applied }, { status: 500 });
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
