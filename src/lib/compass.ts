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

import { classifyParent, leakageByParent, accountBalances, type BucketClass, type TxnLike, type AccountLike } from "./halan";

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

// ───────────────────────────────────────────────────────────────────────────
// The Machine — H4–H6 (engine running · diversification · scoreboard).
// ───────────────────────────────────────────────────────────────────────────

export interface InvestConsistency {
  monthsCovered: number;
  monthsInvested: number;            // window months with a parent-08 outflow
  skipped: number;
  totalInvestPaise: number;
  series: Array<{ month: string; investPaise: number }>;
  band: Band | null;                 // null when there are no months at all
}

/**
 * H4 — investing consistency. Green = invested EVERY window month AND save rate is green; Amber =
 * irregular (some months zero) or regular but save rate not yet green; Red = entirely zero.
 */
export function machineH4(window: CompassWindow, saveRateBand: Band | null): InvestConsistency {
  const series = window.perMonth.map((m) => ({ month: m.month, investPaise: m.investOutflow }));
  const monthsInvested = series.filter((s) => s.investPaise > 0).length;
  const monthsCovered = window.monthsCovered;
  let band: Band | null;
  if (monthsCovered === 0) band = null;
  else if (monthsInvested === 0) band = "red";
  else if (monthsInvested === monthsCovered && saveRateBand === "green") band = "green";
  else band = "amber";
  return { monthsCovered, monthsInvested, skipped: monthsCovered - monthsInvested, totalInvestPaise: window.totals.investOutflow, series, band };
}

export interface HoldingValue { name: string; assetClass: string; valuePaise: number; }

export interface Allocation {
  totalPaise: number;
  top: { name: string; assetClass: string; pct: number } | null;
  band: Band | null;                 // concentration of the single largest holding
  topHoldings: Array<{ name: string; assetClass: string; valuePaise: number; pct: number }>;
  byClass: Array<{ assetClass: string; valuePaise: number; pct: number }>;  // honest per-asset_class split
}

/**
 * H5 — allocation / concentration. Always computes the largest single holding as a % of total
 * (green <20, amber 20–40, red >40). Asset-class split is the real `instruments.asset_class` signal —
 * shown as-is, never fabricated.
 */
export function machineH5(holdings: HoldingValue[]): Allocation {
  const totalPaise = holdings.reduce((s, h) => s + h.valuePaise, 0);
  if (totalPaise <= 0) return { totalPaise: 0, top: null, band: null, topHoldings: [], byClass: [] };
  const topHoldings = [...holdings]
    .map((h) => ({ ...h, pct: (h.valuePaise / totalPaise) * 100 }))
    .sort((a, b) => b.valuePaise - a.valuePaise);
  const classMap = new Map<string, number>();
  for (const h of holdings) classMap.set(h.assetClass, (classMap.get(h.assetClass) ?? 0) + h.valuePaise);
  const byClass = [...classMap.entries()]
    .map(([assetClass, valuePaise]) => ({ assetClass, valuePaise, pct: (valuePaise / totalPaise) * 100 }))
    .sort((a, b) => b.valuePaise - a.valuePaise);
  const top = topHoldings[0];
  const band: Band = top.pct < 20 ? "green" : top.pct <= 40 ? "amber" : "red";
  return { totalPaise, top: { name: top.name, assetClass: top.assetClass, pct: top.pct }, band, topHoldings, byClass };
}

export interface LeakageCheck {
  pct: number | null;                // total leakage ÷ personal spend (over the window)
  band: Band | null;
  totalLeakagePaise: number;
  byParent: Array<{ parent: string; paise: number; count: number }>;
}

/** H6a — leakage (the tag, not a bucket) as a share of personal spend. Green <5, amber 5–10, red >10. */
export function machineH6Leakage(windowTxns: CompassTxn[], windowTotals: LensTotals): LeakageCheck {
  const byParent = leakageByParent(windowTxns);
  const totalLeakagePaise = byParent.reduce((s, x) => s + x.paise, 0);
  if (windowTotals.personalSpend <= 0) return { pct: null, band: null, totalLeakagePaise, byParent };
  const pct = (totalLeakagePaise / windowTotals.personalSpend) * 100;
  const band: Band = pct < 5 ? "green" : pct <= 10 ? "amber" : "red";
  return { pct, band, totalLeakagePaise, byParent };
}

