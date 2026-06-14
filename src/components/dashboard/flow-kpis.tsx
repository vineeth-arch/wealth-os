import Link from "next/link";
import { Card, CardContent, CardHeader, CardDescription } from "@/components/ui/card";
import { type DrillMetric } from "@/lib/drilldown";
import { formatINR, formatMonth } from "@/lib/format";

const META: Record<DrillMetric, { label: string; tone: string }> = {
  income: { label: "Income", tone: "text-income" },
  spend: { label: "Spend", tone: "text-foreground" },
  invest: { label: "Invested", tone: "text-invest" },
  leakage: { label: "Leakage", tone: "text-leakage" },
  net: { label: "Net", tone: "text-foreground" },
};
const ORDER: DrillMetric[] = ["income", "spend", "invest", "leakage", "net"];

/**
 * The monthly cash-flow KPIs. Each card links to its dedicated insight page (/insights/[metric]) —
 * provenance by account, the trend, and the full inline-editable transaction list. No more modal.
 */
export function FlowKpis({ month, totals }: { month: string; totals: Record<DrillMetric, number> }) {
  return (
    <>
      {ORDER.map((m) => (
        <Link key={m} href={`/insights/${m}?month=${month}`} className="focus:outline-none">
          <Card className="h-full transition-colors hover:border-ring hover:bg-accent/40">
            <CardHeader className="pb-2"><CardDescription>{META[m].label} · {formatMonth(month)}</CardDescription></CardHeader>
            <CardContent>
              <div className={`text-2xl font-semibold tracking-tight ${META[m].tone}`}>{formatINR(totals[m])}</div>
              <div className="mt-1 text-xs text-muted-foreground">View details</div>
            </CardContent>
          </Card>
        </Link>
      ))}
    </>
  );
}
