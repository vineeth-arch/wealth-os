"use client";
import { useMemo, useState } from "react";
import { createSupabaseBrowser } from "@/lib/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatINR, formatDate } from "@/lib/format";
import { Check } from "lucide-react";

export interface ReviewCategory { id: string; name: string; parent: string | null }
export interface ReviewTxn { id: string; date: string; amountPaise: number; description: string; tags: string[]; categoryId: string; accountName: string }

const LEAKAGE = "leakage";
const REVIEW_NAME = "Uncategorized Review";

export function ReviewTable({ transactions, categories }: { transactions: ReviewTxn[]; categories: ReviewCategory[] }) {
  const [rows, setRows] = useState(transactions);
  const [onlyReview, setOnlyReview] = useState(false);
  const [saved, setSaved] = useState<Record<string, boolean>>({});

  const reviewId = useMemo(() => categories.find((c) => c.name === REVIEW_NAME)?.id ?? "", [categories]);
  const groups = useMemo(() => {
    const m = new Map<string, ReviewCategory[]>();
    for (const c of categories) {
      const g = c.parent ?? "—";
      if (!m.has(g)) m.set(g, []);
      m.get(g)!.push(c);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [categories]);

  const visible = onlyReview ? rows.filter((r) => r.categoryId === reviewId) : rows;

  function flashSaved(id: string) {
    setSaved((s) => ({ ...s, [id]: true }));
    setTimeout(() => setSaved((s) => ({ ...s, [id]: false })), 1200);
  }

  async function setCategory(id: string, categoryId: string) {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, categoryId } : r)));
    const supabase = createSupabaseBrowser();
    const { error } = await supabase.from("transactions").update({ category_id: categoryId, category_source: "user" }).eq("id", id);
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

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-sm text-muted-foreground">{reviewCount} in {REVIEW_NAME}</span>
          <Button variant={onlyReview ? "default" : "outline"} size="sm" onClick={() => setOnlyReview((v) => !v)}>
            {onlyReview ? "Showing review only" : "Only needs review"}
          </Button>
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
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{formatDate(r.date)}</TableCell>
                  <TableCell className="truncate text-xs text-muted-foreground">{r.accountName}</TableCell>
                  <TableCell className="max-w-[20rem] truncate text-xs" title={r.description}>{r.description}</TableCell>
                  <TableCell className={cn("whitespace-nowrap text-right text-xs font-medium", r.amountPaise < 0 ? "text-destructive" : "text-income")}>
                    {formatINR(r.amountPaise, { sign: true })}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <select value={r.categoryId} onChange={(e) => setCategory(r.id, e.target.value)}
                        className="h-8 w-full max-w-[14rem] rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-2 focus:ring-ring">
                        {groups.map(([g, cs]) => (
                          <optgroup key={g} label={g}>
                            {cs.sort((a, b) => a.name.localeCompare(b.name)).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                          </optgroup>
                        ))}
                      </select>
                      {saved[r.id] && <Check className="h-3.5 w-3.5 text-income" />}
                    </div>
                  </TableCell>
                  <TableCell>
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
