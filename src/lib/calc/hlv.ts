/**
 * Human Life Value (term-insurance need). Integer paise; format at the view. No deps.
 *
 * Two standard methods (freefincal):
 *  - Income-replacement: present value of the income the family would lose, i.e. future income NET of the
 *    earner's own consumption, over the remaining working years, discounted to today.
 *  - Expense + liabilities (needs) method: PV of the dependents' future expenses over the cover horizon,
 *    PLUS outstanding liabilities, MINUS assets already available. Future goals can be folded into either.
 *
 * Both return the sum assured needed, the existing cover, and the gap to close.
 *
 * ASSUMPTIONS (surfaced in the UI): the discount rate is REAL (net of income growth / inflation), so a
 * level stream approximates a growing one in today's money; level annual amounts; figures post-tax.
 * Educational, not financial advice.
 */

/** Present value of a level annual amount for `years`, discounted at `ratePct` (real). */
export function pvAnnuity(annualPaise: number, ratePct: number, years: number): number {
  if (years <= 0) return 0;
  const d = ratePct / 100;
  if (d === 0) return Math.round(annualPaise * years);
  return Math.round((annualPaise * (1 - Math.pow(1 + d, -years))) / d);
}

export interface HlvResult {
  needPaise: number;
  existingCoverPaise: number;
  gapPaise: number;      // need − existing cover, clamped ≥ 0
}

export interface IncomeReplacementInput {
  annualIncomePaise: number;
  ownConsumptionPct: number;   // share of income the earner spends on self (excluded from the need)
  workingYears: number;
  discountRatePct: number;     // real
  existingCoverPaise?: number;
}

export function hlvIncomeReplacement(input: IncomeReplacementInput): HlvResult {
  const netAnnual = Math.round(input.annualIncomePaise * (1 - input.ownConsumptionPct / 100));
  const needPaise = pvAnnuity(Math.max(0, netAnnual), input.discountRatePct, input.workingYears);
  const existingCoverPaise = Math.max(0, Math.round(input.existingCoverPaise ?? 0));
  return { needPaise, existingCoverPaise, gapPaise: Math.max(0, needPaise - existingCoverPaise) };
}

export interface ExpenseLiabilityInput {
  annualExpensePaise: number;          // dependents' annual expense to replace
  yearsToCover: number;
  discountRatePct: number;             // real
  outstandingLiabilitiesPaise: number; // loans to clear on death
  existingAssetsPaise: number;         // investments/savings already available to the family
  existingCoverPaise?: number;
}

export function hlvExpenseLiability(input: ExpenseLiabilityInput): HlvResult {
  const pvExpenses = pvAnnuity(Math.max(0, input.annualExpensePaise), input.discountRatePct, input.yearsToCover);
  const needPaise = Math.max(0, pvExpenses + Math.max(0, input.outstandingLiabilitiesPaise) - Math.max(0, input.existingAssetsPaise));
  const existingCoverPaise = Math.max(0, Math.round(input.existingCoverPaise ?? 0));
  return { needPaise, existingCoverPaise, gapPaise: Math.max(0, needPaise - existingCoverPaise) };
}