export interface NetWorthPoint { month: string; netWorthPaise: number; }
export interface NetWorthTrend {
  series: NetWorthPoint[];
  band: Band | null;                 // null when <2 monthly points
  direction: "up" | "flat" | "down" | null;
  changePaise: number;               // last − first over the window
}

/**
 * Month-end cash net worth per window month, derived from anchors + cumulative transactions
 * (the dashboard's accountBalances). Historical holdings valuation isn't stored, so this is the
 * CASH/account trajectory — the caller should say so. ≥2 points required for a trend.
 */
export function netWorthSeries(
  accounts: AccountLike[],
  txns: Array<{ accountId: string; txnDate: string; amountPaise: number }>,
  months: string[],
): NetWorthTrend {
  const series: NetWorthPoint[] = months.map((m) => {
    const upTo = txns.filter((t) => t.txnDate <= `${m}-31`);
    return { month: m, netWorthPaise: accountBalances(accounts, upTo).netWorthPaise };
  });
  if (series.length < 2) return { series, band: null, direction: null, changePaise: 0 };
  const first = series[0].netWorthPaise, last = series[series.length - 1].netWorthPaise;
  const changePaise = last - first;
  const flatThreshold = Math.max(Math.abs(first) * 0.01, 100); // 1% of base, floor ₹1
  const direction = Math.abs(changePaise) < flatThreshold ? "flat" : changePaise > 0 ? "up" : "down";
  const band: Band = direction === "up" ? "green" : direction === "flat" ? "amber" : "red";
  return { series, band, direction, changePaise };
}

// ───────────────────────────────────────────────────────────────────────────
// The Mirror — reflection checklist + persisted profile (Pass 5).
// ───────────────────────────────────────────────────────────────────────────

/** The 7 monthly/quarterly reflections — stable keys so saved answers survive copy edits. */
export const REFLECTIONS: ReadonlyArray<{ key: string; text: string }> = [
  { key: "r1", text: "Chasing the lifestyle of the group just above me?" },
  { key: "r2", text: "Spending for status or utility?" },
  { key: "r3", text: "Buying independence or eroding it?" },
  { key: "r4", text: "Comparing my inside to others' outside?" },
  { key: "r5", text: "Over-saving so I never enjoy a life I can afford?" },
  { key: "r6", text: "Expectations growing faster than income?" },
  { key: "r7", text: "Found my “thing” and cut the rest?" },
];

/** Persisted in public.profile.data (jsonb). No money lives here — preferences/behaviour only. */
export interface CompassProfile {
  checklist: Record<string, boolean>;
  asOf: string;                  // ISO date the checklist was last reviewed
  goalReturnAssumption: number;  // expected real return % used by goal planning (default 8)
}

export function emptyProfile(): CompassProfile {
  return { checklist: {}, asOf: "", goalReturnAssumption: 8 };
}

// ───────────────────────────────────────────────────────────────────────────
// The Mirror — computable Housel signals (the behaviour). Reflection, not scoring.
// ───────────────────────────────────────────────────────────────────────────

export interface FreedomRatio {
  months: number | null;             // total liquid net worth (incl. investments) ÷ avg monthly spend
  liquidNetWorthPaise: number;
}

/**
 * Freedom ratio — months you could fund your life with zero income, counting investments too.
 * Deliberately broader than H2's cash-only emergency fund (independence is the highest dividend).
 */
export function freedomRatio(avg: LensTotals, cashNetWorthPaise: number, holdingsValuePaise: number): FreedomRatio {
  const liquidNetWorthPaise = cashNetWorthPaise + holdingsValuePaise;
  if (avg.personalSpend <= 0) return { months: null, liquidNetWorthPaise };
  return { months: liquidNetWorthPaise / avg.personalSpend, liquidNetWorthPaise };
}

