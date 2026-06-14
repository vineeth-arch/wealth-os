"use client";
import { useState } from "react";
import { DrillTxnRow } from "@/components/dashboard/drill-txn-row";
import { type DrillTxn } from "@/lib/drilldown";
import { type CategoryOption } from "@/components/category-select";

const PAGE = 25;

/**
 * Full, paginated list of the transactions contributing to a metric/bucket. Each row is inline
 * re-categorizable via the shared DrillTxnRow (writes category_source='user'). Starts at PAGE rows
 * and reveals PAGE more per click so a busy month doesn't render hundreds of rows up front.
 */
export function InsightTxnList({ txns, categories }: { txns: DrillTxn[]; categories: CategoryOption[] }) {
  const [shown, setShown] = useState(PAGE);
  if (txns.length === 0) return <p className="text-sm text-muted-foreground">No transactions in this period.</p>;
  return (
    <div>
      {txns.slice(0, shown).map((t) => <DrillTxnRow key={t.id} t={t} categories={categories} />)}
      {shown < txns.length && (
        <button onClick={() => setShown((s) => s + PAGE)}
          className="mt-3 w-full rounded-md border border-input py-2 text-xs font-medium hover:bg-accent">
          Show {Math.min(PAGE, txns.length - shown)} more · {txns.length - shown} remaining
        </button>
      )}
    </div>
  );
}
