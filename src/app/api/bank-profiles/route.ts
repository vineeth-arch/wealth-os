import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * CRUD for statement-password profiles. Trust boundary (mirrors /api/integrations): this endpoint
 * accepts ONLY the browser-encrypted ciphertext + KDF params — never a plaintext password or the master
 * passphrase. RLS scopes every row to the signed-in user. Returning the ciphertext is safe: it is
 * useless without the master passphrase, which never leaves the browser.
 */

export async function GET() {
  const supabase = await createSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("bank_profiles")
    .select("id,name,filename_match_pattern,password_ciphertext,kdf_salt,kdf_iterations")
    .order("name");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const profiles = (data ?? []).map((r) => ({
    id: r.id as string,
    name: r.name as string,
    filenameMatchPattern: (r.filename_match_pattern as string | null) ?? null,
    passwordCiphertext: r.password_ciphertext as string,
    kdfSalt: r.kdf_salt as string,
    kdfIterations: r.kdf_iterations as number,
  }));
  return NextResponse.json({ profiles });
}

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body || typeof body.name !== "string" || !body.name.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  // Hard guard: a plaintext password / passphrase must never arrive here.
  if ("password" in body || "plaintext" in body || "passphrase" in body) {
    return NextResponse.json({ error: "plaintext secrets are not accepted; send only the browser-encrypted ciphertext" }, { status: 400 });
  }
  if (typeof body.passwordCiphertext !== "string" || typeof body.kdfSalt !== "string" || typeof body.kdfIterations !== "number") {
    return NextResponse.json({ error: "passwordCiphertext, kdfSalt and kdfIterations are required" }, { status: 400 });
  }

  const row = {
    user_id: user.id,
    name: body.name.trim(),
    filename_match_pattern: typeof body.filenameMatchPattern === "string" && body.filenameMatchPattern.trim()
      ? body.filenameMatchPattern.trim()
      : null,
    password_ciphertext: body.passwordCiphertext,
    kdf_salt: body.kdfSalt,
    kdf_iterations: body.kdfIterations,
  };
  const { error } = await supabase.from("bank_profiles").upsert(row, { onConflict: "user_id,name" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, name: row.name });
}

export async function DELETE(request: NextRequest) {
  const supabase = await createSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body || typeof body.id !== "string") {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }
  const { error } = await supabase.from("bank_profiles").delete().eq("id", body.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
