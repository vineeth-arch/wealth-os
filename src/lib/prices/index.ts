import type { SupabaseClient } from "@supabase/supabase-js";
import { selectSourceIds, type InstrumentRef, type PriceSource, type PriceSourceId } from "./types.js";
import { mfapiSource } from "./mfapi.js";
import { mfdataSource } from "./mfdata.js";
import { amfiSource } from "./amfi.js";
import { yahooSource } from "./yahoo.js";
import { manualSource } from "./manual.js";
import { fetchAllRows } from "../supabase/paginate.js";

/** Adapter registry. NOTE: importing this module pulls in yahoo-finance2 — never import it from the gate. */
export const SOURCES: Record<PriceSourceId, PriceSource> = {
  mfapi: mfapiSource,
  mfdata: mfdataSource,
  amfi: amfiSource,
  yahoo: yahooSource,
  manual_ibja: manualSource,
};

export interface RefreshResult {
  attempted: number;
  fetched: number;
  failed: number;
  errors: string[];
}

/**
 * Fetch and persist latest prices for every instrument with a confirmed source mapping.
 * Reference-table writes (`prices`) require the service-role client. First source that returns a
 * quote wins; a source throwing is recorded and the next is tried. Manual gold is skipped (no fetch).
 */
export async function refreshPrices(svc: SupabaseClient): Promise<RefreshResult> {
  // Reference table — can exceed Supabase's 1000-row cap as more instruments get imported.
  let data: Array<{ isin: string; asset_class: string; amfi_scheme_code: string | null; yahoo_symbol: string | null }>;
  try {
    data = await fetchAllRows((from, to) =>
      svc.from("instruments").select("isin,asset_class,amfi_scheme_code,yahoo_symbol").order("isin").range(from, to));
  } catch (e) {
    return { attempted: 0, fetched: 0, failed: 0, errors: [`instruments: ${(e as Error).message}`] };
  }

  const result: RefreshResult = { attempted: 0, fetched: 0, failed: 0, errors: [] };

  for (const row of data) {
    const inst: InstrumentRef = {
      isin: row.isin,
      assetClass: row.asset_class as InstrumentRef["assetClass"],
      amfiSchemeCode: row.amfi_scheme_code,
      yahooSymbol: row.yahoo_symbol,
    };
    const ids = selectSourceIds(inst.assetClass);
    if (ids.length === 0 || ids.every((id) => SOURCES[id].kind === "manual")) continue;
    result.attempted++;

    let quote = null;
    for (const id of ids) {
      try {
        quote = await SOURCES[id].fetchPrice(inst);
        if (quote) {
          const { error: upErr } = await svc.from("prices").upsert(
            { isin: inst.isin, price_date: quote.priceDate, price_paise: quote.pricePaise, source: id },
            { onConflict: "isin,price_date,source" },
          );
          if (upErr) { result.errors.push(`${inst.isin} upsert: ${upErr.message}`); quote = null; }
          break;
        }
      } catch (e) {
        result.errors.push(`${inst.isin} via ${id}: ${(e as Error).message}`);
      }
    }
    if (quote) result.fetched++; else result.failed++;
  }
  return result;
}
