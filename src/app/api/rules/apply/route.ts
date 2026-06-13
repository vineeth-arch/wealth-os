import { NextResponse } from "next/server";
import { createSupabaseServer } from "@/lib/supabase/server";
import { categorize, FALLBACK_CATEGORY, type VendorRule } from "@/lib/ingest/rules";

export const runtime = "nodejs";

/**
 * Re-apply active vendor rules to ALREADY-COMMITTED transactions that are still on the default
 * fallback (category_source = 'default', i.e. Uncategorized Review and never set by the user).
 * Matches get category_source = 'rule'. Rows the user set ('user') or AI-confirmed ('ai_suggested')
 * are never touched. Safe by construction: rules can't target Leakage/Review, and we additionally
 * refuse to assign any non-auto-assignable category.
 */
export async function POST() {
  const supabase = await createSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // Same rule shape as /api/import: active rules, ordered by priority, first match wins.
  const { data: ruleRows } = await supabase.from("vendor_rules")
    .select("priority,match_text,category:categories(name)").eq("active", true).order("priority");
  const rules: VendorRule[] = (ruleRows ?? []).map((r) => ({
    match: r.match_text as string,
    category: (r.category as unknown as { name: string }).name,
  }));

  const { data: cats } = await supabase.from("categories").select("id,name,auto_assignable").eq("user_id", user.id);
  const byName = new Map<string, { id: string; autoAssignable: boolean }>(
    (cats ?? []).map((c) => [c.name as string, { id: c.id as string, autoAssignable: c.auto_assignable as boolean }]),
  );

  const { data: txns } = await supabase.from("transactions")
    .select("id,description_raw").eq("user_id", user.id).eq("category_source", "default");
  const rows = (txns ?? []) as Array<{ id: string; description_raw: string }>;

  // Group the matched transactions by their resulting category so we issue one update per category.
  const byCategory = new Map<string, string[]>();
  for (const t of rows) {
    const { category } = categorize(t.description_raw, rules);
    if (category === FALLBACK_CATEGORY) continue;
    const info = byName.get(category);
    if (!info || !info.autoAssignable) continue;
    (byCategory.get(info.id) ?? byCategory.set(info.id, []).get(info.id)!).push(t.id);
  }

  let recategorized = 0;
  for (const [categoryId, ids] of byCategory) {
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      const { error } = await supabase.from("transactions")
        .update({ category_id: categoryId, category_source: "rule" })
        .in("id", chunk).eq("user_id", user.id);
      if (error) return NextResponse.json({ error: `apply: ${error.message}` }, { status: 500 });
      recategorized += chunk.length;
    }
  }

  return NextResponse.json({ scanned: rows.length, recategorized, remaining: rows.length - recategorized });
}
