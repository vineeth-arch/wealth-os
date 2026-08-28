// Dashboard aggregates: tries the DB-side RPCs from migration 0011 first (a handful of grouped rows
// instead of the whole ledger); falls back to the proven per-transaction drain + halan.ts path on ANY
// rpc error (most commonly: migration 0011 not yet applied). See that migration's header for the
// live-verification caveat — this fallback catches RPC errors, not a silently-wrong-but-non-erroring
// result, so the numbers must still be spot-checked once against the drain path (see PR checklist).
import { fetchAllRows } from "@/lib/supabase/paginate";
import {
  type TxnLike, type AccountLike, type AccountBalance, type BucketTotal, type MonthlyFlow,
  monthlyCashFlow, bucketTotals, leakageByParent, accountBalances,
} from "@/lib/halan";
import {
  type CategoryMonthGroup, type AccountSumGroup, type ParentById,
  bucketTotalsFromGroups, monthlyCashFlowFromGroups, leakageByParentFromGroups, accountBalancesFromSums,
} from "@/lib/halan-agg";
import type { createSupabaseServer } from "@/lib/supabase/server";

type Supa = Awaited<ReturnType<typeof createSupabaseServer>>;

export interface DashboardAggregates {
  flows: MonthlyFlow[];
  buckets: BucketTotal[];
  leak: Array<{ parent: string; paise: number; count: number }>;
  netWorthPaise: number;
  balances: AccountBalance[];
  totalTxnCount: number;
  source: "rpc" | "drain";
}

export async function loadDashboardAggregates(
  supabase: Supa,
  accounts: AccountLike[],
  parentById: ParentById,
): Promise<DashboardAggregates> {
  const [groupsResult, sumsResult] = await Promise.all([
    supabase.rpc("dashboard_category_month_totals"),
    supabase.rpc("dashboard_account_balances"),
  ]);

  if (!groupsResult.error && !sumsResult.error) {
    const groups: CategoryMonthGroup[] = (groupsResult.data ?? []).map((g: {
      category_id: string | null; month: string; is_leakage: boolean; is_positive: boolean;
      amount_sum_paise: number; txn_count: number;
    }) => ({
      categoryId: g.category_id,
      month: g.month,
      isLeakage: g.is_leakage,
      isPositive: g.is_positive,
      amountSumPaise: g.amount_sum_paise,
      txnCount: g.txn_count,
    }));
    const sums: AccountSumGroup[] = (sumsResult.data ?? []).map((s: { account_id: string; amount_sum_paise: number }) => ({
      accountId: s.account_id, amountSumPaise: s.amount_sum_paise,
    }));
    const { balances, netWorthPaise } = accountBalancesFromSums(accounts, sums);
    return {
      flows: monthlyCashFlowFromGroups(groups, parentById),
      buckets: bucketTotalsFromGroups(groups, parentById),
      leak: leakageByParentFromGroups(groups, parentById),
      netWorthPaise, balances,
      totalTxnCount: groups.reduce((s, g) => s + g.txnCount, 0),
      source: "rpc",
    };
  }

  // Fallback: migration 0011 not applied yet (or some other RPC error) — drain the full ledger.
  type RawTxn = { id: string; txn_date: string; amount_paise: number; tags: string[] | null; account_id: string | null; category_id: string | null };
  const rawTxns = await fetchAllRows<RawTxn>((from, to) =>
    supabase.from("transactions").select("id,txn_date,amount_paise,tags,account_id,category_id").order("id").range(from, to));

  const halanTxns: TxnLike[] = rawTxns.map((t) => ({
    txnDate: t.txn_date,
    amountPaise: t.amount_paise,
    parent: t.category_id ? parentById.get(t.category_id) ?? null : null,
    tags: t.tags ?? [],
  }));
  const { netWorthPaise, balances } = accountBalances(
    accounts,
    rawTxns.map((t) => ({ accountId: t.account_id ?? "", txnDate: t.txn_date, amountPaise: t.amount_paise })),
  );

  return {
    flows: monthlyCashFlow(halanTxns),
    buckets: bucketTotals(halanTxns),
    leak: leakageByParent(halanTxns),
    netWorthPaise, balances,
    totalTxnCount: rawTxns.length,
    source: "drain",
  };
}
