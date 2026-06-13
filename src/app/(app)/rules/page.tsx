import { createSupabaseServer } from "@/lib/supabase/server";
import { RulesManager, type RuleRow, type RuleCategory } from "@/components/rules-manager";

export const dynamic = "force-dynamic";

export default async function RulesPage() {
  const supabase = await createSupabaseServer();
  const [{ data: ruleRows }, { data: cats }] = await Promise.all([
    supabase.from("vendor_rules").select("id,priority,match_text,active,category:categories(name)").order("priority"),
    supabase.from("categories").select("id,name,parent_id"),
  ]);

  const byId = new Map((cats ?? []).map((c) => [c.id as string, c.name as string]));
  const categories: RuleCategory[] = (cats ?? []).map((c) => ({
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

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Rules</h1>
        <p className="text-sm text-muted-foreground">
          Vendor → category rules applied deterministically at import and on demand. Add your own, toggle or
          delete the seeded ones, then re-run them over transactions still sitting in Uncategorized Review.
        </p>
      </div>
      <RulesManager rules={rules} categories={categories} />
    </div>
  );
}
