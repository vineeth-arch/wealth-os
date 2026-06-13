"use client";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardDescription } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { breakdownByAccount, topNTransactions, type DrillTxn, type DrillMetric } from "@/lib/drilldown";
import { DrillTxnRow } from "@/components/dashboard/drill-txn-row";
import { type CategoryOption } from "@/components/category-select";
import { formatINR, formatMonth } from "@/lib/format";

const META: Record<DrillMetric, { label: string; tone: string }> = {
  income: { label: "Income", tone: "text-income" },
  spend: { label: "Spend", tone: "text-foreground" },
  invest: { label: "Invested", tone: "text-invest" },
  leakage: { label: "Leakage", tone: "text-leakage" },
};
const ORDER: DrillMetric[] = ["income", "spend", "invest", "leakage"];

/**
 * The four monthly cash-flow KPIs, each clickable to a drill-down (breakdown by account + top 5 txns).
 * Pure aggregation runs client-side on the rows the dashboard already loaded — see src/lib/drilldown.ts.
 */
export function FlowKpis({ txns, month, totals, categories }: { txns: DrillTxn[]; month: string; totals: Record<DrillMetric, number>; categories: CategoryOption[] }) {
  const [metric, setMetric] = useState<DrillMetric | null>(null);
  return (
    <>
      {ORDER.map((m) => (
        <button key={m} onClick={() => setMetric(m)} className="text-left focus:outline-none">
          <Card className="h-full transition-colors hover:border-ring hover:bg-accent/40">
            <CardHeader className="pb-2"><CardDescription>{META[m].label} · {formatMonth(month)}</CardDescription></CardHeader>
            <CardContent>
              <div className={`text-2xl font-semibold tracking-tight ${META[m].tone}`}>{formatINR(totals[m])}</div>
              <div className="mt-1 text-xs text-muted-foreground">Click to break down</div>
            </CardContent>
          </Card>
        </button>
      ))}

      <Dialog open={metric !== null} onOpenChange={(o) => !o && setMetric(null)}>
        <DialogContent>
          {metric && <DrillBody txns={txns} metric={metric} month={month} categories={categories} />}
        </DialogContent>
      </Dialog>
    </>
  );
}

function DrillBody({ txns, metric, month, categories }: { txns: DrillTxn[]; metric: DrillMetric; month: string; categories: CategoryOption[] }) {
  const byAccount = breakdownByAccount(txns, metric, month);
  const top = topNTransactions(txns, metric, month, 5);
  const headline = byAccount.reduce((s, a) => s + a.subtotalPaise, 0);

  return (
    <>
      <DialogHeader>
        <DialogTitle>{META[metric].label} · {formatMonth(month)}</DialogTitle>
        <DialogDescription>Where this {formatINR(headline)} came from — by account and the largest transactions.</DialogDescription>
      </DialogHeader>

      <div className="overflow-y-auto">
        <div className="mb-4">
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">By account</div>
          {byAccount.length === 0 && <p className="text-sm text-muted-foreground">No transactions in this month.</p>}
          {byAccount.map((a) => (
            <div key={a.accountId} className="flex items-center justify-between border-b py-1.5 text-sm last:border-0">
              <span className="text-muted-foreground">{a.accountName || "—"} <span className="text-xs">· {a.count}</span></span>
              <span className="font-medium">{formatINR(a.subtotalPaise)}</span>
            </div>
          ))}
          {byAccount.length > 0 && (
            <div className="flex items-center justify-between pt-1.5 text-sm font-semibold">
              <span>Total</span><span>{formatINR(headline)}</span>
            </div>
          )}
        </div>

        <div>
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Top {Math.min(5, top.length)} transactions</div>
          {top.length === 0 && <p className="text-sm text-muted-foreground">Nothing to show.</p>}
          {top.map((t) => <DrillTxnRow key={t.id} t={t} categories={categories} />)}
        </div>
      </div>
    </>
  );
}
