"use client";
import { useMemo, useRef, useState } from "react";
import { filterCategoryOptions, type PickerOption } from "@/lib/category-filter";
import { cn } from "@/lib/utils";

export type CategoryPickerOption = PickerOption;

/**
 * Searchable, id-valued category picker. Collapsed state is a select-styled button showing the
 * current category (this IS the lazy mount — the option list only exists in the DOM while open).
 * Search matches leaf name OR parent bucket name; each result renders under its parent bucket header
 * (the "which bucket is this in" context). The 15 parent buckets themselves are never selectable —
 * only leaves are valid categories to assign.
 */
export function CategoryPicker({ value, categories, onChange, disabled, className, placeholder }: {
  value: string;
  categories: CategoryPickerOption[];
  onChange: (categoryId: string) => void;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const groups = useMemo(() => filterCategoryOptions(categories, query), [categories, query]);
  const flat = useMemo(() => groups.flatMap((g) => g.options), [groups]);
  const currentName = categories.find((c) => c.id === value)?.name ?? "";

  function openPicker() {
    if (disabled) return;
    setQuery("");
    setHighlight(0);
    setOpen(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function select(id: string) {
    onChange(id);
    setOpen(false);
    setQuery("");
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") { e.preventDefault(); setHighlight((h) => Math.min(flat.length - 1, h + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHighlight((h) => Math.max(0, h - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); const opt = flat[highlight]; if (opt) select(opt.id); }
    else if (e.key === "Escape") { e.preventDefault(); setOpen(false); }
  }

  function onBlurCapture(e: React.FocusEvent<HTMLDivElement>) {
    if (!wrapRef.current?.contains(e.relatedTarget as Node | null)) setOpen(false);
  }

  return (
    <div ref={wrapRef} className="relative" onBlurCapture={onBlurCapture}>
      {!open ? (
        <button type="button" disabled={disabled} onClick={openPicker}
          className={cn("h-8 w-full max-w-[14rem] truncate rounded-md border border-input bg-background px-2 text-left text-xs hover:bg-accent/40 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-ring", className)}>
          {currentName || placeholder || "Select category…"}
        </button>
      ) : (
        <div className="absolute left-0 top-0 z-20 w-64 rounded-md border bg-background shadow-md">
          <input ref={inputRef} value={query} onChange={(e) => { setQuery(e.target.value); setHighlight(0); }}
            onKeyDown={onKeyDown} placeholder="Search categories…"
            className="w-full border-b bg-transparent px-2 py-1.5 text-xs outline-none" />
          <div className="max-h-64 overflow-auto py-1">
            {flat.length === 0 && <div className="px-2 py-1.5 text-xs text-muted-foreground">No matches</div>}
            {groups.map((g) => (
              <div key={g.parent}>
                <div className="px-2 pt-1.5 pb-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{g.parent}</div>
                {g.options.map((o) => {
                  const idx = flat.indexOf(o);
                  return (
                    <button key={o.id} type="button" role="option" aria-selected={o.id === value}
                      onMouseDown={(e) => { e.preventDefault(); select(o.id); }}
                      onMouseEnter={() => setHighlight(idx)}
                      className={cn("block w-full truncate px-2 py-1 text-left text-xs hover:bg-accent",
                        idx === highlight && "bg-accent", o.id === value && "font-medium")}>
                      {o.name}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