export interface LifestyleCreep {
  spendGrowthPct: number | null;     // % change, first half vs second half of the window
  incomeGrowthPct: number | null;
  creepPct: number | null;           // spendGrowth − incomeGrowth (positive = creep)
  band: Band | null;                 // green ≤0, amber ≤10, red >10
}

/**
 * Lifestyle-creep — does spending grow faster than income? Compares the first vs second half of the
 * window (halves smooth the lumpy proprietor income). Needs ≥2 covered months.
 */
export function lifestyleCreep(window: CompassWindow): LifestyleCreep {
  const pm = window.perMonth;
  if (pm.length < 2) return { spendGrowthPct: null, incomeGrowthPct: null, creepPct: null, band: null };
  const mid = Math.floor(pm.length / 2);
  const first = pm.slice(0, mid), second = pm.slice(mid);
  const avgOf = (rows: MonthLens[], key: "personalSpend" | "personalIncome") =>
    rows.reduce((s, r) => s + r[key], 0) / rows.length;
  const growth = (a: number, b: number) => (a <= 0 ? (b > 0 ? 100 : 0) : ((b - a) / a) * 100);
  const spendGrowthPct = growth(avgOf(first, "personalSpend"), avgOf(second, "personalSpend"));
  const incomeGrowthPct = growth(avgOf(first, "personalIncome"), avgOf(second, "personalIncome"));
  const creepPct = spendGrowthPct - incomeGrowthPct;
  return { spendGrowthPct, incomeGrowthPct, creepPct, band: bandLower(creepPct, 0, 10) };
}

export interface EnjoymentFloor {
  triggered: boolean;                // saving hard but spending almost nothing on wants
  saveRatePct: number | null;
  wantsSharePct: number | null;
}

/** Enjoyment floor — Housel's counterweight to Halan: if you over-save and barely enjoy, a gentle nudge. */
export function enjoymentFloor(avg: LensTotals): EnjoymentFloor {
  const inc = avg.personalIncome;
  if (inc <= 0) return { triggered: false, saveRatePct: null, wantsSharePct: null };
  const saveRatePct = (avg.personalSavings / inc) * 100;
  const wantsSharePct = (avg.wantsOutflow / inc) * 100;
  return { triggered: saveRatePct > 40 && wantsSharePct < 5, saveRatePct, wantsSharePct };
}

// ───────────────────────────────────────────────────────────────────────────
// Summary (Pass 6) — roll the Machine's H1–H6 into a R/A/G count + the single
// highest-priority next action (worst band first; Red before Amber).
// ───────────────────────────────────────────────────────────────────────────

const BAND_RANK: Record<Band, number> = { red: 0, amber: 1, green: 2 };

/** Worst (most urgent) band of a set, ignoring null (insufficient-data) checks. */
export function worstBand(bands: Array<Band | null>): Band | null {
  const present = bands.filter((b): b is Band => b !== null);
  if (present.length === 0) return null;
  return present.sort((a, b) => BAND_RANK[a] - BAND_RANK[b])[0];
}

export interface MachineCheckSummary { id: string; band: Band | null; action: string; }
export interface MachineSummary {
  counts: { red: number; amber: number; green: number; na: number };
  checks: MachineCheckSummary[];   // one per H1–H6 (H1/H6 collapse their sub-checks to the worst band)
  topAction: { id: string; band: Band; action: string } | null;
}

/**
 * Build the header summary. Each of H1–H6 contributes exactly one band (H1 = worst of its three
 * ratios; H6 = worst of leakage + net-worth trend). topAction is the action of the worst-banded
 * check across the Machine, Red before Amber.
 */
export function machineSummary(checks: MachineCheckSummary[]): MachineSummary {
  const counts = { red: 0, amber: 0, green: 0, na: 0 };
  for (const c of checks) {
    if (c.band === null) counts.na++;
    else counts[c.band]++;
  }
  const ranked = checks
    .filter((c): c is { id: string; band: Band; action: string } => c.band !== null && c.band !== "green")
    .sort((a, b) => BAND_RANK[a.band] - BAND_RANK[b.band]);
  return { counts, checks, topAction: ranked[0] ?? null };
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
