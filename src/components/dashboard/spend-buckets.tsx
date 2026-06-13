"use client";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { bucketDrill, type DrillTxn } from "@/lib/drilldown";
import { DrillTxnRow } from "@/components/dashboard/drill-txn-row";
import { type CategoryOption } from "@/components/category-select";
import { formatINR } from "@/lib/format";
import { TrendingDown, AlertTriangle } from "lucide-react";

interface Bucket { parent: string; outflowPaise: number; count: number }
interface Leak { parent: string; paise: number; count: number }
type DrillState = { parent: string; mode: "bucket" | "leakage" } | null;

/**
 * "Where money went" + "Leakage watchlist" with clickable rows. Clicking a parent bucket opens a
 * drill listing every txn in it (all-time, matching the displayed total), grouped by leaf category and
 * expandable. Pure aggregation = bucketDrill (src/lib/drilldown.ts); leakage rows drill the same shape
 * over only the leakage-tagged subset, so the drill total matches the row.
 */
export function SpendBuckets({ txns, buckets, leak, categories }: { txns: DrillTxn[]; buckets: Bucket[]; leak: Leak[]; categories: CategoryOption[] }) {
  const [drill, setDrill] = useState<DrillState>(null);
  const maxBucket = Math.max(1, ...buckets.map((b) => b.outflowPaise));
  const maxLeak = Math.max(1, ...leak.map((l) => l.paise));
  const totalLeak = leak.reduce((s, l) => s + l.paise, 0);

  return (
    <>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><TrendingDown className="h-5 w-5" /> Where money went</CardTitle>
            <CardDescription>Spend by Halan bucket, all time. Click a bucket to see its transactions.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {buckets.length === 0 && <p className="text-sm text-muted-foreground">No categorized spend yet.</p>}
            {buckets.map((b) => (
              <button key={b.parent} onClick={() => setDrill({ parent: b.parent, mode: "bucket" })}
                className="block w-full space-y-1 rounded-md text-left transition-colors hover:bg-accent/40 focus:outline-none focus:ring-2 focus:ring-ring">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{b.parent} · {b.count}</span>
                  <span className="font-medium">{formatINR(b.outflowPaise)}</span>
                </div>
                <div className="h-2 w-full rounded-full bg-muted">
                  <div className="h-2 rounded-full bg-primary" style={{ width: `${(b.outflowPaise / maxBucket) * 100}%` }} />
                </div>
              </button>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-leakage" /> Leakage watchlist</CardTitle>
            <CardDescription>Total tagged leakage: <span className="font-medium text-leakage">{formatINR(totalLeak)}</span></CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {leak.length === 0 && <p className="text-sm text-muted-foreground">No leakage tagged yet. Tag impulse spends during review.</p>}
            {leak.map((l) => (
              <button key={l.parent} onClick={() => setDrill({ parent: l.parent, mode: "leakage" })}
                className="block w-full space-y-1 rounded-md text-left transition-colors hover:bg-accent/40 focus:outline-none focus:ring-2 focus:ring-ring">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{l.parent} · {l.count}</span>
                  <span className="font-medium text-leakage">{formatINR(l.paise)}</span>
                </div>
                <div className="h-2 w-full rounded-full bg-muted">
                  <div className="h-2 rounded-full bg-leakage" style={{ width: `${(l.paise / maxLeak) * 100}%` }} />
                </div>
              </button>
            ))}
          </CardContent>
        </Card>
      </div>

      <Dialog open={drill !== null} onOpenChange={(o) => !o && setDrill(null)}>
        <DialogContent>
          {drill && <BucketBody txns={txns} parent={drill.parent} mode={drill.mode} categories={categories} />}
        </DialogContent>
      </Dialog>
    </>
  );
}

function BucketBody({ txns, parent, mode, categories }: { txns: DrillTxn[]; parent: string; mode: "bucket" | "leakage"; categories: CategoryOption[] }) {
  const source = mode === "leakage" ? txns.filter((t) => t.tags.includes("leakage")) : txns;
  const { totalPaise, leaves } = bucketDrill(source, parent);
  return (
    <>
      <DialogHeader>
        <DialogTitle>{mode === "leakage" ? "Leakage · " : ""}{parent}</DialogTitle>
        <DialogDescription>{formatINR(totalPaise)} across {leaves.length} categor{leaves.length === 1 ? "y" : "ies"} · click a category to expand.</DialogDescription>
      </DialogHeader>
      <div className="overflow-y-auto">
        {leaves.length === 0 && <p className="text-sm text-muted-foreground">No transactions.</p>}
        {leaves.map((lf) => (
          <details key={lf.categoryName} className="border-b last:border-0">
            <summary className="flex cursor-pointer items-center justify-between py-2 text-sm marker:text-muted-foreground">
              <span className="font-medium">{lf.categoryName} <span className="text-xs text-muted-foreground">· {lf.count}</span></span>
              <span className="font-medium">{formatINR(lf.outflowPaise)}</span>
            </summary>
            <div className="pb-2">
              {lf.txns.map((t) => <DrillTxnRow key={t.id} t={t} categories={categories} />)}
            </div>
          </details>
        ))}
      </div>
    </>
  );
}
