/**
 * Upstox demat report parsers. Mirrors the Zerodha holdings adapter in market.ts.
 * Money is ALWAYS integer paise (×100, rounded). PAN/UCC/Name in the preamble are
 * stripped and never logged. The xlsx files carry a bogus `dimension ref="A1"`, but a
 * normal (non-read-only) XLSX.read + sheet_to_json recomputes the real grid, so every
 * column is visible.
 */
import * as XLSX from "xlsx";
import { finalizeHashes } from "../util";
import type { HoldingRow, HoldingsSnapshot, UpstoxDividends } from "../types";

/** Account name used for dividend content-hashing — matches the seeded Upstox broker account. */
export const UPSTOX_ACCOUNT_NAME = "Upstox";

const ISIN_RE = /^IN[A-Z0-9]{10}$/;
const toPaise = (v: unknown): number => Math.round(Number(v) * 100);

/** Excel serial date (date1904=false epoch 1899-12-30) → ISO YYYY-MM-DD. */
export function excelSerialToISO(serial: number): string {
  const ms = Date.UTC(1899, 11, 30) + Math.round(Number(serial)) * 86400000;
  return new Date(ms).toISOString().slice(0, 10);
}

/** Upstox prints DD-MM-YYYY in text date cells (e.g. Value Date "12-06-2026"). → ISO. */
function ddmmyyyyToISO(raw: string): string {
  const m = raw.trim().match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (!m) throw new Error(`unparseable DD-MM-YYYY date: "${raw}"`);
  return `${m[3]}-${m[2]}-${m[1]}`;
}

function grid(ws: XLSX.WorkSheet): unknown[][] {
  return XLSX.utils.sheet_to_json(ws, { header: 1, raw: true }) as unknown[][];
}

/** Find the row index whose cells contain ALL of the given header labels (startsWith match). */
function findHeader(g: unknown[][], labels: string[]): number {
  for (let i = 0; i < g.length; i++) {
    const cells = (g[i] ?? []).map((c) => String(c ?? "").trim());
    if (labels.every((l) => cells.some((c) => c.startsWith(l)))) return i;
  }
  return -1;
}

/** Upstox holdings workbook (sheet HOLDING) → snapshot. ISIN is the canonical key. No cost basis in this file. */
export function parseUpstoxHoldings(buf: Buffer): HoldingsSnapshot {
  const wb = XLSX.read(buf, { type: "buffer" });
  const warnings: string[] = [];
  const rows: HoldingRow[] = [];
  let asOf: string | null = null;

  const ws = wb.Sheets["HOLDING"];
  if (!ws) {
    return {
      institution: "UPSTOX", accountName: "Upstox", asOf: null, rows: [],
      investedPaise: null, presentPaise: null, reconciliationOk: false,
      warnings: ["sheet missing: HOLDING"],
    };
  }
  const g = grid(ws);
  const headerIdx = findHeader(g, ["ISIN", "Scrip Name", "Current Qty", "Rate", "Valuation"]);
  if (headerIdx === -1) {
    return {
      institution: "UPSTOX", accountName: "Upstox", asOf: null, rows: [],
      investedPaise: null, presentPaise: null, reconciliationOk: false,
      warnings: ["no HOLDING header row (ISIN/Scrip Name/Current Qty/Rate/Valuation)"],
    };
  }
  const header = (g[headerIdx] as unknown[]).map((c) => String(c ?? "").trim());
  const col = (name: string) => header.findIndex((h) => h.startsWith(name));
  const cIsin = col("ISIN"), cName = col("Scrip Name"), cQty = col("Current Qty");
  const cValueDate = col("Value Date"), cRate = col("Rate"), cVal = col("Valuation");

  let presentPaise = 0;
  let reconcileOk = true;
  for (let i = headerIdx + 1; i < g.length; i++) {
    const r = g[i] as unknown[];
    if (!r || !r[cIsin] || !ISIN_RE.test(String(r[cIsin]).trim())) continue; // skips preamble/footer/TOTAL
    const qty = Number(r[cQty]);
    const lastPricePaise = toPaise(r[cRate]);
    const valuationPaise = toPaise(r[cVal]);
    if (asOf === null && r[cValueDate]) {
      try { asOf = ddmmyyyyToISO(String(r[cValueDate])); } catch { asOf = String(r[cValueDate]).trim(); }
    }
    // per-row reconciliation: stated Valuation ≈ qty × rate (paise), ₹2 tolerance for source rounding
    if (Math.abs(Math.round(qty * lastPricePaise) - valuationPaise) > 200) {
      reconcileOk = false;
      warnings.push(`row ${String(r[cName] ?? r[cIsin])}: qty×rate ${Math.round(qty * lastPricePaise)} ≠ valuation ${valuationPaise}`);
    }
    presentPaise += valuationPaise;
    rows.push({
      symbol: String(r[cName] ?? "").trim(),
      isin: String(r[cIsin]).trim(),
      assetClass: "equity", // holdings sheet is equities + SGB; no MF in this file
      sectorOrType: "",
      qty,
      avgPricePaise: null, // no cost basis in the Upstox holdings file — explicit null, never guessed
      lastPricePaise,
    });
  }
  if (rows.length === 0) { reconcileOk = false; warnings.push("no holding rows parsed"); }

  return {
    institution: "UPSTOX", accountName: "Upstox", asOf, rows,
    investedPaise: null, // not derivable — Upstox holdings carry no average buy price
    presentPaise: rows.length ? presentPaise : null,
    reconciliationOk: reconcileOk, warnings,
  };
}

