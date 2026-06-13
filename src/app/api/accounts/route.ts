import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

// Only these six manual identity fields may be written here — never name/institution/kind/anchors/transactions.
const FIELDS = ["account_holder_name", "account_number", "ifsc", "branch", "account_type", "upi_id"] as const;

/**
 * Update an account's copy-block identity fields. id in the body (same convention as /api/rules and
 * /api/integrations). RLS-scoped: the .eq("user_id") plus the accounts_owner policy both require
 * ownership. Empty string clears the field (→ null). The full account number is stored as given and
 * never logged.
 */
export async function PATCH(request: NextRequest) {
  const supabase = await createSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body || typeof body.id !== "string") return NextResponse.json({ error: "id is required" }, { status: 400 });

  const update: Record<string, string | null> = {};
  for (const f of FIELDS) {
    if (!(f in body)) continue;
    const v = body[f];
    if (v !== null && typeof v !== "string") return NextResponse.json({ error: `${f} must be a string or null` }, { status: 400 });
    const t = typeof v === "string" ? v.trim() : "";
    update[f] = t === "" ? null : t;
  }
  if (Object.keys(update).length === 0) return NextResponse.json({ error: "nothing to update" }, { status: 400 });

  const { data: updated, error } = await supabase.from("accounts")
    .update(update).eq("id", body.id).eq("user_id", user.id)
    .select("id").maybeSingle();
  if (error) return NextResponse.json({ error: `update account: ${error.message}` }, { status: 500 });
  if (!updated) return NextResponse.json({ error: "account not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
