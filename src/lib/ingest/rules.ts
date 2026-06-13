import { parse as parseYaml } from "yaml";
import { normalizeDesc } from "./util.js";

export interface Category { name: string; parent: string; color: string; icon: string; }
export interface VendorRule { match: string; category: string; }

export const FALLBACK_CATEGORY = "Uncategorized Review";
const LEAKAGE_PARENT = "14 Cash Leakage Watchlist";
const REVIEW_PARENT = "15 Review Buckets";

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
