/**
 * Retirement / FIRE corpus + SWP drawdown. Integer paise; format at the view. No deps.
 *
 * fireCorpus: inflate today's annual expense to the retirement date, then divide by the safe-withdrawal
 * rate (SWR) to get the corpus needed — the freefincal "freedom number". freedomRatio = current corpus /
 * target corpus (1.0 ⇒ financially independent).
 *
 * swpDrawdown: a Systematic Withdrawal Plan, year by year and SEQUENCE-OF-RETURNS aware — the inflation-
 * indexed withdrawal is taken at the START of the year, then the remainder grows at the nominal return.
 * Reports the year the corpus depletes (if any) and how many years it lasted.
 *
 * ASSUMPTIONS (surfaced in the UI): constant inflation and nominal return (a smoothed average, not real
 * year-to-year volatility); SWR typically 3–4% for an Indian retiree; post-tax figures. Educational, not
 * financial advice.
 */

export interface FireInput {
  annualExpensePaise: number;
  inflationPct: number;
  yearsToRetire: number;
  swrPct: number;
  currentCorpusPaise?: number;
}
export interface FireResult {
  futureAnnualExpensePaise: number;
  targetCorpusPaise: number;
  currentCorpusPaise: number;
  freedomRatio: number;        // current / target (0 when target is 0)
}

export function fireCorpus(input: FireInput): FireResult {
  const { annualExpensePaise, inflationPct, yearsToRetire, swrPct } = input;
  if (swrPct <= 0) throw new Error("swrPct must be positive");
  const current = Math.max(0, Math.round(input.currentCorpusPaise ?? 0));
  const inflationFactor = Math.pow(1 + inflationPct / 100, yearsToRetire);
  const futureAnnualExpensePaise = Math.round(annualExpensePaise * inflationFactor);
  const targetCorpusPaise = Math.round(futureAnnualExpensePaise / (swrPct / 100));
  const freedomRatio = targetCorpusPaise === 0 ? 0 : current / targetCorpusPaise;
  return { futureAnnualExpensePaise, targetCorpusPaise, currentCorpusPaise: current, freedomRatio };
}

export interface SwpInput {
  corpusPaise: number;
  annualWithdrawalPaise: number;   // first-year withdrawal; grows with inflation each year
  nominalReturnPct: number;
  inflationPct: number;
  years: number;
}
export interface SwpRow {
  year: number;
  openingPaise: number;
  withdrawalPaise: number;
  growthPaise: number;
  closingPaise: number;
}
export interface SwpResult {
  rows: SwpRow[];
  depletedYear: number | null;     // first year the corpus hits 0 (null ⇒ survived all `years`)
  yearsLasted: number;
}

export function swpDrawdown(input: SwpInput): SwpResult {
  const { corpusPaise, nominalReturnPct, inflationPct, years } = input;
  const rows: SwpRow[] = [];
  let balance = Math.max(0, Math.round(corpusPaise));
  let withdrawal = Math.max(0, Math.round(input.annualWithdrawalPaise));
  let depletedYear: number | null = null;

  for (let year = 1; year <= years; year++) {
    const opening = balance;
    const w = Math.min(withdrawal, opening);          // cannot withdraw more than is left
    const afterWithdraw = opening - w;
    const growth = Math.round(afterWithdraw * (nominalReturnPct / 100));
    const closing = afterWithdraw + growth;
    rows.push({ year, openingPaise: opening, withdrawalPaise: w, growthPaise: growth, closingPaise: closing });
    balance = closing;
    if (balance <= 0) { depletedYear = year; break; }
    withdrawal = Math.round(withdrawal * (1 + inflationPct / 100));
  }
  return { rows, depletedYear, yearsLasted: depletedYear ?? years };
}
