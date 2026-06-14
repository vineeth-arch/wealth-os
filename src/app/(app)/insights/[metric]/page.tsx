import Link from "next/link";
import { notFound } from "next/navigation";
import { loadDrillData } from "@/lib/server/load-drill";
import { breakdownByAccount, topNTransactions, metricValue, type DrillMetric } from "@/lib/drilldown";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MetricTrendChart } from "@/components/charts";
import { MonthSelect } from "@/components/month-select";
import { InsightTxnList } from "@/components/dashboard/insight-txn-list";
import { formatINR, formatMonth } from "@/lib/format";

export const dynamic = "force-dynamic";

const META: Record<DrillMetric, { label: string; tone: string; color: string; blurb: string }> = {
  income:  { label: "Income",  tone: "text-income",  color: "hsl(152 60% 42%)", blurb: "Money in, by account and the largest credits." },
  spend:   { label: "Spend",   tone: "text-foreground", color: "hsl(0 72% 55%)", blurb: "Money out across the spend buckets, by account." },
  invest:  { label: "Invested", tone: "text-invest",  color: "hsl(173 58% 36%)", blurb: "Contributions into Invest-it, by account." },
  leakage: { label: "Leakage", tone: "text-leakage",  color: "hsl(36 92% 52%)", blurb: "Spend tagged as leakage — the watchlist outflow." },
  net:     { label: "Net cash flow", tone: "text-foreground", color: "hsl(217 91% 60%)", blurb: "Income − spend − invest: what's left over this month." },
};
const METRICS = Object.keys(META) as DrillMetric[];

export default async function InsightPage({
  params, searchParams,
}: { params: Promise<{ metric: string }>; searchParams: Promise<{ month?: string }> }) {
  const { metric: metricParam } = await params;
  if (!METRICS.includes(metricParam as DrillMetric)) notFound();
  const metric = metricParam as DrillMetric;
  const meta = META[metric];

  const { drillTxns, categoryOptions, months } = await loadDrillData();
  const sp = await searchParams;
  const month = sp.month && months.includes(sp.month) ? sp.month : (months[months.length - 1] ?? "");

  const byAccount = breakdownByAccount(drillTxns, metric, month);
  const headline = byAccount.reduce((s, a) => s + a.subtotalPaise, 0);
  const contributing = topNTransactions(drillTxns, metric, month, drillTxns.length);
  const trend = months.map((m) => ({
    month: m,
    value: drillTxns.reduce((s, t) => (t.txnDate.slice(0, 7) === m ? s + (metricValue(t, metric) ?? 0) : s), 0),
  }));

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href="/dashboard" className="text-xs text-muted-foreground hover:text-foreground">← Dashboard</Link>
          <h1 className={`text-2xl font-semibold tracking-tight ${meta.tone}`}>{meta.label}</h1>
          <p className="text-sm text-muted-foreground">{meta.blurb}</p>
        </div>
        <MonthSelect months={months} value={month} />
      </div>

      <Card>
        <CardHeader className="pb-2"><CardDescription>{meta.label} · {month ? formatMonth(month) : "—"}</CardDescription></CardHeader>
        <CardContent>
          <div className={`text-3xl font-semibold tracking-tight ${meta.tone}`}>{formatINR(headline)}</div>
          {months.length > 1 && <div className="mt-4"><MetricTrendChart data={trend} name={meta.label} color={meta.color} selected={month} /></div>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">By account</CardTitle>
          <CardDescription>Subtotals sum to the headline above.</CardDescription>
        </CardHeader>
        <CardContent>
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
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Transactions</CardTitle>
          <CardDescription>Largest first. Re-categorize inline — changes save instantly and surface in Review.</CardDescription>
        </CardHeader>
        <CardContent>
          <InsightTxnList txns={contributing} categories={categoryOptions} />
        </CardContent>
      </Card>
    </div>
  );
}
