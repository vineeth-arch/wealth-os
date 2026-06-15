import { createSupabaseServer } from "@/lib/supabase/server";
import { ImportWizard } from "@/components/import-wizard";
import { ReviewTable, type ReviewTxn, type ReviewCategory } from "@/components/review-table";
import { AiSuggestPanel, type AiCategory } from "@/components/ai-suggest-panel";
import { llmProvider } from "@/lib/integrations";
import { EnrichPanel } from "@/components/enrich-panel";
import { MoneyManagerPanel } from "@/components/money-manager-panel";
import { GooglePayStatementPanel } from "@/components/google-pay-statement-panel";
import { RulesManager, type RuleRow, type RuleCategory } from "@/components/rules-manager";
import { TransactionsTabs, type TxTab } from "@/components/transactions-tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function TransactionsPage({ searchParams }: { searchParams: Promise<{ tab?: string; account?: string }> }) {
  const sp = await searchParams;
  const tab: TxTab = sp.tab === "review" ? "review" : sp.tab === "rules" ? "rules" : "import";

  // All three sections render and stay MOUNTED (the client hub toggles visibility) so an in-progress
  // import's parsed rows survive tab switches. Server-component sections are passed as props.
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Transactions</h1>
      </div>
      <TransactionsTabs
        initialTab={tab}
        importSection={<ImportSection />}
        reviewSection={<ReviewSection accountFilter={sp.account ?? ""} />}
        rulesSection={<RulesSection />}
      />
    </div>
  );
}

async function ImportSection() {
  const supabase = await createSupabaseServer();
  const { data: accounts } = await supabase.from("accounts").select("id,name,institution,kind").order("name");
  const { data: cats } = await supabase.from("categories").select("id,name,parent_id");

  const byId = new Map((cats ?? []).map((c) => [c.id as string, c.name as string]));
  const categories = (cats ?? []).map((c) => ({
    name: c.name as string,
    parent: c.parent_id ? byId.get(c.parent_id as string) ?? null : null,
  }));

  if (!accounts || accounts.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Set up your workspace first</CardTitle>
          <CardDescription>You need accounts and the taxonomy before importing.</CardDescription>
        </CardHeader>
        <CardContent><Button asChild><Link href="/accounts">Go to Accounts</Link></Button></CardContent>
      </Card>
    );
  }

  return <ImportWizard accounts={accounts} categories={categories} />;
}

async function ReviewSection({ accountFilter }: { accountFilter: string }) {
  const supabase = await createSupabaseServer();
  let txnQuery = supabase.from("transactions")
    .select("id,txn_date,amount_paise,description_raw,merchant,tags,category_id,category_source,account_id")
    .order("txn_date", { ascending: false }).limit(300);
  if (accountFilter) txnQuery = txnQuery.eq("account_id", accountFilter);
  const [{ data: txnsRaw }, { data: catsRaw }, { data: acctsRaw }, { data: llmRows }] = await Promise.all([
    txnQuery,
    supabase.from("categories").select("id,name,parent_id,auto_assignable"),
    supabase.from("accounts").select("id,name"),
    supabase.from("integrations").select("provider,meta").eq("kind", "llm"),
  ]);

  // Active LLM provider's label for the AI-suggest panel (default Gemini — same as the suggest route).
  const activeLlm = (llmRows ?? []).find((r) => (r.meta as { active?: boolean } | null)?.active);
  const providerLabel = llmProvider((activeLlm?.provider as string) ?? "gemini")?.label ?? "the model";

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

  const filterName = accountFilter ? acctById.get(accountFilter) ?? "" : "";

  return (
    <div className="space-y-6">
      {accountFilter && (
        <div className="flex items-center gap-2 text-sm">
          <span className="rounded-full border bg-muted/40 px-3 py-1">Filtered to <span className="font-medium">{filterName || "account"}</span></span>
          <Link href="/transactions?tab=review" className="text-xs text-muted-foreground hover:text-foreground">Clear</Link>
        </div>
      )}
      <EnrichPanel />
      <MoneyManagerPanel />
      <GooglePayStatementPanel />
      <AiSuggestPanel categories={aiCategories} providerLabel={providerLabel} />
      <ReviewTable transactions={transactions} categories={categories} />
    </div>
  );
}

async function RulesSection() {
  const supabase = await createSupabaseServer();
  const [{ data: ruleRows }, { data: cats }] = await Promise.all([
    supabase.from("vendor_rules").select("id,priority,match_text,active,last_hit_count,category:categories(name)").order("priority"),
    supabase.from("categories").select("id,name,parent_id,auto_assignable"),
  ]);

  const byId = new Map((cats ?? []).map((c) => [c.id as string, c.name as string]));
  // Only auto-assignable categories can be a rule target — hide Leakage(14)/Review(15) the guard would reject.
  const categories: RuleCategory[] = (cats ?? [])
    .filter((c) => c.auto_assignable as boolean)
    .map((c) => ({
      name: c.name as string,
      parent: c.parent_id ? byId.get(c.parent_id as string) ?? null : null,
    }));

  const rules: RuleRow[] = (ruleRows ?? []).map((r) => ({
    id: r.id as string,
    priority: r.priority as number,
    matchText: r.match_text as string,
    categoryName: (r.category as unknown as { name: string }).name,
    active: r.active as boolean,
    hitCount: (r.last_hit_count as number | null) ?? null,
  }));

  return <RulesManager rules={rules} categories={categories} />;
}
