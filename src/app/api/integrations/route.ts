import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServer } from "@/lib/supabase/server";
import { deriveLlmStatus, isLlmProvider, llmProvider, type IntegrationKind } from "@/lib/integrations";

export const runtime = "nodejs";

/**
 * Persist the user's integration choices. Trust boundary: this route NEVER accepts an LLM API key —
 * keys live only as server env vars (see src/lib/integrations.ts). For LLM rows the server RE-DERIVES
 * status from env-var presence; the client cannot mark a provider connected without the key existing.
 */
export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body || typeof body.kind !== "string" || typeof body.provider !== "string") {
    return NextResponse.json({ error: "kind and provider are required" }, { status: 400 });
  }
  // Hard guard: a secret must never arrive here. LLM keys are server env vars only.
  if ("secret" in body || "apiKey" in body || "encrypted_secret" in body || "kdf_salt" in body) {
    return NextResponse.json({ error: "secrets are not accepted by this endpoint; LLM keys are server env vars" }, { status: 400 });
  }

  const kind = body.kind as IntegrationKind;

  if (kind === "llm") {
    if (!isLlmProvider(body.provider)) {
      return NextResponse.json({ error: `unknown LLM provider "${body.provider}"` }, { status: 400 });
    }
    const prov = llmProvider(body.provider)!;
    const status = deriveLlmStatus(Boolean(process.env[prov.envVar]));
    const model = typeof body.model === "string" && prov.models.includes(body.model) ? body.model : prov.models[0];
    const active = body.active === true;

    if (active) {
      // single active LLM provider at a time
      await supabase.from("integrations").update({ meta: { active: false } })
        .eq("user_id", user.id).eq("kind", "llm");
    }
    const { error } = await supabase.from("integrations").upsert({
      user_id: user.id, kind: "llm", provider: body.provider,
      status, meta: { model, active }, updated_at: new Date().toISOString(),
    }, { onConflict: "user_id,kind,provider" });
    if (error) return NextResponse.json({ error: `integrations: ${error.message}` }, { status: 500 });
    return NextResponse.json({ ok: true, provider: body.provider, status, model, active });
  }

  if (kind === "price_source") {
    const status = body.status === "connected" ? "connected" : "not_connected";
    const { error } = await supabase.from("integrations").upsert({
      user_id: user.id, kind: "price_source", provider: body.provider,
      status, meta: {}, updated_at: new Date().toISOString(),
    }, { onConflict: "user_id,kind,provider" });
    if (error) return NextResponse.json({ error: `integrations: ${error.message}` }, { status: 500 });
    return NextResponse.json({ ok: true, provider: body.provider, status });
  }

  return NextResponse.json({ error: `unsupported kind "${kind}"` }, { status: 400 });
}

/** Disconnect: status → not_connected (and active → false for LLM). */
export async function DELETE(request: NextRequest) {
  const supabase = await createSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body || typeof body.kind !== "string" || typeof body.provider !== "string") {
    return NextResponse.json({ error: "kind and provider are required" }, { status: 400 });
  }
  const meta = body.kind === "llm" ? { active: false } : {};
  const { error } = await supabase.from("integrations").upsert({
    user_id: user.id, kind: body.kind, provider: body.provider,
    status: "not_connected", meta, updated_at: new Date().toISOString(),
  }, { onConflict: "user_id,kind,provider" });
  if (error) return NextResponse.json({ error: `integrations: ${error.message}` }, { status: 500 });
  return NextResponse.json({ ok: true, provider: body.provider, status: "not_connected" });
}