/**
 * Upstox dividend report (sheet DIVIDEND) → income transactions (+inflow). Reconciles the
 * sum of Net Dividend Amount against the stated `Total Dividend`. content_hash dedup is
 * applied via finalizeHashes, identical to the bank-statement path. No money touches an LLM.
 */
export function parseUpstoxDividends(buf: Buffer): UpstoxDividends {
  const wb = XLSX.read(buf, { type: "buffer" });
  const warnings: string[] = [];
  const ws = wb.Sheets["DIVIDEND"];
  if (!ws) return { rows: [], totalDividendPaise: 0, reconciliationOk: false, warnings: ["sheet missing: DIVIDEND"] };
  const g = grid(ws);

  // Stated total: a "Total Dividend | <amount>" summary row above the table.
  let totalDividendPaise = 0;
  for (const r0 of g) {
    const cells = (r0 ?? []).map((c) => String(c ?? "").trim());
    const ti = cells.findIndex((c) => c === "Total Dividend");
    if (ti >= 0 && cells[ti + 1]) { totalDividendPaise = toPaise(cells[ti + 1]); break; }
  }

  const headerIdx = findHeader(g, ["Scrip Name", "Symbol", "ISIN", "Record Date", "Net Dividend Amount"]);
  if (headerIdx === -1) return { rows: [], totalDividendPaise, reconciliationOk: false, warnings: ["no DIVIDEND header row"] };
  const header = (g[headerIdx] as unknown[]).map((c) => String(c ?? "").trim());
  const col = (name: string) => header.findIndex((h) => h.startsWith(name));
  const cSym = col("Symbol"), cIsin = col("ISIN"), cNature = col("Nature"), cDate = col("Record Date"), cNet = col("Net Dividend Amount");

  const pre = [];
  for (let i = headerIdx + 1; i < g.length; i++) {
    const r = g[i] as unknown[];
    if (!r || !r[cIsin] || !ISIN_RE.test(String(r[cIsin]).trim())) continue; // skips notes/footer/TOTAL
    const symbol = String(r[cSym] ?? "").trim();
    const nature = String(r[cNature] ?? "").trim();
    pre.push({
      txnDate: excelSerialToISO(Number(r[cDate])),
      descriptionRaw: `Dividend · ${symbol} · ${nature}`,
      amountPaise: toPaise(r[cNet]), // + inflow
      refNo: String(r[cIsin]).trim(),
    });
  }
  const rows = finalizeHashes(UPSTOX_ACCOUNT_NAME, pre);

  const sum = rows.reduce((s, t) => s + t.amountPaise, 0);
  const reconciliationOk = rows.length > 0 && sum === totalDividendPaise;
  if (!reconciliationOk) warnings.push(`reconcile: Σ net ${sum} ≠ stated total ${totalDividendPaise}`);

  return { rows, totalDividendPaise, reconciliationOk, warnings };
}
