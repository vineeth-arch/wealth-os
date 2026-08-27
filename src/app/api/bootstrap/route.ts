import { NextResponse } from "next/server";
import { createSupabaseServer } from "@/lib/supabase/server";
import { SEED_CATEGORIES, SEED_RULES, SEED_ACCOUNTS } from "@/lib/seed-data";
import { isUniqueViolation } from "@/lib/supabase/db-errors";

export const runtime = "nodejs";

/**
 * Per-table idempotent workspace seed for the signed-in user: taxonomy + rules + canonical accounts.
 * Each step is guarded by its OWN per-user emptiness check, so a partially-seeded workspace (e.g.
 * categories present but accounts empty) gets topped up rather than skipped — the accounts step is
 * independent of categories. Re-running is a no-op per table.
 *
 * Check-then-act race (audit FA-8): two concurrent bootstrap calls can both see count===0 and both
 * insert. The per-user unique constraints (`categories`/`accounts` on (user_id,name), `vendor_rules`
 * on (user_id,priority)) stop the double-write, but the LOSER used to surface that as a raw 500. A
 * unique-violation on one of these specific inserts means a concurrent request already seeded this
 * table — treated as success, not failure.
 */
export async function POST() {
  const supabase = await createSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const summary = { categories: "skipped" as string, rules: "skipped" as string, accounts: "skipped" as string };

  // 1) Categories — seed only when this user has none.
  const { count: catCount } = await supabase.from("categories").select("id", { count: "exact", head: true }).eq("user_id", user.id);
  if ((catCount ?? 0) === 0) {
    const parents = SEED_CATEGORIES.filter((c) => !c.parent);
    const { data: parentRows, error: pErr } = await supabase.from("categories")
      .insert(parents.map((c) => ({ user_id: user.id, name: c.name, color: c.color, lucide_icon: c.icon, auto_assignable: c.autoAssignable })))
      .select("id,name");
    if (pErr && !isUniqueViolation(pErr)) return NextResponse.json({ error: `parents: ${pErr.message}` }, { status: 500 });
    if (pErr) {
      // Lost the race on the very first insert — a concurrent request is seeding this user; the
      // leaves insert below needs THIS request's parent ids, so there is nothing more to do here.
      summary.categories = "already seeded (concurrent request)";
    } else {
      const idByName = new Map<string, string>(parentRows!.map((r) => [r.name, r.id]));
      const leaves = SEED_CATEGORIES.filter((c) => c.parent);
      const { error: lErr } = await supabase.from("categories")
        .insert(leaves.map((c) => ({ user_id: user.id, name: c.name, parent_id: idByName.get(c.parent!) ?? null, color: c.color, lucide_icon: c.icon, auto_assignable: c.autoAssignable })));
      if (lErr && !isUniqueViolation(lErr)) return NextResponse.json({ error: `leaves: ${lErr.message}` }, { status: 500 });
      summary.categories = lErr ? "already seeded (concurrent request)" : `${SEED_CATEGORIES.length} inserted`;
    }
  }

  // 2) Vendor rules — seed only when this user has none. Map category names → ids from the user's
  //    categories (works whether they were just inserted above or already existed).
  const { count: ruleCount } = await supabase.from("vendor_rules").select("id", { count: "exact", head: true }).eq("user_id", user.id);
  if ((ruleCount ?? 0) === 0) {
    const { data: cats, error: cErr } = await supabase.from("categories").select("id,name").eq("user_id", user.id);
    if (cErr) return NextResponse.json({ error: `rules (category lookup): ${cErr.message}` }, { status: 500 });
    const idByName = new Map<string, string>((cats ?? []).map((c) => [c.name as string, c.id as string]));
    const { error: rErr } = await supabase.from("vendor_rules")
      .insert(SEED_RULES.map((r) => ({ user_id: user.id, priority: r.priority, match_text: r.match, category_id: idByName.get(r.category)! })));
    if (rErr && !isUniqueViolation(rErr)) return NextResponse.json({ error: `rules: ${rErr.message}` }, { status: 500 });
    summary.rules = rErr ? "already seeded (concurrent request)" : `${SEED_RULES.length} inserted`;
  }

  // 3) Accounts — seed only when this user has none. INDEPENDENT of categories: this is the fix for
  //    the recovery trap where categories existed but the import dropdown stayed empty.
  const { count: acctCount } = await supabase.from("accounts").select("id", { count: "exact", head: true }).eq("user_id", user.id);
  if ((acctCount ?? 0) === 0) {
    const { error: aErr } = await supabase.from("accounts")
      .insert(SEED_ACCOUNTS.map((a) => ({ user_id: user.id, name: a.name, institution: a.institution, kind: a.kind })));
    if (aErr && !isUniqueViolation(aErr)) return NextResponse.json({ error: `accounts: ${aErr.message}` }, { status: 500 });
    summary.accounts = aErr ? "already seeded (concurrent request)" : `${SEED_ACCOUNTS.length} inserted`;
  }

  return NextResponse.json({ status: "ok", ...summary });
}
