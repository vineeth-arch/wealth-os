/** Price layer types. Money is integer paise; NAV/price rupees are rounded to paise at the boundary. */

export type PriceSourceId = "mfapi" | "mfdata" | "amfi" | "yahoo" | "manual_ibja";
export type PriceSourceKind = "mf_nav" | "equity" | "gold" | "manual";
export type AssetClass = "equity" | "mutual_fund" | "sgb" | "gold" | "fd" | "bond" | "cash";

/** Identity is ISIN. Mapping to a source-specific code is human-confirmed on first sight. */
export interface InstrumentRef {
  isin: string;
  assetClass: AssetClass;
  amfiSchemeCode?: string | null; // mutual funds
  yahooSymbol?: string | null;    // equities / demat SGBs (e.g. RELIANCE.NS)
}

export interface PriceQuote {
  pricePaise: number; // integer paise
  priceDate: string;  // ISO YYYY-MM-DD
}

export interface PriceSource {
  id: PriceSourceId;
  kind: PriceSourceKind;
  /** Returns the latest quote, or null if this source can't price the instrument. */
  fetchPrice(inst: InstrumentRef): Promise<PriceQuote | null>;
}

/** Rupees (any decimal precision) → integer paise. Throws on non-finite input — no silent coercion. */
export function rupeesToPaise(rupees: number): number {
  if (!Number.isFinite(rupees)) throw new Error(`non-finite rupee value: ${rupees}`);
  return Math.round(rupees * 100);
}

/**
 * Source priority by asset class (pure — gate-tested, imports no adapter so it never pulls
 * yahoo-finance2 into the gate). First source that returns a quote wins in refreshPrices.
 */
export function selectSourceIds(assetClass: AssetClass): PriceSourceId[] {
  switch (assetClass) {
    case "mutual_fund": return ["mfapi", "amfi", "mfdata"];
    case "equity":
    case "sgb": return ["yahoo"];
    case "gold": return ["manual_ibja"];
    default: return [];
  }
}
