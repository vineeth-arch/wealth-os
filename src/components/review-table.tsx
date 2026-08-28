"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useVirtualizer } from "@tanstack/react-virtual";
import { createSupabaseBrowser } from "@/lib/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { type CategoryOption } from "@/components/category-select";
import { CategoryPicker } from "@/components/category-picker";
import { updateTxnCategory } from "@/lib/client/category-write";
import { cn } from "@/lib/utils";
import { formatINR, formatDate } from "@/lib/format";
import { Check } from "lucide-react";

export type ReviewCategory = CategoryOption;
export interface ReviewTxn { id: string; date: string; amountPaise: number; description: string; merchant: string; tags: string[]; categoryId: string; categorySource: string; accountName: string }

const LEAKAGE = "leakage";

// category_source → short badge label shown per row. "default" shows nothing (it's the Uncategorized fallback).
const SOURCE_BADGE: Record<string, string> = { user: "you", rule: "rule", ai_suggested: "AI" };
// Source filter options: value is the category_source to match ("" = all).
const SOURCE_FILTERS: Array<{ value: string; label: string }> = [
  { value: "", label: "All sources" },
  { value: "default", label: "Needs review" },
  { value: "user", label: "You" },
  { value: "ai_suggested", label: "AI" },
  { value: "rule", label: "Rule" },
];

type PendingPatch = Pick<ReviewTxn, "categoryId" | "categorySource" | "tags">;

const ROW_ESTIMATE_PX = 64;
const INITIAL_LIMIT = 100;
const LOAD_MORE_STEP = 100;

