import { rupeesToPaise, type InstrumentRef, type PriceQuote, type PriceSource } from "./types.js";

/**
 * mfapi.in — free MF NAV by AMFI scheme code, no auth. Primary MF source.
 *   GET https://api.mfapi.in/mf/{schemeCode}/latest
 *   → { meta:{...}, data:[{ date:"DD-MM-YYYY", nav:"45.67890" }], status:"SUCCESS" }
 */
export const MFAPI_BASE = "https://api.mfapi.in/mf";

interface MfapiResponse { status?: string; data?: Array<{ date?: string; nav?: string }> }

/** Pure parse: latest mfapi payload → quote. Returns null when the payload has no usable NAV. */
export function parseMfapiNav(json: unknown): PriceQuote | null {
  const r = json as MfapiResponse;
  const latest = r?.data?.[0];
  if (!latest?.nav || !latest?.date) return null;
  const nav = Number(latest.nav);
  if (!Number.isFinite(nav) || nav <= 0) return null;
  const m = latest.date.trim().match(/^(\d{2})-(\d{2})-(\d{4})$/); // DD-MM-YYYY
  if (!m) return null;
  return { pricePaise: rupeesToPaise(nav), priceDate: `${m[3]}-${m[2]}-${m[1]}` };
}

export const mfapiSource: PriceSource = {
  id: "mfapi",
  kind: "mf_nav",
  async fetchPrice(inst: InstrumentRef): Promise<PriceQuote | null> {
    if (!inst.amfiSchemeCode) return null;
    const res = await fetch(`${MFAPI_BASE}/${inst.amfiSchemeCode}/latest`);
    if (!res.ok) throw new Error(`mfapi ${res.status}`);
    return parseMfapiNav(await res.json());
  },
};
