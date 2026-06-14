/**
 * Money Manager category → Halan-taxonomy intent map. Her 14 custom categories (and a few note
 * overrides) map to ACTUAL taxonomy leaf names — resolved against the seed at apply time, never to
 * an id. The map's job is a high-confidence shortcut; the richer value is the enriched merchant text,
 * which the existing vendor rules + AI-suggest categorize off. Catch-all categories deliberately map
 * to `null` (leave for rules/AI), and NO mapping may target a Leakage(14)/Review(15) leaf — that is
 * enforced again by `guardCategory` at apply time and asserted by the gate.
 *
 * Names confirmed against supabase/seed/taxonomy_master_from_sure.csv. A few are best-guess defaults
 * flagged in the final report for the user to confirm/edit (EMI/Health/Google/Apple Family/Recharge).
 */
import { FALLBACK_CATEGORY } from "./rules.js";
import type { MoneyManagerEntry } from "./types.js";

/**
 * Cleaned MM category (emoji stripped) → Halan leaf name, or `null` to NOT force a category
 * (catch-alls: let rules + AI-suggest decide off the enriched merchant text).
 */
export const MM_CATEGORY_MAP: Record<string, string | null> = {
  // High-confidence overrides
  CC: "Credit Card Bill Payment Transfer", // note "Credit card payment" → Transfer (parent 10), NOT an expense
  EMI: "Personal Loan EMI",                // parent 05 — DEFAULT (confirm the actual loan type)
  SIP: "SIP Mutual Fund",                  // parent 08 — see SIP double-count warning in the report
  Salary: "Salary",                        // parent 01
  Bonus: "Bonus",                          // parent 01
  // Subscriptions / telecom / utilities
  Netflix: "OTT / Entertainment",          // parent 03
  Google: "Apps & Digital Subscriptions",  // parent 03 — DEFAULT (Google storage/One; confirm)
  "Apple Family": "Apps & Digital Subscriptions", // parent 03 — DEFAULT (confirm)
  Recharge: "Mobile Phone",                // parent 02 — DEFAULT (mobile recharge; confirm vs Internet/WiFi)
  // Spend
  Health: "Medical Visits",                // parent 02 — DEFAULT (a medical SPEND leaf, not insurance; confirm)
  Transport: "Taxi / Cab / Auto",          // parent 02 — confirmed (daily commute)
  // Catch-alls — do NOT force; enrich the merchant and let rules + AI-suggest categorize.
  Personal: null,
  Other: null,
  "Other (Reduce from Savings)": null,
};

/**
 * Note/Description tokens that force a category regardless of the MM category. Intra-household
 * transfers to a family member's account, which otherwise inflate BOTH income and spend. Token match
 * is case-insensitive, whole-word-ish (substring on the normalized note). Editable per household.
 */
export const SPOUSE_NAME_TOKENS = ["Vinnie"]; // family-account transfer counterpart name(s)
export const SPOUSE_TRANSFER_CATEGORY = "Own Account Transfer"; // neutral family/household transfer (parent 10)

/**
 * MM categories whose mapping is high-confidence enough to apply over an Uncategorized-Review row even
 * though the source is "just" the spouse's bookkeeping. (Still never over a user/rule/AI category, and
 * still never a 14/15 leaf — those guards are unconditional.)
 */
export const OVERRIDE_CATEGORIES = new Set(["CC", "EMI", "SIP", "Salary", "Bonus"]);

/** A note/description carries a configured family-transfer token. */
export function isSpouseTransfer(entry: MoneyManagerEntry): boolean {
  const hay = `${entry.note ?? ""} ${entry.description ?? ""}`.toLowerCase();
  return SPOUSE_NAME_TOKENS.some((tok) => hay.includes(tok.toLowerCase()));
}

export interface MmCategoryResolution {
  /** Target leaf name, or null when nothing should be forced (catch-all). */
  categoryName: string | null;
  /** True when this is a high-confidence override (spouse transfer, CC/EMI/SIP/Salary/Bonus). */
  isOverride: boolean;
}

/**
 * Resolve an MM entry to a target category NAME. Note/name overrides take priority over the category
 * map. Unknown categories and the explicit catch-alls resolve to null (leave for rules + AI). The
 * returned name is validated against the live taxonomy by `guardCategory` at apply time.
 */
export function resolveMmCategory(entry: MoneyManagerEntry): MmCategoryResolution {
  if (isSpouseTransfer(entry)) return { categoryName: SPOUSE_TRANSFER_CATEGORY, isOverride: true };
  const key = entry.categoryRaw.trim();
  if (key in MM_CATEGORY_MAP) {
    const name = MM_CATEGORY_MAP[key];
    return { categoryName: name, isOverride: name !== null && OVERRIDE_CATEGORIES.has(key) };
  }
  return { categoryName: null, isOverride: false }; // unknown category → leave for rules + AI
}

/** The distinct, non-null leaf names this map can target — for gate validation against the taxonomy. */
export function mmTargetCategoryNames(): string[] {
  const names = new Set<string>([SPOUSE_TRANSFER_CATEGORY]);
  for (const v of Object.values(MM_CATEGORY_MAP)) if (v) names.add(v);
  return [...names];
}

export { FALLBACK_CATEGORY };
