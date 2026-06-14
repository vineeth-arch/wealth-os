// Server-only helpers for vendor rules. Imported only by route handlers (never a client component),
// so the guard logic lives in exactly one place. The guard mirrors rules.ts (isForbiddenAutoParent)
// and is corroborated by the DB auto_assignable column.
import { isForbiddenAutoParent } from "@/lib/ingest/rules";
import type { createSupabaseServer } from "@/lib/supabase/server";

type Supa = Awaited<ReturnType<typeof createSupabaseServer>>;
export interface CatInfo { id: string; name: string; parentName: string; autoAssignable: boolean }

/** name → {id, parentName, autoAssignable}. parentName is the leaf's parent, or its own name when it IS a parent. */
export async function categoryIndex(supabase: Supa, userId: string): Promise<Map<string, CatInfo>> {
  const { data } = await supabase.from("categories").select("id,name,parent_id,auto_assignable").eq("user_id", userId);
  const rows = (data ?? []) as Array<{ id: string; name: string; parent_id: string | null; auto_assignable: boolean }>;
  const nameById = new Map(rows.map((c) => [c.id, c.name]));
  const byName = new Map<string, CatInfo>();
  for (const c of rows) {
    byName.set(c.name, { id: c.id, name: c.name, parentName: c.parent_id ? nameById.get(c.parent_id) ?? "" : c.name, autoAssignable: c.auto_assignable });
  }
  return byName;
}

/** A rule/AI may never target a Leakage(14)/Review(15) category. Never coerce — return a clear error. */
export function guardCategory(categoryName: string, byName: Map<string, CatInfo>): { id: string } | { error: string } {
  const info = byName.get(categoryName);
  if (!info) return { error: `unknown category "${categoryName}"` };
  if (isForbiddenAutoParent(info.parentName) || !info.autoAssignable) {
    return { error: `"${categoryName}" is under ${info.parentName} — Leakage/Review categories can't be auto-assigned (leakage is a tag, set manually at review).` };
  }
  return { id: info.id };
}

/**
 * Insert a vendor rule with priority = max(priority)+10. The read-max → insert is not atomic, so two
 * concurrent creates (e.g. confirming several AI suggestions at once) can both pick the same priority
 * and collide on unique(user_id, priority); we retry on that conflict (Postgres 23505) with a freshly
 * read max. `normalizedMatch` must already be normalized & non-empty; `categoryId` already guarded.
 */
export async function insertRule(supabase: Supa, userId: string, normalizedMatch: string, categoryId: string) {
  let lastError = "";
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data: top } = await supabase.from("vendor_rules")
      .select("priority").eq("user_id", userId).order("priority", { ascending: false }).limit(1).maybeSingle();
    const priority = ((top?.priority as number | undefined) ?? 0) + 10;
    const { data, error } = await supabase.from("vendor_rules")
      .insert({ user_id: userId, priority, match_text: normalizedMatch, category_id: categoryId, active: true })
      .select("id,priority,match_text,active").single();
    if (!error) return { id: data!.id as string, priority: data!.priority as number, matchText: data!.match_text as string, active: data!.active as boolean };
    // 23505 = unique_violation: another create grabbed this priority first. Re-read max and retry.
    if (error.code !== "23505") throw new Error(error.message);
    lastError = error.message;
  }
  throw new Error(`could not assign a unique rule priority after retries: ${lastError}`);
}
