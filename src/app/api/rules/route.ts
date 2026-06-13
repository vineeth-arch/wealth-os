import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServer } from "@/lib/supabase/server";
import { normalizeDesc } from "@/lib/ingest/util";
import { categoryIndex, guardCategory, insertRule } from "@/lib/server/rules";

export const runtime = "nodejs";

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

  const g = guardCategory(body.categoryName, await categoryIndex(supabase, user.id));
  if ("error" in g) return NextResponse.json({ error: g.error }, { status: 422 });

  try {
    const rule = await insertRule(supabase, user.id, match, g.id);
    return NextResponse.json({ rule: { ...rule, categoryName: body.categoryName } });
  } catch (e) {
    return NextResponse.json({ error: `create rule: ${(e as Error).message}` }, { status: 500 });
  }
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
