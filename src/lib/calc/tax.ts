/**
 * Indian income-tax regime comparison (salaried, v1). Integer paise throughout; format at the view.
 *
 * Slabs were VERIFIED via web search at build time (do NOT edit from memory). They are for
 * FY 2025-26 (AY 2026-27); Budget 2026 announced the SAME slabs for FY 2026-27 (no change). Sources:
 *   - https://cleartax.in/s/income-tax-slabs
 *   - https://www.bajajfinserv.in/investments/income-tax-slabs
 *   - https://upstox.com/news/personal-finance/tax/income-tax-slab-rate-2026-27-union-budget-changes-live-updates/liveblog-188650/
 *
 * LIMITATION (documented deferral): §87A is applied as the plain rebate cutoff. Marginal relief just
 * above the rebate threshold — and the new-regime special marginal-relief band — are NOT modelled in
 * v1. Surcharge is applied at the slab thresholds without marginal relief. These refinements are
 * deferred (see README). A wrong slab is worse than none, so the slab tables above are the spec.
 */

const L = 100_000;   // one lakh, in rupees
const RUPEE = 100;   // paise per rupee

interface Slab { upToRupees: number | null; rate: number } // upToRupees === null ⇒ no upper bound

// New regime (FY 2025-26 / FY 2026-27)
const NEW_SLABS: Slab[] = [
  { upToRupees: 4 * L, rate: 0 },
  { upToRupees: 8 * L, rate: 0.05 },
  { upToRupees: 12 * L, rate: 0.10 },
  { upToRupees: 16 * L, rate: 0.15 },
  { upToRupees: 20 * L, rate: 0.20 },
  { upToRupees: 24 * L, rate: 0.25 },
  { upToRupees: null, rate: 0.30 },
];
// Old regime, individuals below 60
const OLD_SLABS: Slab[] = [
  { upToRupees: 2.5 * L, rate: 0 },
  { upToRupees: 5 * L, rate: 0.05 },
  { upToRupees: 10 * L, rate: 0.20 },
  { upToRupees: null, rate: 0.30 },
];

export const STD_DEDUCTION_NEW_PAISE = 75_000 * RUPEE;
export const STD_DEDUCTION_OLD_PAISE = 50_000 * RUPEE;
const CESS_RATE = 0.04;

export type Regime = "new" | "old";

export interface RegimeResult {
  regime: Regime;
  taxablePaise: number;
  slabTaxPaise: number;   // before rebate
  rebatePaise: number;    // §87A
  surchargePaise: number;
  cessPaise: number;      // 4% health & education cess
  totalTaxPaise: number;
}

/** Progressive slab tax on taxable income (paise) → tax (paise), before rebate/surcharge/cess. */
function slabTax(taxablePaise: number, slabs: Slab[]): number {
  let tax = 0;
  let prev = 0;
  for (const s of slabs) {
    const cap = s.upToRupees === null ? Infinity : s.upToRupees * RUPEE;
    if (taxablePaise > prev) {
      const amt = Math.min(taxablePaise, cap) - prev;
      tax += Math.round(amt * s.rate);
    }
    if (taxablePaise <= cap) break;
    prev = cap;
  }
  return tax;
}

/** Surcharge rate on income-tax. New regime caps the top rate at 25%. */
function surchargeRate(taxablePaise: number, regime: Regime): number {
  const inc = taxablePaise / RUPEE; // rupees
  if (inc > 5 * 1e7) return regime === "new" ? 0.25 : 0.37; // > ₹5 Cr
  if (inc > 2 * 1e7) return 0.25;                            // > ₹2 Cr
  if (inc > 1e7) return 0.15;                                // > ₹1 Cr
  if (inc > 5e6) return 0.10;                                // > ₹50 L
  return 0;
}

/** Full tax for one regime given taxable income (paise). */
export function computeRegime(taxablePaise: number, regime: Regime): RegimeResult {
  const slabs = regime === "new" ? NEW_SLABS : OLD_SLABS;
  const slabTaxPaise = slabTax(taxablePaise, slabs);

  // §87A rebate (plain cutoff — see LIMITATION above)
  let rebatePaise = 0;
  if (regime === "new" && taxablePaise <= 12 * L * RUPEE) rebatePaise = Math.min(slabTaxPaise, 60_000 * RUPEE);
  if (regime === "old" && taxablePaise <= 5 * L * RUPEE) rebatePaise = Math.min(slabTaxPaise, 12_500 * RUPEE);

  const afterRebate = slabTaxPaise - rebatePaise;
  const surchargePaise = Math.round(afterRebate * surchargeRate(taxablePaise, regime));
  const cessPaise = Math.round((afterRebate + surchargePaise) * CESS_RATE);
  return {
    regime, taxablePaise, slabTaxPaise, rebatePaise, surchargePaise, cessPaise,
    totalTaxPaise: afterRebate + surchargePaise + cessPaise,
  };
}

export interface TaxInput {
  grossSalaryPaise: number;
  /** Old-regime deductions beyond the standard deduction: 80C, HRA exemption, home-loan interest, … */
  oldRegimeDeductionsPaise?: number;
}
export interface TaxComparison {
  new: RegimeResult;
  old: RegimeResult;
  cheaper: Regime;
  savingPaise: number;
}

/** Compare both regimes for a salaried taxpayer. Standard deduction is applied automatically. */
export function compareRegimes(input: TaxInput): TaxComparison {
  const newTaxable = Math.max(0, input.grossSalaryPaise - STD_DEDUCTION_NEW_PAISE);
  const oldTaxable = Math.max(0, input.grossSalaryPaise - STD_DEDUCTION_OLD_PAISE - (input.oldRegimeDeductionsPaise ?? 0));
  const newResult = computeRegime(newTaxable, "new");
  const oldResult = computeRegime(oldTaxable, "old");
  const cheaper: Regime = newResult.totalTaxPaise <= oldResult.totalTaxPaise ? "new" : "old";
  return { new: newResult, old: oldResult, cheaper, savingPaise: Math.abs(newResult.totalTaxPaise - oldResult.totalTaxPaise) };
}
