/**
 * LIGHT Google Pay category hints. The real value of GPay enrichment is the human merchant name
 * flowing into the existing vendor rules + AI-suggest; this map only forces the high-confidence cases:
 *  - self-transfers and family-name (spouse-token) transfers → a neutral parent-10 transfer;
 *  - a few unambiguous merchants (recharge / OTT / app stores).
 * Everything else resolves to `null` (don't force a category). No target may be a Leakage(14)/Review(15)
 * leaf — enforced again by `guardCategory` at apply time and asserted by the gate. Names are resolved
 * against the live taxonomy, never hardcoded ids.
 */
import { SPOUSE_TRANSFER_CATEGORY, matchesSpouseToken } from "./money-manager-category-map.js";
import type { GooglePayStatementEntry } from "./types.js";

/** Ordered merchant hints (first match wins). `test` runs on the space-stripped party text. */
const MERCHANT_HINTS: Array<{ re: RegExp; category: string }> = [
  { re: /jioprepaid|airtelprepaid|vodafone|viprepaid|recharge/i, category: "Mobile Phone" },           // telecom
  { re: /netflix|hotstar|disney|sonyliv|zee5|primevideo|spotify/i, category: "OTT / Entertainment" },  // streaming
  { re: /googleplay|googleone|appleservices|applemediaservices|appstore/i, category: "Apps & Digital Subscriptions" },
];

/** Is this entry a neutral transfer (self-transfer or a family-name payment)? */
export function isGpayTransfer(entry: GooglePayStatementEntry): boolean {
  return entry.kind === "self_transfer" || matchesSpouseToken(entry.party);
}

export interface GpayCategoryResolution {
  categoryName: string | null;
  /** Transfer overrides are high-confidence (applied even over an Uncategorized-Review row). */
  isOverride: boolean;
}

/**
 * Resolve a GPay entry to a target category NAME (or null = don't force). Transfer overrides take
 * priority; then the light merchant hints; otherwise null (leave for the enriched merchant → rules + AI).
 */
export function resolveGpayCategory(entry: GooglePayStatementEntry): GpayCategoryResolution {
  if (isGpayTransfer(entry)) return { categoryName: SPOUSE_TRANSFER_CATEGORY, isOverride: true };
  for (const h of MERCHANT_HINTS) if (h.re.test(entry.party)) return { categoryName: h.category, isOverride: false };
  return { categoryName: null, isOverride: false };
}

/** Distinct non-null leaf names this map can target — for gate validation against the taxonomy. */
export function gpayTargetCategoryNames(): string[] {
  return [SPOUSE_TRANSFER_CATEGORY, ...new Set(MERCHANT_HINTS.map((h) => h.category))];
}
