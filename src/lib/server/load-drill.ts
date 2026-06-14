import { createSupabaseServer } from "@/lib/supabase/server";
import { type DrillTxn } from "@/lib/drilldown";
import { type CategoryOption } from "@/components/category-select";

export interface DrillAccount {
  id: string;
  name: string;
  kind: string;
  anchorBalancePaise: number | null;
  anchorDate: string | null;
}

export interface DrillData {
  drillTxns: DrillTxn[];
  categoryOptions: CategoryOption[];
  accounts: DrillAccount[];
  months: string[]; // distinct YYYY-MM present in the data, ascending
}

/**
 * Single source of truth for the per-transaction rows the drill-down pages render. Pulls accounts,
 * transactions and the category tree, resolves each txn's parent bucket, and enriches it into a
 * DrillTxn (the shape src/lib/drilldown.ts aggregates over). Reused by the dashboard, the KPI insight
 * pages, the bucket pages and the accounts page so the enrichment logic lives in exactly one place.
 */
export async function loadDrillData(): Promise<DrillData> {
  const supabase = await createSupabaseServer();
  const [{ data: accountsRaw }, { data: txnsRaw }, { data: catsRaw }] = await Promise.all([
    supabase.from("accounts").select("id,name,kind,anchor_balance_paise,anchor_date"),
    supabase.from("transactions").select("id,txn_date,amount_paise,tags,account_id,category_id,description_raw,merchant,category_source"),
    supabase.from("categories").select("id,name,parent_id"),
  ]);

  const accounts: DrillAccount[] = (accountsRaw ?? []).map((a) => ({
    id: a.id as string, name: a.name as string, kind: a.kind as string,
    anchorBalancePaise: (a.anchor_balance_paise as number | null) ?? null,
    anchorDate: (a.anchor_date as string | null) ?? null,
  }));
  const accNameById = new Map(accounts.map((a) => [a.id, a.name]));

  const cats = catsRaw ?? [];
  const nameById = new Map(cats.map((c) => [c.id as string, c.name as string]));
  // a leaf's bucket is its parent; a parent maps to itself
  const parentByCatId = new Map<string, string | null>();
  for (const c of cats) {
    const parentName = c.parent_id ? nameById.get(c.parent_id as string) ?? null : null;
    parentByCatId.set(c.id as string, parentName ?? (c.name as string));
  }
  const categoryOptions: CategoryOption[] = cats.map((c) => ({
    id: c.id as string, name: c.name as string,
    parent: c.parent_id ? nameById.get(c.parent_id as string) ?? null : null,
  }));

  const months = new Set<string>();
  const drillTxns: DrillTxn[] = (txnsRaw ?? []).map((t) => {
    const txnDate = t.txn_date as string;
    months.add(txnDate.slice(0, 7));
    return {
      id: t.id as string,
      txnDate,
      amountPaise: t.amount_paise as number,
      accountId: (t.account_id as string) ?? "",
      accountName: t.account_id ? accNameById.get(t.account_id as string) ?? "" : "",
      descriptionRaw: (t.description_raw as string) ?? "",
      merchant: (t.merchant as string | null) ?? "",
      categoryId: (t.category_id as string) ?? "",
      categoryName: t.category_id ? nameById.get(t.category_id as string) ?? "" : "",
      parent: t.category_id ? parentByCatId.get(t.category_id as string) ?? null : null,
      categorySource: (t.category_source as string) ?? "default",
      tags: (t.tags as string[]) ?? [],
    };
  });

  return { drillTxns, categoryOptions, accounts, months: [...months].sort() };
}
