import type { SupabaseClient } from "@supabase/supabase-js";
import { selectSourceIds, type InstrumentRef, type PriceSource, type PriceSourceId } from "./types.js";
import { mfapiSource } from "./mfapi.js";
import { mfdataSource } from "./mfdata.js";
import { amfiSource } from "./amfi.js";
import { yahooSource } from "./yahoo.js";
import { manualSource } from "./manual.js";

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
  const { data, error } = await svc
    .from("instruments")
    .select("isin,asset_class,amfi_scheme_code,yahoo_symbol");
  if (error) return { attempted: 0, fetched: 0, failed: 0, errors: [`instruments: ${error.message}`] };

  const result: RefreshResult = { attempted: 0, fetched: 0, failed: 0, errors: [] };

  for (const row of data ?? []) {
    const inst: InstrumentRef = {
      isin: row.isin as string,
      assetClass: row.asset_class as InstrumentRef["assetClass"],
      amfiSchemeCode: row.amfi_scheme_code as string | null,
      yahooSymbol: row.yahoo_symbol as string | null,
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
