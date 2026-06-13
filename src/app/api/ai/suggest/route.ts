import { NextResponse } from "next/server";
import { createSupabaseServer } from "@/lib/supabase/server";
import { normalizeDesc } from "@/lib/ingest/util";
import { FALLBACK_CATEGORY } from "@/lib/ingest/rules";
import { llmProvider } from "@/lib/integrations";
import { suggestCategories, GeminiKeyMissingError } from "@/lib/llm/gemini";

export const runtime = "nodejs";

/**
 * Ask the configured LLM (Gemini) for a category per still-uncategorized vendor. Sends ONLY the
 * description text + the allowed category names — never amount/date/balance/account. Nothing is
 * persisted here; the client confirms each suggestion. If GEMINI_API_KEY is missing, this no-ops
 * gracefully (disabled:true) instead of erroring.
 */
export async function POST() {
  const supabase = await createSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  if (!process.env.GEMINI_API_KEY) {
    return NextResponse.json({ disabled: true, reason: "GEMINI_API_KEY is not set on the server. Add it to enable AI suggestions.", suggestions: [] });
  }

  // Honor the configured provider; only Gemini is implemented.
  const { data: llmRows } = await supabase.from("integrations").select("provider,meta").eq("kind", "llm").eq("user_id", user.id);
  const active = (llmRows ?? []).find((r) => (r.meta as { active?: boolean } | null)?.active);
  if (active && active.provider !== "gemini") {
    return NextResponse.json({ disabled: true, reason: `Active LLM provider is "${active.provider}". AI-suggest supports Google Gemini — switch it on the Integrations page.`, suggestions: [] });
  }
  const geminiModels = llmProvider("gemini")?.models ?? [];
  const chosen = active?.provider === "gemini" ? (active?.meta as { model?: string } | null)?.model : undefined;
  const model = chosen && geminiModels.includes(chosen) ? chosen : undefined; // else adapter uses env/default

  // Committed transactions still on the default fallback.
  const { data: txnRows } = await supabase.from("transactions")
    .select("id,description_raw,merchant").eq("user_id", user.id).eq("category_source", "default");
  const txns = (txnRows ?? []) as Array<{ id: string; description_raw: string; merchant: string | null }>;

  // Dedup by normalized description → one suggestion per distinct vendor string. Fold in the
  // UPI-enriched counterpart name when present (description-level text, like description_raw — never
  // money) so the model sees the real merchant. Still NO amount/date/balance/account is sent.
  const groups = new Map<string, { sample: string; txnIds: string[] }>();
  for (const t of txns) {
    const desc = t.merchant ? `${t.description_raw} · ${t.merchant}` : t.description_raw;
    const key = normalizeDesc(desc);
    const g = groups.get(key);
    if (g) g.txnIds.push(t.id);
    else groups.set(key, { sample: desc, txnIds: [t.id] });
  }
  const groupList = [...groups.values()];
  if (groupList.length === 0) {
    return NextResponse.json({ disabled: false, suggestions: [], scanned: txns.length, groups: 0, suggested: 0, prompt: "" });
  }

  // Allowed names: auto-assignable only (excludes Leakage 14 / Review 15) so the model can't pick them.
  const { data: cats } = await supabase.from("categories").select("name,auto_assignable").eq("user_id", user.id);
  const allowed = new Set<string>((cats ?? []).filter((c) => c.auto_assignable as boolean).map((c) => c.name as string));

  let result;
  try {
    result = await suggestCategories(groupList.map((g) => g.sample), [...allowed], model ? { model } : undefined);
  } catch (e) {
    if (e instanceof GeminiKeyMissingError) {
      return NextResponse.json({ disabled: true, reason: "GEMINI_API_KEY is not set on the server.", suggestions: [] });
    }
    return NextResponse.json({ error: `gemini: ${(e as Error).message}` }, { status: 502 });
  }

  // Map back to groups; drop unknown / forbidden / fallback. (allowed already excludes 14/15.)
  const byIndex = new Map<number, string>(result.suggestions.map((s) => [s.index, s.category]));
  const suggestions = groupList
    .map((g, i) => ({ key: String(i), sample: g.sample, txnIds: g.txnIds, txnCount: g.txnIds.length, suggestedCategory: byIndex.get(i) ?? "" }))
    .filter((s) => s.suggestedCategory && allowed.has(s.suggestedCategory) && s.suggestedCategory !== FALLBACK_CATEGORY);

  console.log("[ai/suggest] model=%s groups=%d suggested=%d prompt:\n%s", result.model, groupList.length, suggestions.length, result.prompt);

  return NextResponse.json({
    disabled: false, model: result.model, prompt: result.prompt,
    scanned: txns.length, groups: groupList.length, suggested: suggestions.length, suggestions,
  });
}
