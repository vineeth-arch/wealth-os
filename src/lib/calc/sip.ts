/**
 * SIP / step-up SIP future value + inflation-adjusted goal corpus. Integer paise; format at the view.
 * No deps. Mirrors the freefincal SIP convention.
 *
 * Contributions are made at the START of each month (annuity-due) and compound at the monthly rate
 * i = annualReturnPct/12/100. A step-up raises the monthly contribution by stepUpPct after every 12
 * months. FV scales linearly in the initial monthly amount, so requiredMonthlySip simply inverts it.
 *
 * ASSUMPTIONS (surfaced in the UI): a constant nominal (post-tax) return — a long-run average, not real
 * year-to-year market behaviour; goal corpus inflates today's cost at a constant rate. Educational, not
 * financial advice.
 */

/** Future value per 1 unit of the INITIAL monthly contribution (annuity-due, optional annual step-up). */
function sipFvFactor(annualReturnPct: number, months: number, stepUpPct: number): number {
  if (months <= 0) return 0;
  const i = annualReturnPct / 12 / 100;
  if (stepUpPct === 0) {
    if (i === 0) return months;
    return ((1 + i) * (Math.pow(1 + i, months) - 1)) / i;
  }
  let bal = 0;
  let monthly = 1;
  for (let m = 1; m <= months; m++) {
    bal += monthly;          // start-of-month contribution
    bal *= 1 + i;            // grows for the month
    if (m % 12 === 0) monthly *= 1 + stepUpPct / 100; // step up after each completed year
  }
  return bal;
}

export interface SipInput {
  monthlyPaise: number;
  annualReturnPct: number;
  months: number;
  stepUpPct: number;
}

/** Future value of a (step-up) SIP. */
export function sipFutureValue({ monthlyPaise, annualReturnPct, months, stepUpPct }: SipInput): number {
  return Math.round(monthlyPaise * sipFvFactor(annualReturnPct, months, stepUpPct));
}

/** Total amount contributed over the SIP (principal invested, before returns). */
export function sipInvestedPaise({ monthlyPaise, months, stepUpPct }: Omit<SipInput, "annualReturnPct">): number {
  let total = 0;
  let monthly = monthlyPaise;
  for (let m = 1; m <= months; m++) {
    total += monthly;
    if (m % 12 === 0) monthly = Math.round(monthly * (1 + stepUpPct / 100));
  }
  return total;
}

export interface GoalInput {
  targetTodayPaise: number;
  inflationPct: number;
  years: number;
}

/** Inflate today's goal cost to the goal date. */
export function goalCorpus({ targetTodayPaise, inflationPct, years }: GoalInput): number {
  return Math.round(targetTodayPaise * Math.pow(1 + inflationPct / 100, years));
}

export interface RequiredSipInput {
  targetPaise: number;
  annualReturnPct: number;
  months: number;
  stepUpPct: number;
}

/** Initial monthly SIP needed to reach `targetPaise` (rounded up so the goal is met). */
export function requiredMonthlySip({ targetPaise, annualReturnPct, months, stepUpPct }: RequiredSipInput): number {
  const factor = sipFvFactor(annualReturnPct, months, stepUpPct);
  if (factor <= 0) return 0;
  return Math.ceil(targetPaise / factor);
}
