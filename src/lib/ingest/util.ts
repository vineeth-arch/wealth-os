import { createHash } from "node:crypto";

/**
 * Parse an Indian statement amount string into integer paise.
 * Handles: "1,705.60" "₹ 15,927.04" "r29,333.27" "₹ -18,428.50" "165.66 CR" "38,678.75"
 * Returns { paise, marker } where marker is "CR" | "DR" | null (suffix on the string, if any).
 * Throws on anything that does not parse cleanly — silent coercion is forbidden.
 */
export function parseAmount(raw: string): { paise: number; marker: "CR" | "DR" | null } {
  let s = raw.trim();
  let marker: "CR" | "DR" | null = null;
  const m = s.match(/\b(CR|DR)\.?$/i);
  if (m) { marker = m[1].toUpperCase() as "CR" | "DR"; s = s.slice(0, m.index).trim(); }
  s = s.replace(/^[₹r]\s*/i, "").replace(/,/g, "").trim();
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) throw new Error(`unparseable amount: "${raw}"`);
  const neg = s.startsWith("-");
  if (neg) s = s.slice(1);
  const [rupees, frac = "0"] = s.split(".");
  const paise = Number(rupees) * 100 + Number(frac.padEnd(2, "0"));
  if (!Number.isSafeInteger(paise)) throw new Error(`amount overflow: "${raw}"`);
  return { paise: neg ? -paise : paise, marker };
}

/** Is this cell a parseable amount (with optional CR/DR)? */
export function isAmount(raw: string): boolean {
  try { parseAmount(raw); return true; } catch { return false; }
}

export function formatPaise(p: number): string {
  const sign = p < 0 ? "-" : "";
  const a = Math.abs(p);
  const r = Math.floor(a / 100), f = String(a % 100).padStart(2, "0");
  return `${sign}₹${r.toLocaleString("en-IN")}.${f}`;
}

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

/**
 * Parse statement dates to ISO YYYY-MM-DD. Supported, by observation of real fixtures:
 *  "01/05/2025" (DD/MM/YYYY)   "01 Apr 26" (DD Mon YY)   "16-Apr-2026" (DD-Mon-YYYY)
 *  "18/Apr/2026" (DD/Mon/YYYY) "01-APR-2026"             "01 May" + explicit year arg
 */
export function parseDate(raw: string, yearHint?: number): string {
  const s = raw.trim();
  let m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);                       // DD/MM/YYYY
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  m = s.match(/^(\d{1,2})[\s/-]([A-Za-z]{3,9})[\s/-](\d{2}|\d{4})$/);   // DD Mon YY|YYYY
  if (m) {
    const mon = MONTHS[m[2].slice(0, 3).toLowerCase()];
    if (!mon) throw new Error(`bad month: "${raw}"`);
    const yyyy = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${yyyy}-${mon}-${m[1].padStart(2, "0")}`;
  }
  m = s.match(/^(\d{1,2})\s+([A-Za-z]{3,9})$/);                          // DD Mon  (needs yearHint)
  if (m && yearHint) {
    const mon = MONTHS[m[2].slice(0, 3).toLowerCase()];
    if (!mon) throw new Error(`bad month: "${raw}"`);
    return `${yearHint}-${mon}-${m[1].padStart(2, "0")}`;
  }
  throw new Error(`unparseable date: "${raw}"`);
}

/** Normalize narration for hashing: kill literal \n artifacts, collapse whitespace, uppercase. */
export function normalizeDesc(s: string): string {
  return s.replace(/\\n/g, " ").replace(/\s+/g, " ").trim().toUpperCase();
}

/** Stable dedup key. occurrence disambiguates genuine same-day same-amount repeats within one statement. */
export function contentHash(account: string, isoDate: string, amountPaise: number, desc: string, occurrence: number): string {
  return createHash("sha256")
    .update([account, isoDate, String(amountPaise), normalizeDesc(desc), String(occurrence)].join("|"))
    .digest("hex");
}

/** Split a markdown table row into trimmed cells, dropping the empty leading/trailing splits. */
export function mdCells(line: string): string[] {
  return line.slice(1, line.endsWith("|") ? -1 : undefined).split("|").map((c) => c.trim());
}

export function isMdRow(line: string): boolean {
  return line.trimStart().startsWith("|");
}

export function isMdSeparator(line: string): boolean {
  return /^\|[\s\-|]+\|?\s*$/.test(line.trim());
}

/** Assign occurrence indices + hashes to a list of txns belonging to ONE statement/account. */
export function finalizeHashes(
  account: string,
  txns: Array<Omit<import("./types.js").ParsedTransaction, "occurrence" | "contentHash">>,
): import("./types.js").ParsedTransaction[] {
  const seen = new Map<string, number>();
  return txns.map((t) => {
    const key = `${t.txnDate}|${t.amountPaise}|${normalizeDesc(t.descriptionRaw)}`;
    const occurrence = (seen.get(key) ?? 0) + 1;
    seen.set(key, occurrence);
    return { ...t, occurrence, contentHash: contentHash(account, t.txnDate, t.amountPaise, t.descriptionRaw, occurrence) };
  });
}
