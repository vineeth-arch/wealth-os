/**
 * Upstox demat report parsers. Mirrors the Zerodha holdings adapter in market.ts.
 * Money is ALWAYS integer paise (×100, rounded). PAN/UCC/Name in the preamble are
 * stripped and never logged. The xlsx files carry a bogus `dimension ref="A1"`, but a
 * normal (non-read-only) XLSX.read + sheet_to_json recomputes the real grid, so every
 * column is visible.
 */
import * as XLSX from "xlsx";
import { finalizeHashes } from "../util";
import type { HoldingRow, HoldingsSnapshot, UpstoxDividends, RealizedLot, RealizedSegment, UpstoxTaxReport } from "../types";

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

const paiseOrZero = (v: unknown): number => {
  const s = String(v ?? "").trim();
  return s === "" ? 0 : toPaise(s);
};

const SEGMENT_SHEETS: Array<[string, string]> = [
  ["Equities", "equities"],
  ["Future & Options", "fo"],
  ["Commodities", "commodities"],
  ["Currencies", "currencies"],
];

/**
 * Upstox tradewise tax report → realized capital-gains record. Per segment: stated Gross/Net P&L,
 * the Charges TOTAL, and the closed (matched buy↔sell) lots with the ST/LT split. This is REALIZED,
 * already-matched data — NOT a chronological tradebook. Reconciles each populated segment:
 * Σ lot.totalPL == Gross, Net == Gross − Charges, lot ST/LT split sums to Gross, and the detail
 * Gross matches the Summary sheet's stated Gross.
 */
export function parseUpstoxTaxReport(buf: Buffer): UpstoxTaxReport {
  const wb = XLSX.read(buf, { type: "buffer" });
  const warnings: string[] = [];

  // Summary sheet: financial year + authoritative per-segment Gross/Net to reconcile against.
  let financialYear = "";
  const summaryGross = new Map<string, number>();
  const sws = wb.Sheets["Summary"];
  if (sws) {
    const sg = grid(sws);
    let current = "";
    const nameByLabel = new Map(SEGMENT_SHEETS.map(([label, key]) => [label, key]));
    for (const r0 of sg) {
      const a = String((r0 ?? [])[0] ?? "").trim();
      const b = (r0 ?? [])[1];
      if (a === "Financial Year" && b != null) financialYear = String(b).trim();
      if (nameByLabel.has(a) && (b == null || String(b).trim() === "")) current = nameByLabel.get(a)!;
      if (a === "Gross P&L" && b != null && current) summaryGross.set(current, toPaise(b));
    }
  } else {
    warnings.push("sheet missing: Summary");
  }

  const segments: RealizedSegment[] = [];
  let reconciliationOk = true;

  for (const [sheetName, segKey] of SEGMENT_SHEETS) {
    const ws = wb.Sheets[sheetName];
    if (!ws) { warnings.push(`sheet missing: ${sheetName}`); continue; }
    const g = grid(ws);

    let grossPaise: number | null = null, netPaise: number | null = null, chargesPaise = 0;
    let chargesSeen = false;
    for (const r0 of g) {
      const a = String((r0 ?? [])[0] ?? "").trim();
      const b = (r0 ?? [])[1];
      if (a === "Gross P&L" && b != null) grossPaise = toPaise(b);
      else if (a === "Net P&L" && b != null) netPaise = toPaise(b);
      else if (a === "Charges") chargesSeen = true;
      else if (a === "TOTAL" && chargesSeen && b != null) { chargesPaise = toPaise(b); chargesSeen = false; } // first TOTAL after the Charges heading
    }

    // tradewise closed-lot table
    const headerIdx = findHeader(g, ["Buy Date", "Sell Date", "Total PL", "ISIN"]);
    const lots: RealizedLot[] = [];
    if (headerIdx >= 0) {
      const header = (g[headerIdx] as unknown[]).map((c) => String(c ?? "").trim());
      const col = (name: string) => header.findIndex((h) => h.startsWith(name));
      const cScrip = col("Scrip Name"), cIsin = col("ISIN"), cQty = col("Qty"),
        cBuyDate = col("Buy Date"), cBuyAmt = col("Buy Amt"), cSellDate = col("Sell Date"), cSellAmt = col("Sell Amt"),
        cPl = col("Total PL"), cSt = col("Short Term"), cLt = col("Long Term");
      for (let i = headerIdx + 1; i < g.length; i++) {
        const r = g[i] as unknown[];
        const a = String((r ?? [])[0] ?? "").trim();
        if (a === "TOTAL") break;
        if (!r || !r[cIsin] || !ISIN_RE.test(String(r[cIsin]).trim())) continue; // skip empty separator rows
        lots.push({
          segment: segKey,
          scrip: String(r[cScrip] ?? "").trim(),
          isin: String(r[cIsin]).trim(),
          qty: Number(r[cQty]),
          buyDate: excelSerialToISO(Number(r[cBuyDate])),
          buyAmtPaise: paiseOrZero(r[cBuyAmt]),
          sellDate: excelSerialToISO(Number(r[cSellDate])),
          sellAmtPaise: paiseOrZero(r[cSellAmt]),
          totalPlPaise: paiseOrZero(r[cPl]),
          shortTermPaise: paiseOrZero(r[cSt]),
          longTermPaise: paiseOrZero(r[cLt]),
        });
      }
    }

    const lotPl = lots.reduce((s, l) => s + l.totalPlPaise, 0);
    const lotSt = lots.reduce((s, l) => s + l.shortTermPaise, 0);
    const lotLt = lots.reduce((s, l) => s + l.longTermPaise, 0);
    const gross = grossPaise ?? lotPl;
    const net = netPaise ?? gross - chargesPaise;
    const speculation = gross - lotSt - lotLt;

    if (lots.length > 0) {
      const checks =
        lotPl === gross &&
        net === gross - chargesPaise &&
        (!summaryGross.has(segKey) || summaryGross.get(segKey) === gross);
      if (!checks) {
        reconciliationOk = false;
        warnings.push(`${segKey}: Σ lotPL ${lotPl} vs gross ${gross}; net ${net} vs gross−charges ${gross - chargesPaise}; summary ${summaryGross.get(segKey) ?? "n/a"}`);
      }
    }

    segments.push({
      segment: segKey,
      grossPlPaise: gross,
      netPlPaise: net,
      chargesPaise,
      shortTermPaise: lotSt,
      longTermPaise: lotLt,
      speculationPaise: speculation,
      lots,
    });
  }

  return { financialYear, segments, reconciliationOk, warnings };
}
