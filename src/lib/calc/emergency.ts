/**
 * Emergency-fund sizing. Integer paise; format at the view. No deps.
 *
 * Convention (freefincal / Monika Halan safety-net): the buffer is sized in MONTHS of essential
 * ("Spend-it Needs") expenses — typically 6, 9 or 12 months depending on income stability. The gap is
 * what is still missing versus current liquid (cash + sweep-FD + liquid-fund) assets.
 *
 * ASSUMPTIONS (surfaced in the UI): "monthly needs" = recurring essentials only (rent/EMI, utilities,
 * groceries, insurance, school fees), not discretionary wants. Educational, not financial advice.
 */

export const EMERGENCY_MONTH_OPTIONS = [6, 9, 12] as const;

export interface EmergencyInput {
  monthlyNeedsPaise: number;
  currentLiquidPaise: number;
}
export interface EmergencyTarget {
  months: number;
  targetPaise: number;
  gapPaise: number;      // shortfall vs current liquid, clamped ≥ 0
  fundedPct: number;     // current liquid as a % of this target (capped at 100)
}
export interface EmergencyResult {
  monthlyNeedsPaise: number;
  currentLiquidPaise: number;
  targets: EmergencyTarget[];
}

export function emergencyFund({ monthlyNeedsPaise, currentLiquidPaise }: EmergencyInput): EmergencyResult {
  const needs = Math.max(0, Math.round(monthlyNeedsPaise));
  const liquid = Math.max(0, Math.round(currentLiquidPaise));
  const targets: EmergencyTarget[] = EMERGENCY_MONTH_OPTIONS.map((months) => {
    const targetPaise = needs * months;
    const gapPaise = Math.max(0, targetPaise - liquid);
    const fundedPct = targetPaise === 0 ? 100 : Math.min(100, (liquid / targetPaise) * 100);
    return { months, targetPaise, gapPaise, fundedPct };
  });
  return { monthlyNeedsPaise: needs, currentLiquidPaise: liquid, targets };
}
