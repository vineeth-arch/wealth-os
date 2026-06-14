import Link from "next/link";
import { createSupabaseServer } from "@/lib/supabase/server";
import { ImportWizard } from "@/components/import-wizard";
import { ReviewTable, type ReviewTxn, type ReviewCategory } from "@/components/review-table";
import { AiSuggestPanel, type AiCategory } from "@/components/ai-suggest-panel";
import { EnrichPanel } from "@/components/enrich-panel";
import { RulesManager, type RuleRow, type RuleCategory } from "@/components/rules-manager";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

type Tab = "import" | "review" | "rules";
const TABS: { id: Tab; label: string; blurb: string }[] = [
  { id: "import", label: "Import", blurb: "Drop a markdown statement. It is parsed and reconciled server-side; categorize, then commit. Re-importing the same period is a no-op." },
  { id: "review", label: "Review", blurb: "Re-categorize and tag leakage on committed transactions. Changes save instantly. Showing the most recent 300." },
  { id: "rules", label: "Rules", blurb: "Vendor → category rules applied deterministically at import and on demand. Add your own, toggle the seeded ones, then re-run them over Uncategorized Review." },
];

export default async function TransactionsPage({ searchParams }: { searchParams: Promise<{ tab?: string; account?: string }> }) {
  const sp = await searchParams;
  const tab: Tab = sp.tab === "review" ? "review" : sp.tab === "rules" ? "rules" : "import";
  const active = TABS.find((t) => t.id === tab)!;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Transactions</h1>
        <p className="text-sm text-muted-foreground">{active.blurb}</p>
      </div>

      <nav className="flex gap-1 border-b">
        {TABS.map((t) => (
          <Link key={t.id} href={`/transactions?tab=${t.id}`}
            className={cn("border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              t.id === tab ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>
            {t.label}
          </Link>
        ))}
      </nav>

      {tab === "import" && <ImportSection />}
      {tab === "review" && <ReviewSection />}
      {tab === "rules" && <RulesSection />}
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

async function ReviewSection() {
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
    <div className="space-y-6">
      <EnrichPanel />
      <AiSuggestPanel categories={aiCategories} />
      <ReviewTable transactions={transactions} categories={categories} />
    </div>
  );
}

async function RulesSection() {
  const supabase = await createSupabaseServer();
  const [{ data: ruleRows }, { data: cats }] = await Promise.all([
    supabase.from("vendor_rules").select("id,priority,match_text,active,category:categories(name)").order("priority"),
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
  }));

  return <RulesManager rules={rules} categories={categories} />;
}
