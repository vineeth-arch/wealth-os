/**
 * Money Box Compass — proprietor lens engine. Pure functions, no framework imports, fully testable.
 * Money is integer paise. Sign: + = inflow to account, − = outflow.
 *
 * One pool, two lenses, category-driven. Lenses are derived ONLY from the category parent bucket
 * (and, for business income, the leaf name) — never from the account type. A "drawing" (business
 * money used personally) is a parent-10 transfer: category-neutral, net-worth-neutral, neither lens.
 *
 * Reuses the Halan prefix→class mapping in halan.ts so parent renames never break the math.
 */

import { classifyParent, type BucketClass, type TxnLike } from "./halan";

/** Trailing window for the lumpy proprietor income. All ratios are stated over this window. */
export const TRAILING_WINDOW_MONTHS = 6;

/**
 * Business-income leaves under parent `01 Income` (resolved from the seed taxonomy, not invented).
 * Everything else under 01 (interest, dividend, rent, salary, bonus, refunds…) is "other" income.
 */
export const BUSINESS_INCOME_LEAVES: ReadonlySet<string> = new Set<string>([
  "Business Income", "Consulting Income", "Design Project Income", "Freelance Income", "Retainer Income",
]);

/**
 * Personal spend = real consumption. SPEND_CLASSES minus work(11) and tax(12) — those are the
 * business lens — and minus protect(04), which is counted as savings/foundation (see personalSavings).
 */
export const PERSONAL_SPEND_CLASSES: ReadonlySet<BucketClass> = new Set<BucketClass>([
  "needs", "wants", "debt", "planned_needs", "planned_wants", "family", "leakage_watch",
]);

/** A transaction enriched with its category leaf name — business income needs the leaf, not just the parent. */
export interface CompassTxn extends TxnLike {
  categoryName: string;   // leaf category name, or "" when uncategorized
}

/** The proprietor identity, as period totals (paise) over whatever txns were passed in. */
export interface LensTotals {
  allIncome: number;              // Σ all 01 inflows
  businessRevenue: number;        // Σ inflows whose leaf ∈ BUSINESS_INCOME_LEAVES (parent 01)
  businessCosts: number;          // Σ outflows parent 11
  businessProfit: number;         // businessRevenue − businessCosts
  tax: number;                    // Σ outflows parent 12
  businessProfitAfterTax: number; // businessProfit − tax
  otherIncome: number;            // allIncome − businessRevenue
  personalIncome: number;         // allIncome − businessCosts − tax  (== businessProfitAfterTax + otherIncome)
  personalSpend: number;          // Σ outflows in PERSONAL_SPEND_CLASSES
  personalSavings: number;        // Σ outflows parent 08 + parent 04
  investOutflow: number;          // Σ outflows parent 08
  protectOutflow: number;         // Σ outflows parent 04
  emiOutflow: number;             // Σ outflows parent 05 (debt) — for the H1 EMI ratio
  wantsOutflow: number;           // Σ outflows parent 03 — for the Mirror enjoyment-floor nudge
  transferInflow: number;         // parent 10 inflows (excluded from both lenses; sanity only)
  transferOutflow: number;        // parent 10 outflows (excluded from both lenses; sanity only)
  leftover: number;               // personalIncome − personalSpend − personalSavings (unrouted cash)
}

const ZERO: LensTotals = {
  allIncome: 0, businessRevenue: 0, businessCosts: 0, businessProfit: 0, tax: 0,
  businessProfitAfterTax: 0, otherIncome: 0, personalIncome: 0, personalSpend: 0,
  personalSavings: 0, investOutflow: 0, protectOutflow: 0, emiOutflow: 0, wantsOutflow: 0,
  transferInflow: 0, transferOutflow: 0, leftover: 0,
};

/** Period totals for the proprietor identity over the given transactions. Each parent is counted once. */
export function lensTotals(txns: CompassTxn[]): LensTotals {
  const t: LensTotals = { ...ZERO };
  for (const x of txns) {
    const cls = classifyParent(x.parent);
    if (x.amountPaise > 0) {
      const inflow = x.amountPaise;
      if (cls === "income") {
        t.allIncome += inflow;
        if (BUSINESS_INCOME_LEAVES.has(x.categoryName)) t.businessRevenue += inflow;
      } else if (cls === "transfer") {
        t.transferInflow += inflow;
      }
      // inflows in any other bucket (refund into a spend category, sale in invest, etc.) are not income
      continue;
    }
    const out = -x.amountPaise;
    if (out === 0) continue;
    switch (cls) {
      case "work": t.businessCosts += out; break;
      case "tax": t.tax += out; break;
      case "invest": t.investOutflow += out; break;
      case "protect": t.protectOutflow += out; break;
      case "transfer": t.transferOutflow += out; break;
      default:
        if (PERSONAL_SPEND_CLASSES.has(cls)) {
          t.personalSpend += out;
          if (cls === "wants") t.wantsOutflow += out;
          if (cls === "debt") t.emiOutflow += out;
        }
        // income(01)/assets(09)/review(15) outflows fall through — not a lens line, surface via leftover
    }
  }
  t.businessProfit = t.businessRevenue - t.businessCosts;
  t.businessProfitAfterTax = t.businessProfit - t.tax;
  t.otherIncome = t.allIncome - t.businessRevenue;
  t.personalIncome = t.allIncome - t.businessCosts - t.tax;
  t.personalSavings = t.investOutflow + t.protectOutflow;
  t.leftover = t.personalIncome - t.personalSpend - t.personalSavings;
  return t;
}

