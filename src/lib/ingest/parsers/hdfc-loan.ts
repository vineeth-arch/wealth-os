import { parseAmount, parseDate, isMdRow, mdCells } from "../util.js";

/** One installment row from an HDFC loan repayment schedule. Money is integer paise. */
export interface LoanScheduleRow {
  instlNo: number;
  dueDate: string;            // ISO YYYY-MM-DD
  instlPaise: number;
  principalPaise: number;
  interestPaise: number;
  osPrincipalPaise: number;   // outstanding principal after this installment
}

export interface LoanScheduleParseResult {
  agreementNo: string;
  loanType: string;           // e.g. "PERSONAL LOAN"
  kind: string;               // mapped to loans.kind enum
  amountFinancedPaise: number;
  tenureMonths: number;
  frequency: string;
  firstDueDate: string;       // ISO
  rows: LoanScheduleRow[];
  totals: { instlPaise: number; principalPaise: number; interestPaise: number };
  /** APR backed out from the schedule — APPROX (the irregular first installment defeats a single exact rate). */
  approxAnnualRatePct: number;
  reconciliation: { ok: boolean; detail: string };
  warnings: string[];
}

const LOAN_KIND: Record<string, string> = {
  "PERSONAL LOAN": "personal",
  "HOME LOAN": "home",
  "VEHICLE LOAN": "vehicle",
  "AUTO LOAN": "vehicle",
  "EDUCATION LOAN": "education",
  "BUSINESS LOAN": "business",
};

/**
 * HDFC loan repayment schedule — a markdown pipe-table spread across pages. The header + metadata
 * repeat on page 2 with a COLUMN SHIFT (extra empty leading/trailing cells), so we match by dropping
 * empty cells and mapping positionally rather than by fixed column index. The actual imported
 * schedule is the source of truth: its irregular first installment (broken-period interest) and final
 * rounding cannot be reproduced by a clean computed amortization. PII (customer name, agreement no)
 * is parsed but never logged.
 */
export function parseHdfcLoanSchedule(content: string): LoanScheduleParseResult {
  const lines = content.split(/\r?\n/);
  const warnings: string[] = [];

  let agreementNo = "", loanType = "", frequency = "";
  let amountFinancedPaise = 0, tenureMonths = 0;
  const rows: LoanScheduleRow[] = [];
  const totals = { instlPaise: 0, principalPaise: 0, interestPaise: 0 };

  for (const line of lines) {
    if (!isMdRow(line)) continue;
    const cells = mdCells(line).filter((c) => c !== "");   // drop empty cells → tolerate column shift
    if (cells.length === 0) continue;

    // Metadata rows carry label/value pairs; a single row may hold two pairs.
    for (let i = 0; i < cells.length - 1; i++) {
      const label = cells[i].replace(/\.$/, "").trim().toUpperCase();
      const val = cells[i + 1];
      if (label === "AGREEMENT NO" && !agreementNo) agreementNo = val;
      else if (label === "LOAN TYPE" && !loanType) loanType = val;
      else if (label === "AMOUNT FINANCED" && !amountFinancedPaise) amountFinancedPaise = parseAmount(val).paise;
      else if ((label === "TOTAL INSTL" || label === "TENURE") && !tenureMonths && /^\d+$/.test(val)) tenureMonths = Number(val);
      else if (label === "FREQUENCY" && !frequency) frequency = val;
    }

    // Total row: "Total :" then the three column sums.
    if (cells[0].replace(/\s|:/g, "").toUpperCase() === "TOTAL" && cells.length >= 4) {
      totals.instlPaise = parseAmount(cells[1]).paise;
      totals.principalPaise = parseAmount(cells[2]).paise;
      totals.interestPaise = parseAmount(cells[3]).paise;
      continue;
    }

    // Schedule row: integer instl no + DD/MM/YYYY due date + four amounts (O/s may be "0").
    if (/^\d+$/.test(cells[0]) && cells.length >= 6 && /^\d{2}\/\d{2}\/\d{4}$/.test(cells[1])) {
      rows.push({
        instlNo: Number(cells[0]),
        dueDate: parseDate(cells[1]),
        instlPaise: parseAmount(cells[2]).paise,
        principalPaise: parseAmount(cells[3]).paise,
        interestPaise: parseAmount(cells[4]).paise,
        osPrincipalPaise: parseAmount(cells[5]).paise,
      });
    }
  }

  if (!loanType) throw new Error("HDFC loan: loan type not found");
  const kind = LOAN_KIND[loanType.toUpperCase()] ?? "other";
  const firstDueDate = rows[0]?.dueDate ?? "";

  // ---- Reconciliation: per-row identity, outstanding chain, and the Total row ----
  const sumInstl = rows.reduce((s, r) => s + r.instlPaise, 0);
  const sumPrincipal = rows.reduce((s, r) => s + r.principalPaise, 0);
  const sumInterest = rows.reduce((s, r) => s + r.interestPaise, 0);

  let rowIdentityOk = true, chainOk = true;
  let os = amountFinancedPaise;
  for (const r of rows) {
    if (r.instlPaise !== r.principalPaise + r.interestPaise) { rowIdentityOk = false; break; }
    os -= r.principalPaise;
    if (r.osPrincipalPaise !== os) { chainOk = false; break; }
  }

  const checks: Array<[boolean, string]> = [
    [rows.length === tenureMonths, `row count ${rows.length} vs tenure ${tenureMonths}`],
    [sumPrincipal === amountFinancedPaise, `Σprincipal ${sumPrincipal} vs amount financed ${amountFinancedPaise}`],
    [sumPrincipal === totals.principalPaise, `Σprincipal vs Total ${totals.principalPaise}`],
    [sumInterest === totals.interestPaise, `Σinterest ${sumInterest} vs Total ${totals.interestPaise}`],
    [sumInstl === totals.instlPaise, `Σinstl ${sumInstl} vs Total ${totals.instlPaise}`],
    [rowIdentityOk, "every row: instl == principal + interest"],
    [chainOk, "outstanding-principal chain ends at 0"],
  ];
  const failed = checks.filter(([ok]) => !ok).map(([, d]) => d);
  const ok = failed.length === 0;

  // APPROX APR: average implied monthly rate over the regular rows (skip the irregular first),
  // annualized. Display-only; never used for money arithmetic.
  let rateSum = 0, rateN = 0;
  let opening = amountFinancedPaise - (rows[0]?.principalPaise ?? 0);
  for (let i = 1; i < rows.length - 1; i++) {
    if (opening > 0) { rateSum += rows[i].interestPaise / opening; rateN++; }
    opening -= rows[i].principalPaise;
  }
  const approxAnnualRatePct = rateN ? Math.round(rateSum / rateN * 1200 * 100) / 100 : 0;

  return {
    agreementNo, loanType, kind, amountFinancedPaise, tenureMonths, frequency, firstDueDate,
    rows, totals, approxAnnualRatePct,
    reconciliation: { ok, detail: ok ? `schedule reconciled: ${rows.length} installments, Σprincipal == amount financed, chain → 0` : `RECONCILIATION FAILED: ${failed.join("; ")}` },
    warnings,
  };
}
