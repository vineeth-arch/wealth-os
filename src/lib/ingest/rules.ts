import { parse as parseYaml } from "yaml";
import { normalizeDesc } from "./util.js";

export interface Category { name: string; parent: string; color: string; icon: string; }
export interface VendorRule { match: string; category: string; }

export const FALLBACK_CATEGORY = "Uncategorized Review";
export const LEAKAGE_PARENT = "14 Cash Leakage Watchlist";
export const REVIEW_PARENT = "15 Review Buckets";

/**
 * A category may never be auto-assigned (by a vendor rule or by AI) when it lives under
 * "14 Cash Leakage Watchlist" or "15 Review Buckets" — those are human-only judgments.
 * `parent` is the leaf's parent name, or the category's own name when it IS a parent.
 */
export function isForbiddenAutoParent(parent: string): boolean {
  return parent === LEAKAGE_PARENT || parent === REVIEW_PARENT;
}

/** Load the Halan taxonomy CSV. Returns name → Category. Parents have parent === "". */
export function loadTaxonomy(csv: string): Map<string, Category> {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim());
  const out = new Map<string, Category>();
  for (const line of lines.slice(1)) {
    // taxonomy names contain no commas in the master file; verified at seed time
    const [name, color, parent, icon] = line.split(",");
    if (!name) continue;
    if (out.has(name)) throw new Error(`duplicate category name in taxonomy: "${name}"`);
    out.set(name, { name, parent: parent ?? "", color: color ?? "", icon: icon ?? "" });
  }
  if (!out.has(FALLBACK_CATEGORY)) throw new Error(`taxonomy missing "${FALLBACK_CATEGORY}"`);
  return out;
}

/**
 * Load vendor rules. HARD GUARDS (Halan-framework enforcement, non-negotiable):
 *  - every rule's category must exist in the taxonomy;
 *  - no rule may target a category under "14 Cash Leakage Watchlist" or "15 Review Buckets".
 * Leakage is a human judgment applied as a TAG at review. Loading refuses, never coerces.
 */
export function loadRules(yamlText: string, taxonomy: Map<string, Category>): VendorRule[] {
  const docs = parseYaml(yamlText) as Array<{ match: string; category: string }>;
  if (!Array.isArray(docs)) throw new Error("rules YAML must be a list");
  const rules: VendorRule[] = [];
  for (const d of docs) {
    if (!d?.match || !d?.category) throw new Error(`malformed rule: ${JSON.stringify(d)}`);
    const cat = taxonomy.get(d.category);
    if (!cat) throw new Error(`rule "${d.match}" targets unknown category "${d.category}"`);
    const parent = cat.parent || cat.name;
    if (parent === LEAKAGE_PARENT) throw new Error(`rule "${d.match}" auto-assigns Leakage — forbidden`);
    if (parent === REVIEW_PARENT) throw new Error(`rule "${d.match}" auto-assigns a Review bucket — forbidden`);
    rules.push({ match: normalizeDesc(d.match), category: d.category });
  }
  return rules;
}

/** First match wins; unknown → Uncategorized Review. Returns the rule index that fired, for the rule-hits report. */
export function categorize(description: string, rules: VendorRule[]): { category: string; ruleIndex: number | null } {
  const d = normalizeDesc(description);
  for (let i = 0; i < rules.length; i++) {
    if (d.includes(rules[i].match)) return { category: rules[i].category, ruleIndex: i };
  }
  return { category: FALLBACK_CATEGORY, ruleIndex: null };
}

// ---- Global rule repository: ordering, enablement, and the re-run-across-all-accounts core ----
// These are pure (no DB/React) so the route handlers and the gate (scripts/verify.ts) share one engine.
// The engine is account-agnostic by construction: `categorize` only ever sees a description string.

/** The rule order the engine evaluates: enabled rules only, ascending priority (first match wins). */
export function selectActiveRules<T extends { active: boolean; priority: number }>(rows: readonly T[]): T[] {
  return rows.filter((r) => r.active).sort((a, b) => a.priority - b.priority);
}

/** Renumber a desired rule order to deterministic, evenly-spaced priorities (10,20,30,…). */
export function reorderPriorities(orderedIds: readonly string[]): Array<{ id: string; priority: number }> {
  return orderedIds.map((id, i) => ({ id, priority: (i + 1) * 10 }));
}

/**
 * Which `category_source` values a re-run may overwrite. A hand-set category ('user') is NEVER
 * touched; everything else is re-evaluated so deterministic rules win (decision for Prompt 16:
 * re-run reclaims default, rule, ai_suggested AND money_manager). Rows it sets become 'rule'.
 */
export const REAPPLY_SOURCES: ReadonlySet<string> = new Set(["default", "rule", "ai_suggested", "money_manager"]);
export function isReapplyTarget(source: string): boolean {
  return REAPPLY_SOURCES.has(source);
}

export interface ReapplyRule { id: string; match: string; category: string }
export interface ReapplyTxn { id: string; text: string; categorySource: string; categoryName: string }
export interface ReapplyDecision { txnId: string; ruleId: string; category: string }
export interface ReapplyOutcome {
  decisions: ReapplyDecision[];               // effective category changes to write (source → 'rule')
  hitsByRuleId: Record<string, number>;       // ruleId → rows this rule effectively changed this run
  scanned: number;                            // eligible txns examined (isReapplyTarget)
  matched: number;                            // eligible txns that matched any rule (non-fallback)
  changed: number;                            // = decisions.length = Σ hitsByRuleId (rows newly categorized)
  remaining: number;                          // eligible txns still on the fallback = scanned − matched
}

/**
 * Pure core of "re-run rules across all transactions". `rules` must already be enabled-only and in
 * priority order (`selectActiveRules`); `text` is the same string the engine matches at import
 * (`description_raw + " " + merchant`). A decision is emitted only when it is an EFFECTIVE change —
 * the resulting category differs from the current one, or the row wasn't already rule-sourced — which
 * makes the run idempotent: re-running with no rule changes yields zero decisions.
 */
export function reapplyRules(txns: readonly ReapplyTxn[], rules: readonly ReapplyRule[]): ReapplyOutcome {
  const engineRules: VendorRule[] = rules.map((r) => ({ match: r.match, category: r.category }));
  const decisions: ReapplyDecision[] = [];
  const hitsByRuleId: Record<string, number> = {};
  let scanned = 0, matched = 0;
  for (const t of txns) {
    if (!isReapplyTarget(t.categorySource)) continue;
    scanned++;
    const { category, ruleIndex } = categorize(t.text, engineRules);
    if (ruleIndex === null) continue; // no rule matched → stays Uncategorized Review
    matched++;
    if (t.categoryName === category && t.categorySource === "rule") continue; // already settled by this rule
    const ruleId = rules[ruleIndex].id;
    decisions.push({ txnId: t.id, ruleId, category });
    hitsByRuleId[ruleId] = (hitsByRuleId[ruleId] ?? 0) + 1;
  }
  return { decisions, hitsByRuleId, scanned, matched, changed: decisions.length, remaining: scanned - matched };
}
