import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServer } from "@/lib/supabase/server";
import { parseBhimUpi, parseGooglePay } from "@/lib/ingest/parsers/market";
import { matchEnrichment, mergeMerchant, type MatchableTxn, type MatchableAccount } from "@/lib/ingest/enrich";
import type { UpiEnrichmentRow } from "@/lib/ingest/types";

export const runtime = "nodejs";

/**
 * Enrich committed transactions with the real counterpart name from a UPI-app export.
 * ENRICHMENT ONLY — never inserts a transaction or touches an amount; writes the `merchant` column
 * on transactions the matcher pairs UNAMBIGUOUSLY (same date + |amount| + sign). The same UPI money
 * already lives in the bank statement, so adding rows would double-count.
 */
export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const form = await request.formData();
  const file = form.get("file");
  const source = form.get("source");
  if (!(file instanceof File) || typeof source !== "string") {
    return NextResponse.json({ error: "file and source are required" }, { status: 400 });
  }

  const text = await file.text();
  let rows: UpiEnrichmentRow[];
  try {
    if (source === "bhim") {
      rows = parseBhimUpi(text).rows;
    } else if (source === "gpay") {
      rows = parseGooglePay(text).rows;
    } else {
      return NextResponse.json({ error: `unsupported source: ${source}` }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ error: `parse failed: ${(e as Error).message}` }, { status: 422 });
  }

  // Load every committed transaction (paginate past Supabase's 1000-row cap) + accounts for resolution.
  // Keep each txn's CURRENT merchant too, so enrichment LAYERS onto it instead of overwriting a prior source.
  const txns: MatchableTxn[] = [];
  const currentMerchant = new Map<string, string | null>();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.from("transactions")
      .select("id,account_id,txn_date,amount_paise,merchant")
      .eq("user_id", user.id)
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) return NextResponse.json({ error: `transactions: ${error.message}` }, { status: 500 });
    const page = data ?? [];
    for (const t of page) {
      txns.push({
        id: t.id as string,
        accountId: t.account_id as string,
        txnDate: t.txn_date as string,
        amountPaise: t.amount_paise as number,
      });
      currentMerchant.set(t.id as string, (t.merchant as string | null) ?? null);
    }
    if (page.length < PAGE) break;
  }

  const { data: acctRows } = await supabase.from("accounts")
    .select("id,name,institution,kind").eq("user_id", user.id);
  const accounts: MatchableAccount[] = (acctRows ?? []).map((a) => ({
    id: a.id as string,
    name: a.name as string,
    institution: a.institution as string,
    kind: a.kind as string,
  }));

  const { updates, matched, ambiguous, unmatched } = matchEnrichment(rows, txns, accounts);

  // ADDITIVE write: layer the matched name onto each txn's existing merchant so BHIM→GPay (or a re-run)
  // never wipes prior context. The merged value differs per id, so group by resulting value → one update
  // per distinct value; skip rows whose value is already current (no-op write).
  const byMerchant = new Map<string, string[]>();
  for (const u of updates) {
    const cur = currentMerchant.get(u.id) ?? null;
    const merged = mergeMerchant(cur, u.merchant);
    if (merged === (cur ?? "")) continue;
    const arr = byMerchant.get(merged);
    if (arr) arr.push(u.id); else byMerchant.set(merged, [u.id]);
  }
  for (const [merchant, ids] of byMerchant) {
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      const { error } = await supabase.from("transactions")
        .update({ merchant }).in("id", chunk).eq("user_id", user.id);
      if (error) return NextResponse.json({ error: `enrich: ${error.message}` }, { status: 500 });
    }
  }

  return NextResponse.json({ parsed: rows.length, matched, ambiguous, unmatched });
}