/** Divide every paise field of a LensTotals by n (rounded) — the per-month average over the window. */
export function scaleTotals(t: LensTotals, n: number): LensTotals {
  if (n <= 0) return { ...ZERO };
  const out = {} as LensTotals;
  for (const k of Object.keys(t) as (keyof LensTotals)[]) out[k] = Math.round(t[k] / n);
  return out;
}

export interface MonthLens extends LensTotals { month: string; }

export interface CompassWindow {
  monthsRequested: number;
  monthsCovered: number;        // distinct months actually present in the window
  months: string[];             // window months, ascending
  totals: LensTotals;           // period totals over the window
  avg: LensTotals;              // per-month average (totals / monthsCovered)
  perMonth: MonthLens[];        // one LensTotals per window month, ascending — for series/sparklines
}

/** Distinct YYYY-MM present in the txns, ascending. */
export function txnMonths(txns: CompassTxn[]): string[] {
  const s = new Set<string>();
  for (const x of txns) s.add(x.txnDate.slice(0, 7));
  return [...s].sort();
}

/**
 * Trailing-window view: the last `n` months that actually have data. Income is lumpy, so everything
 * is averaged across the covered months; <n months computes on what exists and reports monthsCovered.
 */
export function computeWindow(txns: CompassTxn[], n: number = TRAILING_WINDOW_MONTHS): CompassWindow {
  const allMonths = txnMonths(txns);
  const months = allMonths.slice(-n);
  const inWindow = new Set(months);
  const windowTxns = txns.filter((x) => inWindow.has(x.txnDate.slice(0, 7)));
  const totals = lensTotals(windowTxns);
  const monthsCovered = months.length;
  const perMonth: MonthLens[] = months.map((m) => ({
    month: m, ...lensTotals(windowTxns.filter((x) => x.txnDate.slice(0, 7) === m)),
  }));
  return { monthsRequested: n, monthsCovered, months, totals, avg: scaleTotals(totals, monthsCovered), perMonth };
}

/**
 * Reconciliation: the identity must close. leftover (returned by lensTotals) is the unrouted cash;
 * here we independently re-derive it from the raw class sums and assert the two agree, so a category
 * gap or a double-count surfaces instead of being papered over.
 */
export interface Reconciliation {
  closes: boolean;
  leftoverPaise: number;          // personalIncome − personalSpend − personalSavings
  recomputedLeftoverPaise: number;// allIncome − costs − tax − spend − invest − protect
  identityHolds: boolean;         // personalIncome === businessProfitAfterTax + otherIncome
}

export function reconcile(t: LensTotals): Reconciliation {
  const recomputed = t.allIncome - t.businessCosts - t.tax - t.personalSpend - t.investOutflow - t.protectOutflow;
  return {
    leftoverPaise: t.leftover,
    recomputedLeftoverPaise: recomputed,
    closes: recomputed === t.leftover,
    identityHolds: t.personalIncome === t.businessProfitAfterTax + t.otherIncome,
  };
}

/** Categorization sanity flags — surfaced plainly, never silently corrected. */
export interface SanityFlags {
  spendExceedsIncome: boolean;    // personalSpend > personalIncome by a wide margin
  noTransfers: boolean;           // parent-10 transfers ~zero (CC bill pays / investing transfers should exist)
  largeLeftover: boolean;         // |leftover| implausibly large vs income (likely a category gap)
  messages: string[];
}

// ───────────────────────────────────────────────────────────────────────────
// The Machine — H1–H3 (the numbers). R/A/G bands; thresholds are the spec.
// All ratios are computed on per-month averages (avg LensTotals); a ratio is
// scale-invariant so window totals would give the same percentage.
// ───────────────────────────────────────────────────────────────────────────

export type Band = "red" | "amber" | "green";

/** Higher is better: green at/above `green`, amber at/above `amber`, else red. */
export function bandHigher(v: number, green: number, amber: number): Band {
  return v >= green ? "green" : v >= amber ? "amber" : "red";
}
/** Lower is better: green at/below `green`, amber at/below `amber`, else red. */
export function bandLower(v: number, green: number, amber: number): Band {
  return v <= green ? "green" : v <= amber ? "amber" : "red";
}

export interface RatioCheck {
  pct: number | null;        // null when the denominator (personal income) is unavailable
  band: Band | null;         // null = insufficient data → "categorize first"
  gapToGreenPaise: number;   // per-month rupees-as-paise needed to reach the green band (0 if green/na)
}

