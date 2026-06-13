/**
 * Pure, dependency-free helpers for the manual re-categorize / add-as-rule flow. No imports → safe to
 * pull into a client bundle (unlike ingest/util.ts, which carries node:crypto). The rule match_text is
 * normalized server-side by the existing `normalizeDesc`; here we only shape payloads and validate ids.
 */

/** The only write a manual re-categorize performs: set the category and stamp it as a human decision. */
export function buildUserCategoryUpdate(categoryId: string): { category_id: string; category_source: "user" } {
  return { category_id: categoryId, category_source: "user" };
}

/** Never write a category that isn't in the taxonomy (the dropdown only offers valid ids; this is the guard). */
export function isKnownCategory(categoryId: string, validIds: ReadonlySet<string>): boolean {
  return categoryId.length > 0 && validIds.has(categoryId);
}

/** The content fields of a vendor_rule row (user_id + priority are added server-side by insertRule). */
export function buildRuleDraft(matchText: string, categoryId: string): { match_text: string; category_id: string; active: true } {
  return { match_text: matchText, category_id: categoryId, active: true };
}
