// OpenAI adapter for category suggestions. SERVER-ONLY: import only from route handlers, never a
// client component (it reads OPENAI_API_KEY). Hard invariant: only description text + the allowed
// category NAMES are ever sent — never amount/date/balance/account. Uses the REST Chat Completions
// API via global fetch (no SDK → stays inside the locked stack and keeps request-building pure/
// gate-testable, mirroring prompt.ts).
import { buildSuggestPrompt, type PromptCategory } from "./prompt";
import { LlmKeyMissingError, type CategorySuggestion, type SuggestResult } from "./provider";

const FALLBACK = "Uncategorized Review";

// Cheap, structured-output-capable default; env-overridable via OPENAI_MODEL. No other model hardcoded.
export const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";
const ENDPOINT = "https://api.openai.com/v1/chat/completions";

export class OpenAiKeyMissingError extends LlmKeyMissingError {
  constructor() { super("OPENAI_API_KEY is not set"); this.name = "OpenAiKeyMissingError"; }
}

// json_schema structured output. OpenAI requires the root to be an object, so suggestions are wrapped.
const RESPONSE_FORMAT = {
  type: "json_schema" as const,
  json_schema: {
    name: "category_suggestions",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        suggestions: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: { index: { type: "integer" }, category: { type: "string" } },
            required: ["index", "category"],
          },
        },
      },
      required: ["suggestions"],
    },
  },
};

/**
 * The EXACT request body sent to OpenAI. Pure → the gate can assert it carries only the prompt
 * (description text + category names) and no money/date/account fields, at temperature 0.
 */
export function buildOpenAiRequestBody(prompt: string, model: string) {
  return {
    model,
    messages: [{ role: "user" as const, content: prompt }],
    response_format: RESPONSE_FORMAT,
    temperature: 0,
  };
}

/**
 * Parse the model's JSON content into suggestions, coercing any category not in `allowed` (and not the
 * fallback) to "Uncategorized Review". Pure → gate-testable; never throws on a malformed shape.
 */
export function parseOpenAiSuggestions(content: string, allowed: Set<string>): CategorySuggestion[] {
  let parsed: unknown;
  try { parsed = JSON.parse(content); } catch (e) { if (process.env.DEBUG_AI_SUGGEST) console.debug("[openai] JSON parse failed:", (e as Error).message); return []; }
  const rows = (parsed as { suggestions?: unknown })?.suggestions;
  const out: CategorySuggestion[] = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    if (r && typeof r.index === "number" && typeof r.category === "string") {
      const category = allowed.has(r.category) ? r.category : FALLBACK;
      out.push({ index: r.index, category });
    }
  }
  return out;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Ask OpenAI for a category per description. Coerces unknown categories to the fallback; never logs the key. */
export async function suggestCategories(
  descriptions: string[],
  categories: PromptCategory[],
  opts?: { model?: string },
): Promise<SuggestResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new OpenAiKeyMissingError();
  const model = opts?.model || process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL;
  const prompt = buildSuggestPrompt(descriptions, categories);
  if (descriptions.length === 0) return { suggestions: [], model, prompt };

  const allowed = new Set(categories.map((c) => c.name));
  const body = JSON.stringify(buildOpenAiRequestBody(prompt, model));

  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body,
    });
    if (res.status === 429 && attempt < 3) { await sleep(2000 * 2 ** attempt); continue; } // backoff on rate-limit only
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = json.choices?.[0]?.message?.content;
    if (!content) return { suggestions: [], model, prompt };
    return { suggestions: parseOpenAiSuggestions(content, allowed), model, prompt };
  }
  throw new Error("OpenAI: exhausted retries (429)");
}