export function ReviewTable({ transactions, categories, reviewCategoryId, reviewTotal }: {
  transactions: ReviewTxn[];
  categories: ReviewCategory[];
  reviewCategoryId: string;
  reviewTotal: number;
}) {
  const router = useRouter();
  const [rows, setRows] = useState(transactions);
  const [sourceFilter, setSourceFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [saved, setSaved] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [limit, setLimit] = useState(INITIAL_LIMIT);
  const [delta, setDelta] = useState(0);

  // Optimistic edits in flight, keyed by txn id. Overlaid onto fresh server props so a concurrent
  // router.refresh() (triggered by another row's completed save, or a sibling panel) can never revert
  // an edit that's still in-flight.
  const pendingRef = useRef(new Map<string, PendingPatch>());

  useEffect(() => {
    setRows(transactions.map((t) => {
      const p = pendingRef.current.get(t.id);
      return p ? { ...t, ...p } : t;
    }));
    // The server-supplied reviewTotal is ground truth as of this render; any optimistic delta from a
    // write that has since round-tripped (router.refresh()) is already folded in — start counting fresh.
    setDelta(0);
  }, [transactions, reviewTotal]);

  const validIds = useMemo(() => new Set(categories.map((c) => c.id)), [categories]);
  const reviewCategoryName = categories.find((c) => c.id === reviewCategoryId)?.name ?? "the review category";

  // Grouped (optgroup-by-parent) options for the category filter, with an "All categories" sentinel.
  const categoryGroups = useMemo(() => {
    const m = new Map<string, ReviewCategory[]>();
    for (const c of categories) {
      const g = c.parent ?? "—";
      if (!m.has(g)) m.set(g, []);
      m.get(g)!.push(c);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [categories]);

  // Independent filters combined AND-wise: by category_source and by assigned category.
  const visible = rows.filter((r) =>
    (sourceFilter === "" || r.categorySource === sourceFilter) &&
    (categoryFilter === "" || r.categoryId === categoryFilter),
  );
  const shown = visible.slice(0, limit);

  function flashSaved(id: string) {
    setSaved((s) => ({ ...s, [id]: true }));
    setTimeout(() => setSaved((s) => ({ ...s, [id]: false })), 1200);
  }

  async function commitPatch(id: string, patch: PendingPatch, write: () => Promise<{ error: string | null }>) {
    const prior = rows.find((r) => r.id === id);
    if (!prior) return;
    const wasReview = prior.categoryId === reviewCategoryId;
    const willBeReview = patch.categoryId === reviewCategoryId;

    pendingRef.current.set(id, patch);
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    setErrors((e) => { const n = { ...e }; delete n[id]; return n; });
    if (wasReview && !willBeReview) setDelta((d) => d - 1);
    else if (!wasReview && willBeReview) setDelta((d) => d + 1);

    const { error } = await write();
    pendingRef.current.delete(id);

    if (error) {
      setRows((rs) => rs.map((r) => (r.id === id ? { ...r, categoryId: prior.categoryId, categorySource: prior.categorySource, tags: prior.tags } : r)));
      if (wasReview && !willBeReview) setDelta((d) => d + 1);
      else if (!wasReview && willBeReview) setDelta((d) => d - 1);
      setErrors((e) => ({ ...e, [id]: error }));
      return;
    }
    flashSaved(id);
    router.refresh();
  }

  async function setCategory(id: string, categoryId: string) {
    await commitPatch(id, { categoryId, categorySource: "user", tags: rows.find((r) => r.id === id)?.tags ?? [] },
      () => updateTxnCategory(id, categoryId, validIds));
  }

  async function toggleLeakage(id: string) {
    const row = rows.find((r) => r.id === id);
    if (!row) return;
    const has = row.tags.includes(LEAKAGE);
    const tags = has ? row.tags.filter((t) => t !== LEAKAGE) : [...row.tags, LEAKAGE];
    await commitPatch(id, { categoryId: row.categoryId, categorySource: row.categorySource, tags }, async () => {
      const supabase = createSupabaseBrowser();
      const { error } = await supabase.from("transactions").update({ tags }).eq("id", id);
      return { error: error?.message ?? null };
    });
  }

  const reviewCount = Math.max(0, reviewTotal + delta);
  const changedCount = rows.filter((r) => r.categorySource === "user").length;

  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: shown.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_ESTIMATE_PX,
    overscan: 8,
  });
  const virtualItems = virtualizer.getVirtualItems();
  const paddingTop = virtualItems.length > 0 ? virtualItems[0].start : 0;
  const paddingBottom = virtualItems.length > 0 ? virtualizer.getTotalSize() - virtualItems[virtualItems.length - 1].end : 0;

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm text-muted-foreground">
            {reviewCount} in {reviewCategoryName} · {changedCount} edited · {visible.length} shown
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)}
              aria-label="Filter by source"
              className="h-8 rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-2 focus:ring-ring">
              {SOURCE_FILTERS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
            <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}
              aria-label="Filter by category"
              className="h-8 max-w-[14rem] rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-2 focus:ring-ring">
              <option value="">All categories</option>
              {categoryGroups.map(([g, cs]) => (
                <optgroup key={g} label={g}>
                  {cs.sort((a, b) => a.name.localeCompare(b.name)).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </optgroup>
              ))}
            </select>
          </div>
        </div>
        <div ref={scrollRef} className="max-h-[70vh] overflow-auto rounded-md border">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-background">
              <TableRow>
                <TableHead className="w-[92px]">Date</TableHead>
                <TableHead className="w-[120px]">Account</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="w-[16rem]">Category</TableHead>
                <TableHead className="w-[96px]">Leakage</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paddingTop > 0 && <TableRow><TableCell colSpan={6} style={{ height: paddingTop, padding: 0 }} /></TableRow>}
              {virtualItems.map((vi) => {
                const r = shown[vi.index];
                const leak = r.tags.includes(LEAKAGE);
                return (
                  <TableRow key={r.id} data-index={vi.index} ref={virtualizer.measureElement}>
                    <TableCell className="whitespace-nowrap align-top text-xs text-muted-foreground">{formatDate(r.date)}</TableCell>
                    <TableCell className="truncate align-top text-xs text-muted-foreground">{r.accountName}</TableCell>
                    <TableCell className="max-w-[20rem] align-top text-xs">
                      <div className="whitespace-normal break-words">{r.description}</div>
                      {r.merchant && <div className="whitespace-normal break-words text-[11px] text-muted-foreground">{r.merchant}</div>}
                    </TableCell>
                    <TableCell className={cn("whitespace-nowrap align-top text-right text-xs font-medium", r.amountPaise < 0 ? "text-destructive" : "text-income")}>
                      {formatINR(r.amountPaise, { sign: true })}
                    </TableCell>
                    <TableCell className="align-top">
                      <div className="flex items-center gap-1">
                        <CategoryPicker value={r.categoryId} categories={categories}
                          onChange={(cid) => setCategory(r.id, cid)} />
                        {saved[r.id] && <Check className="h-3.5 w-3.5 shrink-0 text-income" />}
                      </div>
                      {SOURCE_BADGE[r.categorySource] && <Badge variant="secondary" className="mt-1 text-[10px]">{SOURCE_BADGE[r.categorySource]}</Badge>}
                      {errors[r.id] && <p className="mt-1 text-[10px] text-destructive">{errors[r.id]}</p>}
                    </TableCell>
                    <TableCell className="align-top">
                      <button onClick={() => toggleLeakage(r.id)}
                        className={cn("rounded-full px-2 py-0.5 text-xs font-medium transition-colors",
                          leak ? "bg-leakage/20 text-leakage" : "bg-muted text-muted-foreground hover:bg-leakage/10")}>
                        {leak ? "leakage" : "tag"}
                      </button>
                    </TableCell>
                  </TableRow>
                );
              })}
              {paddingBottom > 0 && <TableRow><TableCell colSpan={6} style={{ height: paddingBottom, padding: 0 }} /></TableRow>}
            </TableBody>
          </Table>
        </div>
        {visible.length > limit && (
          <button type="button" onClick={() => setLimit((l) => l + LOAD_MORE_STEP)}
            className="mt-3 w-full rounded-md border border-dashed py-2 text-xs text-muted-foreground hover:bg-accent/40">
            Show {LOAD_MORE_STEP} more ({visible.length - limit} remaining)
          </button>
        )}
      </CardContent>
    </Card>
  );
}
