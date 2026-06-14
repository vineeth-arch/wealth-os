"use client";
import { DrillTxnRow } from "@/components/dashboard/drill-txn-row";
import { type BucketLeaf } from "@/lib/drilldown";
import { type CategoryOption } from "@/components/category-select";
import { formatINR } from "@/lib/format";

/**
 * Leaf categories of a Halan bucket for the period, each expandable to its transactions. Rows are
 * inline re-categorizable (shared DrillTxnRow → category_source='user'). Shows signed net per leaf so
 * income/transfer buckets read correctly, not just spend.
 */
export function BucketLeaves({ leaves, categories }: { leaves: BucketLeaf[]; categories: CategoryOption[] }) {
  if (leaves.length === 0) return <p className="text-sm text-muted-foreground">Nothing categorized here this period.</p>;
  return (
    <div>
      {leaves.map((lf) => (
        <details key={lf.categoryName} className="border-b last:border-0">
          <summary className="flex cursor-pointer items-center justify-between py-2 text-sm marker:text-muted-foreground">
            <span className="font-medium">{lf.categoryName} <span className="text-xs text-muted-foreground">· {lf.count}</span></span>
            <span className={`font-medium ${lf.netPaise < 0 ? "text-destructive" : "text-income"}`}>{formatINR(lf.netPaise, { sign: true })}</span>
          </summary>
          <div className="pb-2">
            {lf.txns.map((t) => <DrillTxnRow key={t.id} t={t} categories={categories} />)}
          </div>
        </details>
      ))}
    </div>
  );
}
