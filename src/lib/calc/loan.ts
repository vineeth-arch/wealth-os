/**
 * Loan amortization (reducing-balance) and prepayment impact. Integer paise throughout; format at the
 * view. No deps. Mirrors the freefincal EMI / amortization convention.
 *
 * EMI (reducing balance): EMI = P·r·(1+r)^n / ((1+r)^n − 1), where r = annualRatePct/12/100 (monthly)
 * and n = tenure in months. Each month interest = round(opening·r), principal = EMI − interest. The
 * LAST instalment absorbs the cumulative rounding remainder so the closing balance is EXACTLY 0 paise.
 *
 * ASSUMPTIONS (surfaced in the UI): fixed annual rate over the whole tenure; EMI paid monthly in
 * arrears; no fees/insurance/moratorium; prepayment applied as a one-time lump sum after a given month.
 * Educational, not financial advice.
 */

export interface LoanInput {
  principalPaise: number;
  annualRatePct: number;
  tenureMonths: number;
}

export interface AmortRow {
  month: number;
  openingBalancePaise: number;
  emiPaise: number;
  interestPaise: number;
  principalPaise: number;
  closingBalancePaise: number;
}

/** Monthly rate as a fraction (e.g. 9% p.a. → 0.0075). */
function monthlyRate(annualRatePct: number): number {
  return annualRatePct / 12 / 100;
}

/** Level EMI in paise for a reducing-balance loan. Zero-rate loans amortize linearly (P/n). */
export function emiPaise({ principalPaise, annualRatePct, tenureMonths }: LoanInput): number {
  if (tenureMonths <= 0) throw new Error("tenureMonths must be positive");
  const r = monthlyRate(annualRatePct);
  if (r === 0) return Math.round(principalPaise / tenureMonths);
  const f = Math.pow(1 + r, tenureMonths);
  return Math.round((principalPaise * r * f) / (f - 1));
}

/**
 * Full reducing-balance schedule. The final instalment is forced to clear the balance exactly, so the
 * last row's closingBalancePaise === 0 and Σ principalPaise === principalPaise (asserted).
 */
export function amortizationSchedule(input: LoanInput): AmortRow[] {
  const { principalPaise, tenureMonths } = input;
  if (principalPaise <= 0) throw new Error("principalPaise must be positive");
  const r = monthlyRate(input.annualRatePct);
  const baseEmi = emiPaise(input);

  const rows: AmortRow[] = [];
  let opening = principalPaise;
  for (let month = 1; month <= tenureMonths; month++) {
    const interest = Math.round(opening * r);
    let emi: number;
    let principal: number;
    // Last instalment (or any month that would otherwise over-pay) clears the remaining balance exactly.
    if (month === tenureMonths || baseEmi - interest >= opening) {
      principal = opening;
      emi = opening + interest;
    } else {
      emi = baseEmi;
      principal = emi - interest;
    }
    const closing = opening - principal;
    rows.push({ month, openingBalancePaise: opening, emiPaise: emi, interestPaise: interest, principalPaise: principal, closingBalancePaise: closing });
    opening = closing;
    if (opening <= 0) break;
  }
  const last = rows[rows.length - 1];
  if (last.closingBalancePaise !== 0) throw new Error(`amortization did not close to 0: ${last.closingBalancePaise}`);
  const principalSum = rows.reduce((s, x) => s + x.principalPaise, 0);
  if (principalSum !== principalPaise) throw new Error(`principal sum ${principalSum} ≠ ${principalPaise}`);
  return rows;
}

/** Total interest paid over the life of a schedule (paise). */
export function totalInterestPaise(rows: AmortRow[]): number {
  return rows.reduce((s, x) => s + x.interestPaise, 0);
}

/** Pay down a balance at a fixed EMI until cleared. Returns months taken and interest paid. */
function payoffWithEmi(balancePaise: number, r: number, emi: number): { months: number; interestPaise: number } {
  if (balancePaise <= 0) return { months: 0, interestPaise: 0 };
  if (r > 0 && emi <= Math.round(balancePaise * r)) throw new Error("EMI does not cover interest — loan never amortizes");
  let opening = balancePaise;
  let months = 0;
  let interestPaise = 0;
  while (opening > 0) {
    months++;
    const interest = Math.round(opening * r);
    let principal = emi - interest;
    if (principal >= opening) principal = opening; // final instalment
    opening -= principal;
    interestPaise += interest;
    if (months > 100_000) throw new Error("payoff did not converge");
  }
  return { months, interestPaise };
}

export type PrepayMode = "reduce_tenure" | "reduce_emi";

export interface PrepaymentInput extends LoanInput {
  prepaymentPaise: number;
  atMonth: number;          // lump sum applied right after this instalment (1-based)
  mode: PrepayMode;
}

export interface PrepaymentResult {
  interestSavedPaise: number;
  monthsSaved: number;
  newTenureMonths?: number; // reduce_tenure
  newEmiPaise?: number;     // reduce_emi
}

/**
 * One-time prepayment after `atMonth`. reduce_tenure keeps the EMI and shortens the loan; reduce_emi
 * keeps the remaining months and lowers the EMI. interestSaved = baseline interest − interest actually
 * paid (before prepay + after re-amortization).
 */
export function prepaymentImpact(input: PrepaymentInput): PrepaymentResult {
  const { principalPaise, annualRatePct, tenureMonths, prepaymentPaise, atMonth, mode } = input;
  if (atMonth < 1 || atMonth >= tenureMonths) throw new Error("atMonth must be within the loan tenure");
  const r = monthlyRate(annualRatePct);

  const base = amortizationSchedule({ principalPaise, annualRatePct, tenureMonths });
  const baselineInterest = totalInterestPaise(base);
  const baseEmi = emiPaise({ principalPaise, annualRatePct, tenureMonths });

  const interestBefore = base.slice(0, atMonth).reduce((s, x) => s + x.interestPaise, 0);
  const balanceAfter = base[atMonth - 1].closingBalancePaise;
  const newBalance = Math.max(0, balanceAfter - prepaymentPaise);

  if (mode === "reduce_tenure") {
    const { months, interestPaise } = payoffWithEmi(newBalance, r, baseEmi);
    const newTenureMonths = atMonth + months;
    return {
      interestSavedPaise: baselineInterest - (interestBefore + interestPaise),
      monthsSaved: tenureMonths - newTenureMonths,
      newTenureMonths,
    };
  }

  // reduce_emi: same remaining months, lower EMI.
  const remainingMonths = tenureMonths - atMonth;
  if (newBalance === 0) {
    return { interestSavedPaise: baselineInterest - interestBefore, monthsSaved: 0, newEmiPaise: 0 };
  }
  const newEmi = emiPaise({ principalPaise: newBalance, annualRatePct, tenureMonths: remainingMonths });
  const after = amortizationSchedule({ principalPaise: newBalance, annualRatePct, tenureMonths: remainingMonths });
  return {
    interestSavedPaise: baselineInterest - (interestBefore + totalInterestPaise(after)),
    monthsSaved: 0,
    newEmiPaise: newEmi,
  };
}
