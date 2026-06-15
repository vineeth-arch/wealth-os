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

/**
 * Move a rule one slot up (earlier = lower priority = evaluated sooner) or down within the current
 * order. Pure; returns the new id order (unchanged at a boundary). The route persists this by swapping
 * just the two affected priorities — O(1) writes regardless of rule count, order stays deterministic.
 */
export function moveInOrder(orderedIds: readonly string[], id: string, direction: "up" | "down"): string[] {
  const ids = [...orderedIds];
  const i = ids.indexOf(id);
  if (i < 0) return ids;
  const j = direction === "up" ? i - 1 : i + 1;
  if (j < 0 || j >= ids.length) return ids; // already at the top/bottom
  [ids[i], ids[j]] = [ids[j], ids[i]];
  return ids;
}

/**
 * Which `category_source` values a re-run may overwrite. A hand-set category ('user') is NEVER
 * touched; every other source is re-evaluated so deterministic rules win (decision for Prompt 16:
 * re-run reclaims default, rule, and the enrichment sources ai_suggested / money_manager /
 * google_pay_statement). Rows it sets become 'rule'.
 */
export const REAPPLY_SOURCES: ReadonlySet<string> = new Set(["default", "rule", "ai_suggested", "money_manager", "google_pay_statement"]);
export function isReapplyTarget(source: string): boolean {
  return REAPPLY_SOURCES.has(source);
}

export interface ReapplyRule { id: string; match: string; category: string }
export interface ReapplyTxn { id: string; text: string; categorySource: string; categoryName: string }
export interface ReapplyDecision { txnId: string; ruleId: string; category: string }
export interface ReapplyOutcome {
  decisions: ReapplyDecision[];               // effective category changes to write (source → 'rule')
  matchedByRuleId: Record<string, number>;    // ruleId → rows this rule fired on this run (persisted as the Hits count)
  scanned: number;                            // eligible txns examined (isReapplyTarget)
  matched: number;                            // eligible txns that matched any rule = Σ matchedByRuleId
  changed: number;                            // = decisions.length (rows newly (re)categorized this run)
  remaining: number;                          // eligible txns still on the fallback = scanned − matched
}

/**
 * Pure core of "re-run rules across all transactions". `rules` must already be enabled-only and in
 * priority order (`selectActiveRules`); `text` is the same string the engine matches at import
 * (`description_raw + " " + merchant`). Every matched row counts toward `matchedByRuleId` (the Hits
 * report, stable across runs), but a `decision` (an actual write) is emitted only when it is an
 * EFFECTIVE change — the category differs or the row wasn't already rule-sourced — so the run is
 * idempotent: re-running with no rule changes yields zero decisions.
 */
export function reapplyRules(txns: readonly ReapplyTxn[], rules: readonly ReapplyRule[]): ReapplyOutcome {
  const engineRules: VendorRule[] = rules.map((r) => ({ match: r.match, category: r.category }));
  const decisions: ReapplyDecision[] = [];
  const matchedByRuleId: Record<string, number> = {};
  let scanned = 0, matched = 0;
  for (const t of txns) {
    if (!isReapplyTarget(t.categorySource)) continue;
    scanned++;
    const { category, ruleIndex } = categorize(t.text, engineRules);
    if (ruleIndex === null) continue; // no rule matched → stays Uncategorized Review
    matched++;
    const ruleId = rules[ruleIndex].id;
    matchedByRuleId[ruleId] = (matchedByRuleId[ruleId] ?? 0) + 1;
    if (t.categoryName === category && t.categorySource === "rule") continue; // already settled by this rule
    decisions.push({ txnId: t.id, ruleId, category });
  }
  return { decisions, matchedByRuleId, scanned, matched, changed: decisions.length, remaining: scanned - matched };
}
