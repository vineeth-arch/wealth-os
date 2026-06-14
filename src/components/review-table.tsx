"use client";
import { useMemo, useState } from "react";
import { createSupabaseBrowser } from "@/lib/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { CategorySelect, type CategoryOption } from "@/components/category-select";
import { updateTxnCategory } from "@/lib/client/category-write";
import { cn } from "@/lib/utils";
import { formatINR, formatDate } from "@/lib/format";
import { Check } from "lucide-react";

export type ReviewCategory = CategoryOption;
export interface ReviewTxn { id: string; date: string; amountPaise: number; description: string; merchant: string; tags: string[]; categoryId: string; categorySource: string; accountName: string }

const LEAKAGE = "leakage";
const REVIEW_NAME = "Uncategorized Review";

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

export function ReviewTable({ transactions, categories }: { transactions: ReviewTxn[]; categories: ReviewCategory[] }) {
  const [rows, setRows] = useState(transactions);
  const [sourceFilter, setSourceFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [saved, setSaved] = useState<Record<string, boolean>>({});

  const reviewId = useMemo(() => categories.find((c) => c.name === REVIEW_NAME)?.id ?? "", [categories]);
  const validIds = useMemo(() => new Set(categories.map((c) => c.id)), [categories]);

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

  function flashSaved(id: string) {
    setSaved((s) => ({ ...s, [id]: true }));
    setTimeout(() => setSaved((s) => ({ ...s, [id]: false })), 1200);
  }

  async function setCategory(id: string, categoryId: string) {
    // Optimistically stamp it as a user edit so the "edited" badge + filter reflect immediately.
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, categoryId, categorySource: "user" } : r)));
    const { error } = await updateTxnCategory(id, categoryId, validIds);
    if (!error) flashSaved(id);
  }
  async function toggleLeakage(id: string) {
    const row = rows.find((r) => r.id === id)!;
    const has = row.tags.includes(LEAKAGE);
    const tags = has ? row.tags.filter((t) => t !== LEAKAGE) : [...row.tags, LEAKAGE];
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, tags } : r)));
    const supabase = createSupabaseBrowser();
    const { error } = await supabase.from("transactions").update({ tags }).eq("id", id);
    if (!error) flashSaved(id);
  }

  const reviewCount = rows.filter((r) => r.categoryId === reviewId).length;
  const changedCount = rows.filter((r) => r.categorySource === "user").length;

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm text-muted-foreground">
            {reviewCount} in {REVIEW_NAME} · {changedCount} edited · {visible.length} shown
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
        <Table>
          <TableHeader>
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
            {visible.map((r) => {
              const leak = r.tags.includes(LEAKAGE);
              return (
                <TableRow key={r.id}>
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
                      <CategorySelect value={r.categoryId} categories={categories} onChange={(cid) => setCategory(r.id, cid)} />
                      {saved[r.id] && <Check className="h-3.5 w-3.5 text-income" />}
                    </div>
                    {SOURCE_BADGE[r.categorySource] && <Badge variant="secondary" className="mt-1 text-[10px]">{SOURCE_BADGE[r.categorySource]}</Badge>}
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
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
