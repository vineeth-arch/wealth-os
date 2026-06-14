import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServer } from "@/lib/supabase/server";
import type { UpstoxTaxReport } from "@/lib/ingest/types";

export const runtime = "nodejs";

interface CommitTaxBody {
  accountId: string;
  report: UpstoxTaxReport;
}

/**
 * Persist an Upstox realized-gains record (per-segment summary + closed lots) for a financial year.
 * RLS-owned user data. Upserts are idempotent on (user, account, FY, segment) and on the lot tuple,
 * so re-committing the same report inserts nothing new. This is the input the capital-gains/tax view reads.
 */
export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as CommitTaxBody | null;
  if (!body?.accountId || !body.report || !Array.isArray(body.report.segments)) {
    return NextResponse.json({ error: "accountId and report.segments are required" }, { status: 400 });
  }
  const fy = body.report.financialYear;
  if (!fy) return NextResponse.json({ error: "report.financialYear is missing" }, { status: 400 });

  const { data: account } = await supabase.from("accounts")
    .select("id,institution").eq("id", body.accountId).single();
  if (!account) return NextResponse.json({ error: "account not found" }, { status: 404 });
  if (account.institution !== "UPSTOX") {
    return NextResponse.json({ error: "tax report commit expects an Upstox account" }, { status: 400 });
  }

  const segmentRows = body.report.segments.map((s) => ({
    user_id: user.id, account_id: body.accountId, financial_year: fy, segment: s.segment,
    gross_pl_paise: s.grossPlPaise, net_pl_paise: s.netPlPaise, charges_paise: s.chargesPaise,
    short_term_paise: s.shortTermPaise, long_term_paise: s.longTermPaise, speculation_paise: s.speculationPaise,
  }));
  const { error: segErr } = await supabase.from("realized_gain_segments")
    .upsert(segmentRows, { onConflict: "user_id,account_id,financial_year,segment" });
  if (segErr) return NextResponse.json({ error: `realized_gain_segments: ${segErr.message}` }, { status: 500 });

  const lotRows = body.report.segments.flatMap((s) => s.lots.map((l) => ({
    user_id: user.id, account_id: body.accountId, financial_year: fy, segment: l.segment,
    scrip: l.scrip, isin: l.isin, qty: l.qty,
    buy_date: l.buyDate, buy_amt_paise: l.buyAmtPaise, sell_date: l.sellDate, sell_amt_paise: l.sellAmtPaise,
    total_pl_paise: l.totalPlPaise, short_term_paise: l.shortTermPaise, long_term_paise: l.longTermPaise,
  })));
  let lotsSaved = 0;
  if (lotRows.length > 0) {
    const { data: inserted, error: lotErr } = await supabase.from("realized_gain_lots")
      .upsert(lotRows, { onConflict: "user_id,account_id,financial_year,segment,isin,buy_date,sell_date,qty" })
      .select("id");
    if (lotErr) return NextResponse.json({ error: `realized_gain_lots: ${lotErr.message}` }, { status: 500 });
    lotsSaved = inserted?.length ?? 0;
  }

  return NextResponse.json({ financialYear: fy, segments: segmentRows.length, lots: lotRows.length, lotsInserted: lotsSaved });
}
