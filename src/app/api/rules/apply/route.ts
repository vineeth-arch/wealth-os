import { NextResponse } from "next/server";
import { createSupabaseServer } from "@/lib/supabase/server";
import { categorize, FALLBACK_CATEGORY, type VendorRule } from "@/lib/ingest/rules";

export const runtime = "nodejs";

/**
 * Re-apply active vendor rules to ALREADY-COMMITTED transactions on the default fallback
 * (category_source = 'default') OR previously set by AI ('ai_suggested'). A matching rule wins over an
 * AI guess — deterministic rules outrank the model — and the row becomes category_source = 'rule'.
 * Rows the user set by hand ('user') are NEVER touched (precedence: user > rule > AI > fallback).
 * Safe by construction: rules can't target Leakage/Review, and we additionally refuse to assign any
 * non-auto-assignable category.
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
    .select("id,description_raw,merchant,category_source").eq("user_id", user.id)
    .in("category_source", ["default", "ai_suggested"]);
  const rows = (txns ?? []) as Array<{ id: string; description_raw: string; merchant: string | null; category_source: string }>;

  // Group the matched transactions by their resulting category so we issue one update per category.
  // Match against the UPI-enriched counterpart name too, so a rule like LAZYPAY fires off `merchant`.
  const byCategory = new Map<string, string[]>();
  let reclaimedFromAi = 0; // how many of the matched rows were previously AI-categorized
  for (const t of rows) {
    const { category } = categorize(t.description_raw + " " + (t.merchant ?? ""), rules);
    if (category === FALLBACK_CATEGORY) continue;
    const info = byName.get(category);
    if (!info || !info.autoAssignable) continue;
    (byCategory.get(info.id) ?? byCategory.set(info.id, []).get(info.id)!).push(t.id);
    if (t.category_source === "ai_suggested") reclaimedFromAi++;
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

  return NextResponse.json({ scanned: rows.length, recategorized, reclaimedFromAi, remaining: rows.length - recategorized });
}
