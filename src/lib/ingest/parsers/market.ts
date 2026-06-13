import * as cheerio from "cheerio";
import * as XLSX from "xlsx";
import type { UpiEnrichmentRow, HoldingsSnapshot, HoldingRow } from "../types.js";
import { parseAmount, parseDate } from "../util.js";

/**
 * BHIM UPI TransactionHistory export. ENRICHMENT ONLY — bank/CC statements stay canonical.
 * Columns: Date, Time, Bank Name, Account Number, Sender, Receiver, Ref, Pay/Collect, Amount, DR/CR, Status.
 */
export function parseBhimUpi(html: string): { rows: UpiEnrichmentRow[]; skipped: number } {
  const $ = cheerio.load(html);
  const rows: UpiEnrichmentRow[] = [];
  let skipped = 0;
  $("tr").each((_, tr) => {
    const cells = $(tr).find("td").map((_, td) => $(td).text().replace(/\s+/g, " ").trim()).get();
    if (cells.length < 11) return;
    const [date, _time, bank, acct, sender, receiver, ref, _pc, amount, drcr, status] = cells;
    if (!/^\d{2}\/\d{2}\/\d{4}$/.test(date)) return;
    if (status !== "SUCCESS") { skipped++; return; }
    const { paise } = parseAmount(amount);
    const vpaName = (s: string) => {
      const m = s.match(/^([^(]+)\((.*)\)$/);
      return m ? { vpa: m[1].trim(), name: m[2].trim() } : { vpa: s, name: "" };
    };
    const counterpart = drcr === "DR" ? vpaName(receiver) : vpaName(sender);
    rows.push({
      txnDate: parseDate(date),
      amountPaise: drcr === "DR" ? -paise : paise,
      bankName: bank,
      accountMask: acct,
      counterpartyVpa: counterpart.vpa,
      counterpartyName: counterpart.name,
      refNo: ref,
      status,
    });
  });
  return { rows, skipped };
}

/** Zerodha Console holdings workbook → snapshot. ISIN is the canonical instrument key. */
export function parseZerodhaHoldings(buf: Buffer): HoldingsSnapshot {
  const wb = XLSX.read(buf, { type: "buffer" });
  const warnings: string[] = [];
  const rows: HoldingRow[] = [];
  let invested: number | null = null, present: number | null = null;
  let asOf: string | null = null;

  const toPaise = (v: unknown): number => Math.round(Number(v) * 100);

  for (const sheetName of ["Equity", "Mutual Funds"]) {
    const ws = wb.Sheets[sheetName];
    if (!ws) { warnings.push(`sheet missing: ${sheetName}`); continue; }
    const grid: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true });
    let headerIdx = -1;
    for (let i = 0; i < grid.length; i++) {
      const r = (grid[i] ?? []).map((c) => String(c ?? ""));
      if (r.includes("Symbol") && r.includes("ISIN")) { headerIdx = i; break; }
      const joined = r.join(" ");
      const dm = joined.match(/as o[fn]\s*:?\s*(\d{1,2}[-/ ][A-Za-z]{3}[-/ ]\d{2,4}|\d{4}-\d{2}-\d{2}|\d{2}-\d{2}-\d{4})/i);
      if (dm && !asOf) { try { asOf = parseDate(dm[1]); } catch { asOf = dm[1]; } }
      if (sheetName === "Equity") {
        const iv = r.indexOf("Invested Value"); if (iv >= 0 && r[iv + 1]) invested = toPaise(r[iv + 1]);
        const pv = r.indexOf("Present Value"); if (pv >= 0 && r[pv + 1]) present = toPaise(r[pv + 1]);
      }
    }
    if (headerIdx === -1) { warnings.push(`no header row in ${sheetName}`); continue; }
    const header = (grid[headerIdx] as unknown[]).map((c) => String(c ?? ""));
    const col = (name: string) => header.findIndex((h) => h.startsWith(name));
    const [cSym, cIsin, cQty, cAvg, cPrev] =
      [col("Symbol"), col("ISIN"), col("Quantity Available"), col("Average Price"), col("Previous Closing Price")];
    const cSector = col("Sector") >= 0 ? col("Sector") : col("Instrument Type");
    for (let i = headerIdx + 1; i < grid.length; i++) {
      const r = grid[i] as unknown[];
      if (!r || !r[cIsin] || !/^IN[A-Z0-9]{10}$/.test(String(r[cIsin]))) continue;
      rows.push({
        symbol: String(r[cSym]),
        isin: String(r[cIsin]),
        assetClass: sheetName === "Equity" ? "equity" : "mutual_fund",
        sectorOrType: String(r[cSector] ?? ""),
        qty: Number(r[cQty]),
        avgPricePaise: toPaise(r[cAvg]),
        lastPricePaise: toPaise(r[cPrev]),
      });
    }
  }

  // reconcile: Combined-sheet summary, tolerance ₹2 for float rounding in the source file
  let combinedInvested: number | null = null, combinedPresent: number | null = null;
  const cws = wb.Sheets["Combined"];
  if (cws) {
    const grid: unknown[][] = XLSX.utils.sheet_to_json(cws, { header: 1, raw: true });
    for (const r0 of grid) {
      const r = (r0 ?? []).map((c) => String(c ?? ""));
      const iv = r.indexOf("Invested Value"); if (iv >= 0 && r[iv + 1]) combinedInvested = toPaise(r[iv + 1]);
      const pv = r.indexOf("Present Value"); if (pv >= 0 && r[pv + 1]) combinedPresent = toPaise(r[pv + 1]);
    }
  }
  const calcInvested = Math.round(rows.reduce((s, r) => s + r.qty * r.avgPricePaise, 0));
  const calcPresent = Math.round(rows.reduce((s, r) => s + r.qty * r.lastPricePaise, 0));
  const ok =
    combinedInvested !== null && combinedPresent !== null &&
    Math.abs(calcInvested - combinedInvested) <= 200 && Math.abs(calcPresent - combinedPresent) <= 200;
  if (!ok) warnings.push(`reconcile: calc invested ${calcInvested} vs stated ${combinedInvested}; present ${calcPresent} vs ${combinedPresent}`);

  void invested; void present;
  return {
    institution: "ZERODHA", accountName: "Zerodha", asOf, rows,
    investedPaise: combinedInvested, presentPaise: combinedPresent,
    reconciliationOk: ok, warnings,
  };
}
