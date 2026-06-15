import { NextResponse } from "next/server";
import { createSupabaseServer } from "@/lib/supabase/server";
import { FALLBACK_CATEGORY, REAPPLY_SOURCES, selectActiveRules, reapplyRules,
  type ReapplyRule, type ReapplyTxn } from "@/lib/ingest/rules";

export const runtime = "nodejs";

/**
 * Re-run the global vendor rules across EVERY transaction in EVERY account, in priority order,
 * first-match-wins. Overwrite policy (Prompt 16 decision): rules may reclaim rows whose
 * category_source ∈ {default, rule, ai_suggested, money_manager}; a hand-set 'user' row is NEVER
 * touched. Rows a rule (re)categorizes become category_source = 'rule'. Idempotent: a re-run with no
 * rule changes writes nothing. Safe: rules can only target auto-assignable (non-14/15) categories.
 *
 * Returns a hits report: per-rule rows matched (also persisted to vendor_rules.last_hit_count so the
 * Rules tab shows it after reload), total rows newly categorized, and rows still Uncategorized Review.
 */
export async function POST() {
  const supabase = await createSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // Rules: enabled-only, priority order — the exact order the engine sees at import.
  const { data: ruleRows, error: ruleErr } = await supabase.from("vendor_rules")
    .select("id,priority,active,match_text,category:categories(name)").eq("user_id", user.id);
  if (ruleErr) return NextResponse.json({ error: `apply: ${ruleErr.message}` }, { status: 500 });
  const active = selectActiveRules((ruleRows ?? []) as unknown as Array<{ id: string; priority: number; active: boolean; match_text: string; category: { name: string } }>);
  const rules: ReapplyRule[] = active.map((r) => ({ id: r.id, match: r.match_text, category: r.category.name }));

  // Category name → {id, autoAssignable}, to resolve a decision's category and keep the 14/15 wall.
  const { data: cats } = await supabase.from("categories").select("id,name,auto_assignable").eq("user_id", user.id);
  const byName = new Map<string, { id: string; autoAssignable: boolean }>(
    (cats ?? []).map((c) => [c.name as string, { id: c.id as string, autoAssignable: c.auto_assignable as boolean }]),
  );

  // Every eligible transaction across all accounts (paginated — Supabase caps a select at 1000 rows).
  const txns: ReapplyTxn[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from("transactions")
      .select("id,description_raw,merchant,category_source,category:categories(name)")
      .eq("user_id", user.id).in("category_source", [...REAPPLY_SOURCES])
      .order("id").range(from, from + 999);
    if (error) return NextResponse.json({ error: `apply: ${error.message}` }, { status: 500 });
    const page = (data ?? []) as unknown as Array<{ id: string; description_raw: string; merchant: string | null; category_source: string; category: { name: string } | null }>;
    for (const t of page) {
      txns.push({
        id: t.id,
        text: t.description_raw + " " + (t.merchant ?? ""),
        categorySource: t.category_source,
        categoryName: t.category?.name ?? FALLBACK_CATEGORY,
      });
    }
    if (page.length < 1000) break;
  }

  const out = reapplyRules(txns, rules);

  // Group effective changes by resolved category id (skipping any non-auto-assignable, defensively).
  const byCategory = new Map<string, string[]>();
  for (const d of out.decisions) {
    const info = byName.get(d.category);
    if (!info || !info.autoAssignable) continue;
    (byCategory.get(info.id) ?? byCategory.set(info.id, []).get(info.id)!).push(d.txnId);
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

  // Persist the hits report onto the rules: reset every active rule to 0 this run, then set the matched
  // counts grouped by value (few distinct values → few writes, not one per rule).
  const now = new Date().toISOString();
  await supabase.from("vendor_rules").update({ last_hit_count: 0, last_run_at: now }).eq("user_id", user.id).eq("active", true);
  const idsByCount = new Map<number, string[]>();
  for (const [ruleId, count] of Object.entries(out.matchedByRuleId)) {
    (idsByCount.get(count) ?? idsByCount.set(count, []).get(count)!).push(ruleId);
  }
  for (const [count, ids] of idsByCount) {
    const { error } = await supabase.from("vendor_rules").update({ last_hit_count: count }).in("id", ids).eq("user_id", user.id);
    if (error) return NextResponse.json({ error: `apply: ${error.message}` }, { status: 500 });
  }

  return NextResponse.json({
    scanned: out.scanned,
    matched: out.matched,
    recategorized,                       // rows newly (re)categorized this run
    remaining: out.remaining,            // eligible rows still on Uncategorized Review
    hits: out.matchedByRuleId,           // ruleId → rows matched this run (also persisted)
  });
}
