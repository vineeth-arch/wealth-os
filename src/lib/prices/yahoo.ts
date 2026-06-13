import yahooFinance from "yahoo-finance2";
import { rupeesToPaise, type InstrumentRef, type PriceQuote, type PriceSource } from "./types.js";

/**
 * Yahoo Finance via yahoo-finance2 — NSE `.NS` / BSE `.BO` equities and demat-held SGBs.
 * SERVER-SIDE ONLY (CORS). This module is the *only* importer of yahoo-finance2; the verification
 * gate never imports it, so the dependency stays out of the `tsx` gate.
 */
function toIsoDate(t: Date | number | undefined): string {
  if (t instanceof Date) return t.toISOString().slice(0, 10);
  if (typeof t === "number") return new Date(t < 1e12 ? t * 1000 : t).toISOString().slice(0, 10);
  return new Date().toISOString().slice(0, 10);
}

export const yahooSource: PriceSource = {
  id: "yahoo",
  kind: "equity",
  async fetchPrice(inst: InstrumentRef): Promise<PriceQuote | null> {
    if (!inst.yahooSymbol) return null;
    // yahoo-finance2 v3 overloads make the inferred shape awkward; we only need two fields.
    const q = (await yahooFinance.quote(inst.yahooSymbol)) as unknown as {
      regularMarketPrice?: number;
      regularMarketTime?: Date | number;
    };
    const price = q?.regularMarketPrice;
    if (typeof price !== "number" || !Number.isFinite(price)) return null;
    return { pricePaise: rupeesToPaise(price), priceDate: toIsoDate(q?.regularMarketTime) };
  },
};
