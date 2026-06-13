import { parseDate } from "../ingest/util.js";
import { rupeesToPaise, type InstrumentRef, type PriceQuote, type PriceSource } from "./types.js";

/**
 * AMFI NAVAll.txt — the single source of truth for MF NAV AND ISIN→scheme-code mapping.
 * One fetch serves both: the `amfi` price adapter (NAV lookup) and the Pass-D auto-mapper
 * (ISIN → scheme code). Format is semicolon-delimited:
 *   Scheme Code;ISIN Div Payout/ISIN Growth;ISIN Div Reinvestment;Scheme Name;Net Asset Value;Date
 * Interspersed with AMC section headers (no ';'), category headers, and blank lines — all skipped.
 * https://www.amfiindia.com/spages/NAVAll.txt
 */
export const NAVALL_URL = "https://www.amfiindia.com/spages/NAVAll.txt";

export interface NavRecord { schemeCode: string; schemeName: string; navPaise: number; date: string }

/** Pure parse: scheme code → NAV record. Skips headers, blank lines, and unparseable NAVs. */
export function parseNavAll(text: string): Map<string, NavRecord> {
  const out = new Map<string, NavRecord>();
  for (const line of text.split(/\r?\n/)) {
    const cols = line.split(";");
    if (cols.length < 6) continue; // section header / blank / category line
    const schemeCode = cols[0].trim();
    if (!/^\d+$/.test(schemeCode)) continue; // header row ("Scheme Code") or junk
    const schemeName = cols[3].trim();
    const navRaw = cols[4].trim();
    const nav = Number(navRaw);
    if (!navRaw || !Number.isFinite(nav) || nav <= 0) continue; // "N.A." etc.
    let date: string;
    try { date = parseDate(cols[5].trim()); } catch { continue; }
    out.set(schemeCode, { schemeCode, schemeName, navPaise: rupeesToPaise(nav), date });
  }
  return out;
}

/** Pure parse: ISIN → {schemeCode, schemeName}. Maps both growth/payout and reinvestment ISINs. */
export function parseNavAllForIsinMap(text: string): Map<string, { schemeCode: string; schemeName: string }> {
  const out = new Map<string, { schemeCode: string; schemeName: string }>();
  for (const line of text.split(/\r?\n/)) {
    const cols = line.split(";");
    if (cols.length < 6) continue;
    const schemeCode = cols[0].trim();
    if (!/^\d+$/.test(schemeCode)) continue;
    const schemeName = cols[3].trim();
    for (const isinCell of [cols[1].trim(), cols[2].trim()]) {
      if (/^IN[A-Z0-9]{10}$/.test(isinCell)) out.set(isinCell, { schemeCode, schemeName });
    }
  }
  return out;
}

/** One cached fetch of NAVAll.txt per process run (cron is short-lived). */
let _navAllText: string | null = null;
export async function fetchNavAllText(): Promise<string> {
  if (_navAllText !== null) return _navAllText;
  const res = await fetch(NAVALL_URL);
  if (!res.ok) throw new Error(`AMFI NAVAll ${res.status}`);
  _navAllText = await res.text();
  return _navAllText;
}

/** `amfi` price adapter — NAV by AMFI scheme code, from the shared NAVAll file. */
export const amfiSource: PriceSource = {
  id: "amfi",
  kind: "mf_nav",
  async fetchPrice(inst: InstrumentRef): Promise<PriceQuote | null> {
    if (!inst.amfiSchemeCode) return null;
    const rec = parseNavAll(await fetchNavAllText()).get(inst.amfiSchemeCode);
    return rec ? { pricePaise: rec.navPaise, priceDate: rec.date } : null;
  },
};
