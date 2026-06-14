import Link from "next/link";
import { notFound } from "next/navigation";
import { loadDrillData } from "@/lib/server/load-drill";
import { bucketDrill } from "@/lib/drilldown";
import { classifyParent } from "@/lib/halan";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MonthSelect } from "@/components/month-select";
import { BucketLeaves } from "@/components/dashboard/bucket-leaves";
import { formatINR, formatMonth } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function BucketPage({
  params, searchParams,
}: { params: Promise<{ bucket: string }>; searchParams: Promise<{ month?: string }> }) {
  const { bucket: prefix } = await params;
  if (!/^(0[1-9]|1[0-5])$/.test(prefix)) notFound();

  const { drillTxns, categoryOptions, months } = await loadDrillData();
  // The 15 parent buckets are the only "NN Name" category rows — resolve the prefix to its full name.
  const parentName = categoryOptions.find((c) => c.name.startsWith(`${prefix} `))?.name;
  if (!parentName) notFound();

  const sp = await searchParams;
  const month = sp.month && months.includes(sp.month) ? sp.month : (months[months.length - 1] ?? "");
  const monthTxns = drillTxns.filter((t) => t.txnDate.slice(0, 7) === month);
  const { inflowPaise, outflowPaise, netPaise, leaves } = bucketDrill(monthTxns, parentName);
  const cls = classifyParent(parentName).replace(/_/g, " ");

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href="/dashboard" className="text-xs text-muted-foreground hover:text-foreground">← Dashboard</Link>
          <h1 className="text-2xl font-semibold tracking-tight">{parentName}</h1>
          <p className="text-sm text-muted-foreground">{cls} bucket · what&apos;s categorized here for {month ? formatMonth(month) : "—"}.</p>
        </div>
        <MonthSelect months={months} value={month} />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card><CardHeader className="pb-2"><CardDescription>In</CardDescription></CardHeader>
          <CardContent><div className="text-2xl font-semibold tracking-tight text-income">{formatINR(inflowPaise)}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardDescription>Out</CardDescription></CardHeader>
          <CardContent><div className="text-2xl font-semibold tracking-tight text-destructive">{formatINR(outflowPaise)}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardDescription>Net</CardDescription></CardHeader>
          <CardContent><div className={`text-2xl font-semibold tracking-tight ${netPaise < 0 ? "text-destructive" : "text-income"}`}>{formatINR(netPaise, { sign: true })}</div></CardContent></Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Categories</CardTitle>
          <CardDescription>{leaves.length} categor{leaves.length === 1 ? "y" : "ies"} · expand a row to see and re-categorize its transactions.</CardDescription>
        </CardHeader>
        <CardContent>
          <BucketLeaves leaves={leaves} categories={categoryOptions} />
        </CardContent>
      </Card>
    </div>
  );
}
