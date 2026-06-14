import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServer } from "@/lib/supabase/server";
import { moveInOrder } from "@/lib/ingest/rules";

export const runtime = "nodejs";

/**
 * Move one rule up/down in the global, first-match-wins order. We swap the two affected rules'
 * priorities (O(1) writes, not a full renumber) through a temporary slot above the current max so the
 * unique(user_id, priority) constraint is never transiently violated. Account-agnostic: rules are
 * user-global, this only reorders evaluation precedence.
 */
export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const direction = body?.direction;
  if (!body || typeof body.id !== "string" || (direction !== "up" && direction !== "down")) {
    return NextResponse.json({ error: "id and direction ('up'|'down') are required" }, { status: 400 });
  }

  const { data: ruleRows, error: loadErr } = await supabase.from("vendor_rules")
    .select("id,priority").eq("user_id", user.id).order("priority");
  if (loadErr) return NextResponse.json({ error: `reorder: ${loadErr.message}` }, { status: 500 });
  const rules = (ruleRows ?? []) as Array<{ id: string; priority: number }>;

  const currentIds = rules.map((r) => r.id);
  const i = currentIds.indexOf(body.id as string);
  if (i < 0) return NextResponse.json({ error: "rule not found" }, { status: 404 });
  const newOrder = moveInOrder(currentIds, body.id as string, direction);
  if (newOrder.join(",") === currentIds.join(",")) return NextResponse.json({ ok: true, moved: false }); // at a boundary

  const j = direction === "up" ? i - 1 : i + 1;
  const a = rules[i], b = rules[j];                 // a is moved; b is the adjacent neighbour
  const temp = rules[rules.length - 1].priority + 1; // a free slot above every existing priority

  // Three writes: park a at temp, slide b into a's slot, drop a into b's slot.
  for (const [id, priority] of [[a.id, temp], [b.id, a.priority], [a.id, b.priority]] as Array<[string, number]>) {
    const { error } = await supabase.from("vendor_rules").update({ priority }).eq("id", id).eq("user_id", user.id);
    if (error) return NextResponse.json({ error: `reorder: ${error.message}` }, { status: 500 });
  }

  return NextResponse.json({ ok: true, moved: true, a: { id: a.id, priority: b.priority }, b: { id: b.id, priority: a.priority } });
}
