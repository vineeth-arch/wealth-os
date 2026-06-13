// Google Gemini adapter for category suggestions. SERVER-ONLY: import only from route handlers,
// never a client component (it reads GEMINI_API_KEY and pulls the Node SDK). Hard invariant:
// only description text + the allowed category NAMES are ever sent — never amount/date/balance/account.
import { GoogleGenAI, Type, type Schema } from "@google/genai";

export const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash-lite";

export class GeminiKeyMissingError extends Error {
  constructor() { super("GEMINI_API_KEY is not set"); this.name = "GeminiKeyMissingError"; }
}

export interface CategorySuggestion { index: number; category: string }

/** The EXACT prompt sent to the model. Kept pure so it can be inspected/returned for audit. */
export function buildSuggestPrompt(descriptions: string[], categoryNames: string[]): string {
  return [
    "You categorize Indian bank and credit-card transaction descriptions into a fixed taxonomy.",
    "For each numbered description, choose the single best category NAME from the allowed list.",
    'If you are not confident, use "Uncategorized Review".',
    "Use only names from the list, verbatim. Return one object per description, echoing its index.",
    "",
    "Allowed categories:",
    categoryNames.map((n) => `- ${n}`).join("\n"),
    "",
    "Descriptions:",
    descriptions.map((d, i) => `${i}. ${d}`).join("\n"),
  ].join("\n");
}

const SUGGEST_SCHEMA: Schema = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: { index: { type: Type.INTEGER }, category: { type: Type.STRING } },
    required: ["index", "category"],
    propertyOrdering: ["index", "category"],
  },
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Ask Gemini for a category per description. Returns raw {index, category} pairs; the caller validates names. */
export async function suggestCategories(
  descriptions: string[],
  categoryNames: string[],
  opts?: { model?: string },
): Promise<{ suggestions: CategorySuggestion[]; model: string; prompt: string }> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new GeminiKeyMissingError();
  const model = opts?.model || process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
  const prompt = buildSuggestPrompt(descriptions, categoryNames);
  if (descriptions.length === 0) return { suggestions: [], model, prompt };

  const ai = new GoogleGenAI({ apiKey });

  let lastErr: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: { responseMimeType: "application/json", responseSchema: SUGGEST_SCHEMA },
      });
      const text = response.text;
      if (!text) return { suggestions: [], model, prompt };
      const parsed = JSON.parse(text) as unknown;
      const suggestions: CategorySuggestion[] = [];
      for (const r of Array.isArray(parsed) ? parsed : []) {
        if (r && typeof r.index === "number" && typeof r.category === "string") {
          suggestions.push({ index: r.index, category: r.category });
        }
      }
      return { suggestions, model, prompt };
    } catch (e) {
      lastErr = e;
      const status = (e as { status?: number }).status;
      if (status === 429 && attempt < 3) { await sleep(2000 * 2 ** attempt); continue; } // backoff on rate-limit only
      throw e;
    }
  }
  throw lastErr;
}
