import { NextResponse } from "next/server";
import { createSupabaseServer } from "@/lib/supabase/server";
import { normalizeDesc } from "@/lib/ingest/util";
import { FALLBACK_CATEGORY } from "@/lib/ingest/rules";
import { resolveLlmDispatch } from "@/lib/integrations";
import { LlmKeyMissingError, type SuggestCategories } from "@/lib/llm/provider";
import { suggestCategories as geminiSuggest } from "@/lib/llm/gemini";
import { suggestCategories as openaiSuggest } from "@/lib/llm/openai";

export const runtime = "nodejs";

// Adapters that implement AI-suggest. Other catalog providers (anthropic/openrouter) have no adapter yet.
const ADAPTERS: Record<string, SuggestCategories> = { gemini: geminiSuggest, openai: openaiSuggest };

/**
 * Ask the configured LLM for a category per still-uncategorized vendor. Sends ONLY the description
 * text + the allowed category names — never amount/date/balance/account. Nothing is persisted here;
 * the client confirms each suggestion. Dispatches to the active provider's adapter; if that provider's
 * key is missing it returns a clear reason (disabled:true) and never silently falls back to another.
 */
export async function POST() {
  const supabase = await createSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // Resolve the active provider → adapter (pure helper, gate-tested). Defaults to Gemini when none is
  // active; never silently falls back to another provider — a missing adapter/key returns a clear reason.
  const { data: llmRows } = await supabase.from("integrations").select("provider,meta").eq("kind", "llm").eq("user_id", user.id);
  const decision = resolveLlmDispatch(llmRows ?? [], (p) => p in ADAPTERS, (v) => Boolean(process.env[v]));
  if (!decision.ok) {
    return NextResponse.json({ disabled: true, reason: decision.reason, suggestions: [] });
  }
  const { providerId, model } = decision;
  const suggest = ADAPTERS[providerId];

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

  // Allowed categories: auto-assignable only (excludes Leakage 14 / Review 15) so the model can't pick them.
  // Carry each leaf's parent bucket so the prompt groups them and the model reasons bucket-first.
  const { data: cats } = await supabase.from("categories").select("id,name,parent_id,auto_assignable").eq("user_id", user.id);
  const nameById = new Map<string, string>((cats ?? []).map((c) => [c.id as string, c.name as string]));
  const allowedCats = (cats ?? [])
    .filter((c) => c.auto_assignable as boolean)
    .map((c) => ({ name: c.name as string, parent: c.parent_id ? nameById.get(c.parent_id as string) ?? null : null }));
  const allowed = new Set<string>(allowedCats.map((c) => c.name));

  let result;
  try {
    result = await suggest(groupList.map((g) => g.sample), allowedCats, model ? { model } : undefined);
  } catch (e) {
    if (e instanceof LlmKeyMissingError) {
      return NextResponse.json({ disabled: true, reason: `${decision.label} selected but its key is not set on the server.`, suggestions: [] });
    }
    return NextResponse.json({ error: `${providerId}: ${(e as Error).message}` }, { status: 502 });
  }

  // Map back to groups; drop unknown / forbidden / fallback. (allowed already excludes 14/15.)
  const byIndex = new Map<number, string>(result.suggestions.map((s) => [s.index, s.category]));
  const suggestions = groupList
    .map((g, i) => ({ key: String(i), sample: g.sample, txnIds: g.txnIds, txnCount: g.txnIds.length, suggestedCategory: byIndex.get(i) ?? "" }))
    .filter((s) => s.suggestedCategory && allowed.has(s.suggestedCategory) && s.suggestedCategory !== FALLBACK_CATEGORY);

  if (process.env.DEBUG_AI_SUGGEST) console.log("[ai/suggest] model=%s groups=%d suggested=%d prompt:\n%s", result.model, groupList.length, suggestions.length, result.prompt);

  return NextResponse.json({
    disabled: false, model: result.model, prompt: result.prompt,
    scanned: txns.length, groups: groupList.length, suggested: suggestions.length, suggestions,
  });
}
