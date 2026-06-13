"use client";
import { useMemo } from "react";
import { cn } from "@/lib/utils";

export interface CategoryOption { id: string; name: string; parent: string | null }

/**
 * The grouped (optgroup-by-parent) native category <select>, shared by the review table and the
 * dashboard drill-downs so there is exactly one taxonomy dropdown. Native select stays fast with 276
 * options across many rows. Options come from the DB `categories` — never a hardcoded list.
 */
export function CategorySelect({ value, categories, onChange, disabled, className }: {
  value: string;
  categories: CategoryOption[];
  onChange: (categoryId: string) => void;
  disabled?: boolean;
  className?: string;
}) {
  const groups = useMemo(() => {
    const m = new Map<string, CategoryOption[]>();
    for (const c of categories) {
      const g = c.parent ?? "—";
      if (!m.has(g)) m.set(g, []);
      m.get(g)!.push(c);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [categories]);

  return (
    <select value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}
      className={cn("h-8 w-full max-w-[14rem] rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50", className)}>
      {groups.map(([g, cs]) => (
        <optgroup key={g} label={g}>
          {cs.sort((a, b) => a.name.localeCompare(b.name)).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </optgroup>
      ))}
    </select>
  );
}
