import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServer } from "@/lib/supabase/server";
import { normalizeDesc } from "@/lib/ingest/util";
import { isForbiddenAutoParent } from "@/lib/ingest/rules";

export const runtime = "nodejs";

type Supa = Awaited<ReturnType<typeof createSupabaseServer>>;
interface CatInfo { id: string; name: string; parentName: string; autoAssignable: boolean }

/** name → {id, parentName, autoAssignable} for the user's taxonomy. parentName is the leaf's parent, or its own name when it IS a parent. */
async function categoryIndex(supabase: Supa, userId: string): Promise<Map<string, CatInfo>> {
  const { data } = await supabase.from("categories").select("id,name,parent_id,auto_assignable").eq("user_id", userId);
  const rows = (data ?? []) as Array<{ id: string; name: string; parent_id: string | null; auto_assignable: boolean }>;
  const nameById = new Map(rows.map((c) => [c.id, c.name]));
  const byName = new Map<string, CatInfo>();
  for (const c of rows) {
    byName.set(c.name, { id: c.id, name: c.name, parentName: c.parent_id ? nameById.get(c.parent_id) ?? "" : c.name, autoAssignable: c.auto_assignable });
  }
  return byName;
}

/** Reuse the rules.ts guard: a rule may never target a Leakage(14)/Review(15) category. Never coerce — return a clear error. */
function guardCategory(categoryName: string, byName: Map<string, CatInfo>): { id: string } | { error: string } {
  const info = byName.get(categoryName);
  if (!info) return { error: `unknown category "${categoryName}"` };
  if (isForbiddenAutoParent(info.parentName) || !info.autoAssignable) {
    return { error: `"${categoryName}" is under ${info.parentName} — Leakage/Review categories can't be assigned by a rule (leakage is a tag, set manually at review).` };
  }
  return { id: info.id };
}

/** Create a rule: priority = max(priority)+10; match_text normalized like rules.ts. */
export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body || typeof body.matchText !== "string" || typeof body.categoryName !== "string") {
    return NextResponse.json({ error: "matchText and categoryName are required" }, { status: 400 });
  }
  const match = normalizeDesc(body.matchText);
  if (!match) return NextResponse.json({ error: "matchText is empty after normalization" }, { status: 422 });

  const byName = await categoryIndex(supabase, user.id);
  const g = guardCategory(body.categoryName, byName);
  if ("error" in g) return NextResponse.json({ error: g.error }, { status: 422 });

  const { data: top } = await supabase.from("vendor_rules")
    .select("priority").eq("user_id", user.id).order("priority", { ascending: false }).limit(1).maybeSingle();
  const priority = ((top?.priority as number | undefined) ?? 0) + 10;

  const { data: created, error } = await supabase.from("vendor_rules")
    .insert({ user_id: user.id, priority, match_text: match, category_id: g.id, active: true })
    .select("id,priority,match_text,active").single();
  if (error) return NextResponse.json({ error: `create rule: ${error.message}` }, { status: 500 });

  return NextResponse.json({ rule: { id: created!.id, priority: created!.priority, matchText: created!.match_text, categoryName: body.categoryName, active: created!.active } });
}

/** Edit match_text / category, or toggle active. id in the body (same convention as /api/integrations). */
export async function PATCH(request: NextRequest) {
  const supabase = await createSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body || typeof body.id !== "string") return NextResponse.json({ error: "id is required" }, { status: 400 });

  const update: Record<string, unknown> = {};
  let categoryName: string | undefined;
  if (typeof body.matchText === "string") {
    const match = normalizeDesc(body.matchText);
    if (!match) return NextResponse.json({ error: "matchText is empty after normalization" }, { status: 422 });
    update.match_text = match;
  }
  if (typeof body.categoryName === "string") {
    const g = guardCategory(body.categoryName, await categoryIndex(supabase, user.id));
    if ("error" in g) return NextResponse.json({ error: g.error }, { status: 422 });
    update.category_id = g.id;
    categoryName = body.categoryName;
  }
  if (typeof body.active === "boolean") update.active = body.active;
  if (Object.keys(update).length === 0) return NextResponse.json({ error: "nothing to update" }, { status: 400 });

  const { data: updated, error } = await supabase.from("vendor_rules")
    .update(update).eq("id", body.id).eq("user_id", user.id)
    .select("id,priority,match_text,active").maybeSingle();
  if (error) return NextResponse.json({ error: `update rule: ${error.message}` }, { status: 500 });
  if (!updated) return NextResponse.json({ error: "rule not found" }, { status: 404 });

  return NextResponse.json({ rule: { id: updated.id, priority: updated.priority, matchText: updated.match_text, active: updated.active, ...(categoryName ? { categoryName } : {}) } });
}

/** Delete a rule. */
export async function DELETE(request: NextRequest) {
  const supabase = await createSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body || typeof body.id !== "string") return NextResponse.json({ error: "id is required" }, { status: 400 });

  const { error } = await supabase.from("vendor_rules").delete().eq("id", body.id).eq("user_id", user.id);
  if (error) return NextResponse.json({ error: `delete rule: ${error.message}` }, { status: 500 });
  return NextResponse.json({ ok: true });
}
