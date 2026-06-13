import { createSupabaseServer } from "@/lib/supabase/server";
import { ReviewTable, type ReviewTxn, type ReviewCategory } from "@/components/review-table";
import { AiSuggestPanel, type AiCategory } from "@/components/ai-suggest-panel";
import { EnrichPanel } from "@/components/enrich-panel";

export const dynamic = "force-dynamic";

export default async function ReviewPage() {
  const supabase = await createSupabaseServer();
  const [{ data: txnsRaw }, { data: catsRaw }, { data: acctsRaw }] = await Promise.all([
    supabase.from("transactions")
      .select("id,txn_date,amount_paise,description_raw,merchant,tags,category_id,category_source,account_id")
      .order("txn_date", { ascending: false }).limit(300),
    supabase.from("categories").select("id,name,parent_id,auto_assignable"),
    supabase.from("accounts").select("id,name"),
  ]);

  const cats = catsRaw ?? [];
  const nameById = new Map(cats.map((c) => [c.id as string, c.name as string]));
  const acctById = new Map((acctsRaw ?? []).map((a) => [a.id as string, a.name as string]));
  const categories: ReviewCategory[] = cats.map((c) => ({
    id: c.id as string, name: c.name as string,
    parent: c.parent_id ? nameById.get(c.parent_id as string) ?? null : null,
  }));
  // AI suggestions can only target auto-assignable categories (no Leakage 14 / Review 15).
  const aiCategories: AiCategory[] = cats
    .filter((c) => c.auto_assignable as boolean)
    .map((c) => ({ name: c.name as string, parent: c.parent_id ? nameById.get(c.parent_id as string) ?? null : null }));
  const transactions: ReviewTxn[] = (txnsRaw ?? []).map((t) => ({
    id: t.id as string,
    date: t.txn_date as string,
    amountPaise: t.amount_paise as number,
    description: t.description_raw as string,
    merchant: (t.merchant as string | null) ?? "",
    tags: (t.tags as string[]) ?? [],
    categoryId: (t.category_id as string) ?? "",
    categorySource: (t.category_source as string) ?? "default",
    accountName: t.account_id ? acctById.get(t.account_id as string) ?? "" : "",
  }));

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Review</h1>
        <p className="text-sm text-muted-foreground">Re-categorize and tag leakage. Changes save instantly. Showing the most recent 300 transactions.</p>
      </div>
      <EnrichPanel />
      <AiSuggestPanel categories={aiCategories} />
      <ReviewTable transactions={transactions} categories={categories} />
    </div>
  );
}
