import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServer } from "@/lib/supabase/server";
import { normalizeDesc } from "@/lib/ingest/util";
import { categoryIndex, guardCategory, insertRule } from "@/lib/server/rules";

export const runtime = "nodejs";

/**
 * Apply a CONFIRMED AI suggestion: set the matching transactions' category (source = 'ai_suggested')
 * and optionally persist a vendor rule so the next import is deterministic. The server RE-VALIDATES the
 * category against the Leakage/Review guard and only touches rows still on the default fallback — it
 * never trusts the client's category choice or row set.
 */
export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body || !Array.isArray(body.txnIds) || typeof body.categoryName !== "string") {
    return NextResponse.json({ error: "txnIds and categoryName are required" }, { status: 400 });
  }
  const txnIds = (body.txnIds as unknown[]).filter((x): x is string => typeof x === "string");
  if (txnIds.length === 0) return NextResponse.json({ error: "no txnIds" }, { status: 400 });

  const g = guardCategory(body.categoryName, await categoryIndex(supabase, user.id));
  if ("error" in g) return NextResponse.json({ error: g.error }, { status: 422 });

  // Only flip rows still on the default fallback — never override a user/rule/ai decision.
  const { data: updated, error } = await supabase.from("transactions")
    .update({ category_id: g.id, category_source: "ai_suggested" })
    .in("id", txnIds).eq("user_id", user.id).eq("category_source", "default")
    .select("id");
  if (error) return NextResponse.json({ error: `apply: ${error.message}` }, { status: 500 });

  let ruleCreated = false;
  const cr = body.createRule;
  if (cr && typeof cr.matchText === "string") {
    const match = normalizeDesc(cr.matchText);
    if (match) {
      try { await insertRule(supabase, user.id, match, g.id); ruleCreated = true; }
      catch (e) { return NextResponse.json({ error: `rule: ${(e as Error).message}` }, { status: 500 }); }
    }
  }

  return NextResponse.json({ updated: updated?.length ?? 0, ruleCreated });
}
