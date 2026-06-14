// Shared LLM-provider abstraction for category suggestions. SERVER-ONLY in practice, but this file
// imports NO SDK and reads NO env var → pure types + a base error, safe to import from the gate.
// Hard invariant (enforced in prompt.ts + each adapter): only description-level text and the allowed
// category names are ever sent to a model — never amount/date/balance/account.
import type { PromptCategory } from "./prompt";

/** One model decision: which description (by index) maps to which category name (verbatim or fallback). */
export interface CategorySuggestion { index: number; category: string }

/** What every adapter returns: the raw/coerced suggestions plus the model + exact prompt (for audit). */
export interface SuggestResult { suggestions: CategorySuggestion[]; model: string; prompt: string }

/** The interface both the Gemini and OpenAI adapters implement. Same input contract, same output shape. */
export type SuggestCategories = (
  descriptions: string[],
  categories: PromptCategory[],
  opts?: { model?: string },
) => Promise<SuggestResult>;

/** Thrown by an adapter when its server-side key env var is absent. The route maps it to disabled:true. */
export class LlmKeyMissingError extends Error {
  constructor(message: string) { super(message); this.name = "LlmKeyMissingError"; }
}
