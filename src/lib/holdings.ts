/** Holdings auto-mapping: resolve instrument identity → source codes before asking the human. Pure. */

export type MappableAssetClass = "equity" | "mutual_fund";

export interface HoldingMapping {
  isin: string;
  amfiSchemeCode: string | null;
  yahooSymbol: string | null;
}

/** Zerodha trading symbol → Yahoo symbol. NSE default; an explicit .NS/.BO suffix is preserved. */
export function deriveYahooSymbol(symbol: string): string | null {
  const s = symbol.trim().toUpperCase();
  if (!s) return null;
  if (/\.(NS|BO)$/.test(s)) return s;
  return `${s}.NS`;
}

/**
 * Auto-map one holding. MF → AMFI scheme code by ISIN (from the shared NAVAll ISIN map); equity (and
 * demat SGB, which trades like equity) → Yahoo symbol from the trading symbol. Anything unresolved
 * comes back null for the human to confirm on first sight.
 */
export function autoMapHolding(
  row: { isin: string; symbol: string; assetClass: MappableAssetClass },
  isinToScheme: Map<string, { schemeCode: string }>,
): HoldingMapping {
  if (row.assetClass === "mutual_fund") {
    return { isin: row.isin, amfiSchemeCode: isinToScheme.get(row.isin)?.schemeCode ?? null, yahooSymbol: null };
  }
  return { isin: row.isin, amfiSchemeCode: null, yahooSymbol: deriveYahooSymbol(row.symbol) };
}

/** Does this mapping still need a human? (MF without a scheme code, or equity without a symbol.) */
export function needsConfirmation(assetClass: MappableAssetClass, m: HoldingMapping): boolean {
  return assetClass === "mutual_fund" ? m.amfiSchemeCode === null : m.yahooSymbol === null;
}
