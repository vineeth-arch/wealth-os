/**
 * Reconstructs the same dashboard aggregates as halan.ts's per-transaction functions, but from
 * PRE-GROUPED rows (a mechanical `GROUP BY category_id, month, is_leakage, is_positive` — see
 * migration 0011's `dashboard_category_month_totals()`) instead of the full transaction drain.
 *
 * All Halan bucket-classification logic (classifyParent, SPEND_CLASSES, LEAKAGE_TAG) stays exactly
 * where it already lives and is already gate-tested — this module only re-derives the SAME sums a
 * different way. The equivalence is proven paise-exact in scripts/verify.ts (HALAN-AGG section): a
 * synthetic per-txn dataset is fed through halan.ts directly AND through a pure group-by simulation +
 * this module, and the two outputs must match exactly.
 */
import {
  classifyParent, SPEND_CLASSES, LEAKAGE_TAG, type BucketTotal, type MonthlyFlow,
  type AccountLike, type AccountBalance,
} from "./halan.js";

export interface CategoryMonthGroup {
  categoryId: string | null;
  month: string;        // YYYY-MM
  isLeakage: boolean;    // tags @> '{leakage}'
  isPositive: boolean;   // amount_paise >= 0
  amountSumPaise: number; // signed sum over the group (all members share the same sign)
  txnCount: number;
}

/** category_id → its bucket's parent name (a leaf's own parent, or a parent's own name). Same shape
 *  as the `parentByCatId` map already built in dashboard/page.tsx and compass/page.tsx. */
export type ParentById = ReadonlyMap<string, string>;

function parentOf(categoryId: string | null, parentById: ParentById): string | null {
  return categoryId ? (parentById.get(categoryId) ?? null) : null;
}

export function bucketTotalsFromGroups(groups: CategoryMonthGroup[], parentById: ParentById): BucketTotal[] {
  const map = new Map<string, BucketTotal>();
  for (const g of groups) {
    const parentName = parentOf(g.categoryId, parentById);
    const parent = parentName ?? "(uncategorized)";
    const cls = classifyParent(parentName);
    const cur = map.get(parent) ?? { parent, cls, inflowPaise: 0, outflowPaise: 0, netPaise: 0, count: 0 };
    if (g.isPositive) cur.inflowPaise += g.amountSumPaise; else cur.outflowPaise += -g.amountSumPaise;
    cur.netPaise += g.amountSumPaise;
    cur.count += g.txnCount;
    map.set(parent, cur);
  }
  return [...map.values()].sort((a, b) => a.parent.localeCompare(b.parent));
}

export function monthlyCashFlowFromGroups(groups: CategoryMonthGroup[], parentById: ParentById): MonthlyFlow[] {
  const map = new Map<string, MonthlyFlow>();
  for (const g of groups) {
    const cls = classifyParent(parentOf(g.categoryId, parentById));
    const row = map.get(g.month) ?? { month: g.month, incomePaise: 0, spendPaise: 0, investPaise: 0, leakagePaise: 0 };
    if (cls === "income" && g.isPositive) row.incomePaise += g.amountSumPaise;
    else if (cls === "invest" && !g.isPositive) row.investPaise += -g.amountSumPaise;
    else if (SPEND_CLASSES.has(cls) && !g.isPositive) row.spendPaise += -g.amountSumPaise;
    if (!g.isPositive && g.isLeakage) row.leakagePaise += -g.amountSumPaise;
    map.set(g.month, row);
  }
  return [...map.values()].sort((a, b) => a.month.localeCompare(b.month));
}

export function leakageByParentFromGroups(groups: CategoryMonthGroup[], parentById: ParentById): Array<{ parent: string; paise: number; count: number }> {
  const map = new Map<string, { parent: string; paise: number; count: number }>();
  for (const g of groups) {
    if (!g.isLeakage || g.isPositive) continue;
    const parent = parentOf(g.categoryId, parentById) ?? "(uncategorized)";
    const cur = map.get(parent) ?? { parent, paise: 0, count: 0 };
    cur.paise += -g.amountSumPaise;
    cur.count += g.txnCount;
    map.set(parent, cur);
  }
  return [...map.values()].sort((a, b) => b.paise - a.paise);
}

// Kept in sync with LEAKAGE_TAG's semantics; re-exported so callers building the SQL-shape rows know
// exactly which tag the `isLeakage` boolean must correspond to.
export { LEAKAGE_TAG };

export interface AccountSumGroup { accountId: string; amountSumPaise: number }

/** accountBalances reconstructed from anchor-eligible per-account sums (migration 0011's
 *  `dashboard_account_balances()`), instead of filtering the full transaction list per account. */
export function accountBalancesFromSums(accounts: AccountLike[], sums: AccountSumGroup[]): {
  balances: AccountBalance[];
  netWorthPaise: number;
} {
  const byAccount = new Map(sums.map((s) => [s.accountId, s.amountSumPaise]));
  const balances = accounts.map((a) => ({
    id: a.id, name: a.name, kind: a.kind,
    balancePaise: (a.anchorBalancePaise ?? 0) + (byAccount.get(a.id) ?? 0),
  }));
  return { balances, netWorthPaise: balances.reduce((s, b) => s + b.balancePaise, 0) };
}
