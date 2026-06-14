import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServer } from "@/lib/supabase/server";
import { createSupabaseService } from "@/lib/supabase/service";
import { fetchNavAllText, parseNavAllForIsinMap } from "@/lib/prices/amfi";
import { autoMapHolding, needsConfirmation, type MappableAssetClass } from "@/lib/holdings";
import type { HoldingRow } from "@/lib/ingest/types";

export const runtime = "nodejs";

interface CommitHoldingsBody {
  accountId: string;
  asOf?: string | null;
  rows: HoldingRow[];
}

/**
 * Persist a holdings snapshot. Dual client by design: `instruments` is reference data (service-role
 * write per RLS) so it goes through the service client; `holdings_snapshots` is user-owned so it goes
 * through the RLS user client. Mappings auto-resolve (MF→AMFI scheme code, equity→Yahoo symbol) and a
 * previously human-confirmed mapping is never overwritten with a null. No `imports` row (txn-shaped).
 */
export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as CommitHoldingsBody | null;
  if (!body?.accountId || !Array.isArray(body.rows) || body.rows.length === 0) {
    return NextResponse.json({ error: "accountId and a non-empty rows[] are required" }, { status: 400 });
  }

  const { data: account } = await supabase.from("accounts")
    .select("id,institution").eq("id", body.accountId).single();
  if (!account) return NextResponse.json({ error: "account not found" }, { status: 404 });
  if (!["ZERODHA", "UPSTOX"].includes(account.institution)) {
    return NextResponse.json({ error: "holdings commit expects a broker account (Zerodha/Upstox)" }, { status: 400 });
  }

  const asOf = body.asOf || new Date().toISOString().slice(0, 10);
  const svc = createSupabaseService();

  // Auto-map MF ISINs from the shared AMFI file. Degrade gracefully if AMFI is unreachable
  // (e.g. blocked network) — unmapped rows simply fall to the human-confirm step.
  let isinMap = new Map<string, { schemeCode: string }>();
  try {
    isinMap = parseNavAllForIsinMap(await fetchNavAllText());
  } catch { /* leave empty; rows surface as unmapped */ }

  // Preserve any human-confirmed mapping already on instruments.
  const isins = body.rows.map((r) => r.isin);
  const { data: existing } = await svc.from("instruments")
    .select("isin,amfi_scheme_code,yahoo_symbol").in("isin", isins);
  const existingByIsin = new Map((existing ?? []).map((e) => [e.isin as string, e]));

  const unmapped: Array<{ isin: string; symbol: string; assetClass: string }> = [];
  const instrumentRows = body.rows.map((r) => {
    const ex = existingByIsin.get(r.isin);
    const auto = autoMapHolding({ isin: r.isin, symbol: r.symbol, assetClass: r.assetClass as MappableAssetClass }, isinMap);
    const amfi_scheme_code = (ex?.amfi_scheme_code as string | null) ?? auto.amfiSchemeCode;
    const yahoo_symbol = (ex?.yahoo_symbol as string | null) ?? auto.yahooSymbol;
    if (needsConfirmation(r.assetClass as MappableAssetClass, { isin: r.isin, amfiSchemeCode: amfi_scheme_code, yahooSymbol: yahoo_symbol })) {
      unmapped.push({ isin: r.isin, symbol: r.symbol, assetClass: r.assetClass });
    }
    return {
      isin: r.isin, name: r.symbol, asset_class: r.assetClass, symbol: r.symbol,
      sector_or_type: r.sectorOrType || null, amfi_scheme_code, yahoo_symbol,
    };
  });

  const { error: instErr } = await svc.from("instruments").upsert(instrumentRows, { onConflict: "isin" });
  if (instErr) return NextResponse.json({ error: `instruments: ${instErr.message}` }, { status: 500 });

  const snapshotRows = body.rows.map((r) => ({
    user_id: user.id, account_id: body.accountId, import_id: null,
    as_of: asOf, isin: r.isin, qty: r.qty,
    avg_price_paise: r.avgPricePaise, last_price_paise: r.lastPricePaise,
  }));
  const { data: inserted, error: snapErr } = await supabase.from("holdings_snapshots")
    .upsert(snapshotRows, { onConflict: "account_id,as_of,isin" }).select("isin");
  if (snapErr) return NextResponse.json({ error: `holdings_snapshots: ${snapErr.message}` }, { status: 500 });

  return NextResponse.json({ asOf, upserted: inserted?.length ?? 0, instruments: instrumentRows.length, unmapped });
}
