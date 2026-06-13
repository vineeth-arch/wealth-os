import { fetchNavAllText, parseNavAll } from "./amfi.js";
import { type InstrumentRef, type PriceQuote, type PriceSource } from "./types.js";

/**
 * mfdata fallback. A dedicated mfdata.in NAV endpoint is not free/stable enough to verify, so this
 * source is currently served by the authoritative AMFI NAVAll file (same data, different id) — it acts
 * as a second attempt with its own retry. Swapping in a real mfdata endpoint later only touches this file.
 */
export const mfdataSource: PriceSource = {
  id: "mfdata",
  kind: "mf_nav",
  async fetchPrice(inst: InstrumentRef): Promise<PriceQuote | null> {
    if (!inst.amfiSchemeCode) return null;
    const rec = parseNavAll(await fetchNavAllText()).get(inst.amfiSchemeCode);
    return rec ? { pricePaise: rec.navPaise, priceDate: rec.date } : null;
  },
};
