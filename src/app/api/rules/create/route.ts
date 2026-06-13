import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServer } from "@/lib/supabase/server";
import { guardCategory, insertRule, categoryIndex } from "@/lib/server/rules";
import { normalizeDesc } from "@/lib/ingest/util";
import { buildRuleDraft } from "@/lib/recategorize";

export const runtime = "nodejs";

/**
 * Create a single vendor_rule from a drill-down "Add rule" action. Reuses the SAME path as the
 * AI-suggest flow: `categoryIndex` + `guardCategory` (refuses Leakage 14 / Review 15 — the engine
 * must never auto-assign those) + `insertRule`. match_text is normalized by the canonical normalizeDesc.
 */
export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body || typeof body.matchText !== "string" || typeof body.categoryName !== "string") {
    return NextResponse.json({ error: "matchText and categoryName are required" }, { status: 400 });
  }

  const match = normalizeDesc(body.matchText);
  if (!match) return NextResponse.json({ error: "empty match text" }, { status: 400 });

  const g = guardCategory(body.categoryName, await categoryIndex(supabase, user.id));
  if ("error" in g) return NextResponse.json({ error: g.error }, { status: 422 });

  const draft = buildRuleDraft(match, g.id);
  try {
    const rule = await insertRule(supabase, user.id, draft.match_text, draft.category_id);
    return NextResponse.json({ ruleCreated: true, match: rule.matchText, priority: rule.priority });
  } catch (e) {
    return NextResponse.json({ error: `rule: ${(e as Error).message}` }, { status: 500 });
  }
}
