import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

const KINDS = ["home", "vehicle", "personal", "education", "business", "other"] as const;

/** PATCH a loan's editable fields. RLS confines the update to the owner's row. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;

  const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  const update: Record<string, unknown> = {};
  if (typeof b.name === "string" && b.name.trim()) update.name = b.name.trim();
  if (typeof b.kind === "string" && KINDS.includes(b.kind as (typeof KINDS)[number])) update.kind = b.kind;
  if (Number.isInteger(b.principalPaise) && (b.principalPaise as number) > 0) update.principal_paise = b.principalPaise;
  if (typeof b.annualRatePct === "number" && Number.isFinite(b.annualRatePct) && b.annualRatePct >= 0) update.annual_rate_pct = b.annualRatePct;
  if (Number.isInteger(b.tenureMonths) && (b.tenureMonths as number) > 0) update.tenure_months = b.tenureMonths;
  if (typeof b.startDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.startDate)) update.start_date = b.startDate;
  if ("accountId" in b) update.account_id = b.accountId ?? null;
  if ("emiCategory" in b) update.emi_category = b.emiCategory ?? null;
  if (Object.keys(update).length === 0) return NextResponse.json({ error: "nothing to update" }, { status: 400 });

  const { error } = await supabase.from("loans").update(update).eq("id", id).eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

/** DELETE a loan. RLS confines the delete to the owner's row. */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;

  const { error } = await supabase.from("loans").delete().eq("id", id).eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
