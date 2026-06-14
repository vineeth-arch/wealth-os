/**
 * Integrations catalog + pure status derivation. NO secrets live here.
 *
 * Decision (overrides KICKOFF §1): LLM API keys are held as SERVER env vars, never in the browser
 * and never in our DB. The integrations row only records the user's provider/model choice; a
 * provider's "connected" status is derived purely from whether its server env var is present.
 * Browser encryption is reserved for statement passwords (bank_profiles) — out of this sub-pass.
 */

export type IntegrationKind = "llm" | "price_source" | "storage";
export type IntegrationStatus = "connected" | "not_connected" | "error";

export interface LlmProvider {
  id: string;
  label: string;
  /** Server-side env var that holds the key; presence ⇒ the provider is usable. */
  envVar: string;
  /** Selectable models; first is the default. (Consumed once AI assist lands — deferred.) */
  models: string[];
}

/** Anthropic is the default. Gemini models drive the AI category-suggest pass; the first is the default. */
export const LLM_PROVIDERS: readonly LlmProvider[] = [
  { id: "anthropic", label: "Anthropic (Claude)", envVar: "ANTHROPIC_API_KEY", models: ["claude-sonnet-4-6", "claude-haiku-4-5-20251001"] },
  { id: "openai", label: "OpenAI", envVar: "OPENAI_API_KEY", models: ["gpt-4o-mini", "gpt-4o"] },
  { id: "gemini", label: "Google Gemini", envVar: "GEMINI_API_KEY", models: ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-3.1-flash-lite"] },
  { id: "openrouter", label: "OpenRouter", envVar: "OPENROUTER_API_KEY", models: ["auto"] },
];

export const DEFAULT_LLM_PROVIDER = "anthropic";

export function isLlmProvider(id: string): boolean {
  return LLM_PROVIDERS.some((p) => p.id === id);
}

export function llmProvider(id: string): LlmProvider | undefined {
  return LLM_PROVIDERS.find((p) => p.id === id);
}

/**
 * A provider is "connected" iff the server holds its key. The key value itself is never read here —
 * callers pass only the boolean presence so this stays pure and safe to import anywhere (incl. the gate).
 */
export function deriveLlmStatus(hasEnvKey: boolean): IntegrationStatus {
  return hasEnvKey ? "connected" : "not_connected";
}

export interface LlmIntegrationRow { provider: string; meta: { active?: boolean; model?: string } | null }

export type LlmDispatch =
  | { ok: true; providerId: string; label: string; model?: string }
  | { ok: false; providerId: string; reason: string };

/**
 * Pure resolution of which LLM adapter AI-suggest should call, kept out of the route so the gate can
 * test it without a DB. Picks the single active provider (falls back to Gemini when none is active).
 * NEVER silently substitutes a different provider: if the active provider has no adapter, or its
 * server key is absent, returns ok:false with a clear reason for the caller to surface. `hasAdapter`
 * and `hasKey` are injected so this stays pure (the route passes the real ADAPTERS map + process.env).
 */
export function resolveLlmDispatch(
  rows: LlmIntegrationRow[],
  hasAdapter: (providerId: string) => boolean,
  hasKey: (envVar: string) => boolean,
  fallbackProviderId = "gemini",
): LlmDispatch {
  const activeRow = rows.find((r) => r?.meta?.active);
  const providerId = activeRow?.provider ?? fallbackProviderId;
  const prov = llmProvider(providerId);
  if (!prov || !hasAdapter(providerId)) {
    return { ok: false, providerId, reason: `Active LLM provider is "${providerId}". AI-suggest supports Google Gemini and OpenAI — switch it on the Integrations page.` };
  }
  if (!hasKey(prov.envVar)) {
    return { ok: false, providerId, reason: `${prov.label} selected but ${prov.envVar} is not set on the server. Add it (and redeploy) to enable AI suggestions.` };
  }
  const chosen = activeRow?.meta?.model;
  const model = chosen && prov.models.includes(chosen) ? chosen : undefined; // else the adapter uses its env/default
  return { ok: true, providerId, label: prov.label, model };
}