const naRatio: RatioCheck = { pct: null, band: null, gapToGreenPaise: 0 };

export interface MachineRatios {
  saveRate: RatioCheck;      // personalSavings ÷ personalIncome — green ≥20, amber 15–20, red <15
  emiLoad: RatioCheck;       // parent-05 EMI ÷ personalIncome — green ≤25, amber 25–30, red >30
  livingCost: RatioCheck;    // personalSpend ÷ personalIncome — green ≤50, amber 50–60, red >60
}

/** H1 — cash-flow ratios (the surplus engine). `avg` is per-month average LensTotals. */
export function machineH1(avg: LensTotals): MachineRatios {
  const inc = avg.personalIncome;
  if (inc <= 0) return { saveRate: naRatio, emiLoad: naRatio, livingCost: naRatio };
  const saveRatePct = (avg.personalSavings / inc) * 100;
  const emiPct = (avg.emiOutflow / inc) * 100;
  const livingPct = (avg.personalSpend / inc) * 100;
  return {
    saveRate: { pct: saveRatePct, band: bandHigher(saveRatePct, 20, 15), gapToGreenPaise: Math.max(0, Math.round(inc * 0.2) - avg.personalSavings) },
    emiLoad: { pct: emiPct, band: bandLower(emiPct, 25, 30), gapToGreenPaise: Math.max(0, avg.emiOutflow - Math.round(inc * 0.25)) },
    livingCost: { pct: livingPct, band: bandLower(livingPct, 50, 60), gapToGreenPaise: Math.max(0, avg.personalSpend - Math.round(inc * 0.5)) },
  };
}

export interface EmergencyFundCheck {
  months: number | null;     // liquid cash ÷ avg monthly personal spend
  band: Band | null;
  targetMonths: number;      // self-employed target = 6 (lumpy income)
  gapToTargetPaise: number;  // cash still needed to reach the 6-month target
}

/**
 * H2 — emergency fund (the foundation). Liquid = bank-kind balances ONLY (cash that survives a
 * market crash); broker/asset_snapshot excluded. Self-employed target 6 months: green ≥6, amber 3–6,
 * red <3. Distinct from the Mirror's freedom ratio, which includes investments.
 */
export function machineH2(avg: LensTotals, liquidCashPaise: number): EmergencyFundCheck {
  const target = 6;
  if (avg.personalSpend <= 0) return { months: null, band: null, targetMonths: target, gapToTargetPaise: 0 };
  const months = liquidCashPaise / avg.personalSpend;
  return {
    months, band: bandHigher(months, 6, 3), targetMonths: target,
    gapToTargetPaise: Math.max(0, Math.round(target * avg.personalSpend) - liquidCashPaise),
  };
}

/** Protection leaves under parent 04 that count as real cover (resolved from the seed taxonomy). */
export const TERM_PROTECTION_LEAVES: ReadonlySet<string> = new Set<string>(["Term Insurance Premium"]);
export const HEALTH_PROTECTION_LEAVES: ReadonlySet<string> = new Set<string>(["Health Insurance Premium", "Critical Illness Cover"]);

export interface ProtectionStatus {
  termPresent: boolean;
  healthPresent: boolean;
  anyPresent: boolean;
  band: Band;                // present → green; none detected → red (coverage AMOUNT is confirmed manually)
}

/** H3 — protection funded (the shield). Presence detection only; the coverage gap (vs HLV) is manual. */
export function machineH3(txns: CompassTxn[]): ProtectionStatus {
  let termPresent = false, healthPresent = false;
  for (const x of txns) {
    if (x.amountPaise >= 0 || classifyParent(x.parent) !== "protect") continue;
    if (TERM_PROTECTION_LEAVES.has(x.categoryName)) termPresent = true;
    if (HEALTH_PROTECTION_LEAVES.has(x.categoryName)) healthPresent = true;
  }
  const anyPresent = termPresent || healthPresent;
  return { termPresent, healthPresent, anyPresent, band: anyPresent ? "green" : "red" };
}

export function sanityFlags(t: LensTotals): SanityFlags {
  const income = t.personalIncome;
  const spendExceedsIncome = income > 0 && t.personalSpend > income * 1.5;
  const noTransfers = t.transferInflow + t.transferOutflow === 0;
  const largeLeftover = income > 0 && Math.abs(t.leftover) > income * 0.5;
  const messages: string[] = [];
  if (spendExceedsIncome) messages.push("Personal spend far exceeds personal income — check categorization (income may be miscoded or transfers leaking into spend).");
  if (noTransfers) messages.push("No parent-10 transfers found — CC bill payments and investing transfers usually live here; some movements may be miscategorized as spend.");
  if (largeLeftover) messages.push("Large unrouted leftover vs income — likely a category gap (money parked in 09 Assets / 15 Review, or income not yet split to spend/savings).");
  return { spendExceedsIncome, noTransfers, largeLeftover, messages };
}
