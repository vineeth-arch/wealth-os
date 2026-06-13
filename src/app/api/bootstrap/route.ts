import { NextResponse } from "next/server";
import { createSupabaseServer } from "@/lib/supabase/server";
import { SEED_CATEGORIES, SEED_RULES, SEED_ACCOUNTS } from "@/lib/seed-data";

export const runtime = "nodejs";

/** One-time, idempotent workspace seed for the signed-in user: taxonomy + rules + canonical accounts. */
export async function POST() {
  const supabase = await createSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { count } = await supabase.from("categories").select("id", { count: "exact", head: true }).eq("user_id", user.id);
  if ((count ?? 0) > 0) return NextResponse.json({ status: "already_seeded", categories: count });

  const parents = SEED_CATEGORIES.filter((c) => !c.parent);
  const { data: parentRows, error: pErr } = await supabase.from("categories")
    .insert(parents.map((c) => ({ user_id: user.id, name: c.name, color: c.color, lucide_icon: c.icon, auto_assignable: c.autoAssignable })))
    .select("id,name");
  if (pErr) return NextResponse.json({ error: `parents: ${pErr.message}` }, { status: 500 });
  const idByName = new Map<string, string>(parentRows!.map((r) => [r.name, r.id]));

  const leaves = SEED_CATEGORIES.filter((c) => c.parent);
  const { data: leafRows, error: lErr } = await supabase.from("categories")
    .insert(leaves.map((c) => ({ user_id: user.id, name: c.name, parent_id: idByName.get(c.parent!) ?? null, color: c.color, lucide_icon: c.icon, auto_assignable: c.autoAssignable })))
    .select("id,name");
  if (lErr) return NextResponse.json({ error: `leaves: ${lErr.message}` }, { status: 500 });
  for (const r of leafRows!) idByName.set(r.name, r.id);

  const { error: rErr } = await supabase.from("vendor_rules")
    .insert(SEED_RULES.map((r) => ({ user_id: user.id, priority: r.priority, match_text: r.match, category_id: idByName.get(r.category)! })));
  if (rErr) return NextResponse.json({ error: `rules: ${rErr.message}` }, { status: 500 });

  const { error: aErr } = await supabase.from("accounts")
    .insert(SEED_ACCOUNTS.map((a) => ({ user_id: user.id, name: a.name, institution: a.institution, kind: a.kind })));
  if (aErr) return NextResponse.json({ error: `accounts: ${aErr.message}` }, { status: 500 });

  return NextResponse.json({ status: "seeded", categories: SEED_CATEGORIES.length, rules: SEED_RULES.length, accounts: SEED_ACCOUNTS.length });
}
