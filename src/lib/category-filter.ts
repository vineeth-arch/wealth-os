// Pure search/grouping logic behind the category picker. Never touches the DOM, so it's importable
// by scripts/verify.ts directly.
export interface PickerOption { id: string; name: string; parent: string | null }
export interface PickerGroup { parent: string; options: PickerOption[] }

const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Leaves only — the 15 parent buckets (parent === null) are headers, never individually selectable
 * from the picker. Matches a normalized query as a substring of the leaf name OR its parent bucket
 * name, so typing a parent term ("invest") surfaces every leaf under it. Empty query returns every
 * leaf. Result is grouped by parent, groups and options both sorted by name.
 */
export function filterCategoryOptions(categories: PickerOption[], query: string): PickerGroup[] {
  const q = normalize(query);
  const leaves = categories.filter((c) => c.parent !== null);
  const matched = q === ""
    ? leaves
    : leaves.filter((c) => normalize(c.name).includes(q) || normalize(c.parent!).includes(q));

  const byParent = new Map<string, PickerOption[]>();
  for (const c of matched) {
    const list = byParent.get(c.parent!);
    if (list) list.push(c); else byParent.set(c.parent!, [c]);
  }
  return [...byParent.entries()]
    .map(([parent, options]) => ({ parent, options: [...options].sort((a, b) => a.name.localeCompare(b.name)) }))
    .sort((a, b) => a.parent.localeCompare(b.parent));
}
