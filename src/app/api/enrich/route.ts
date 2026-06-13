import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServer } from "@/lib/supabase/server";
import { parseBhimUpi, parseGooglePay } from "@/lib/ingest/parsers/market";
import { matchEnrichment, type MatchableTxn, type MatchableAccount } from "@/lib/ingest/enrich";
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
  const txns: MatchableTxn[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.from("transactions")
      .select("id,account_id,txn_date,amount_paise")
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

  // Bulk-write: the merchant value differs per id, so group by value → one update per distinct name.
  const byMerchant = new Map<string, string[]>();
  for (const u of updates) {
    const arr = byMerchant.get(u.merchant);
    if (arr) arr.push(u.id); else byMerchant.set(u.merchant, [u.id]);
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
