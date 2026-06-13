import Link from "next/link";
import { createSupabaseServer } from "@/lib/supabase/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CashFlowChart, type FlowPoint } from "@/components/charts";
import { formatINR, formatINRCompact, formatMonth } from "@/lib/format";
import {
  type TxnLike, monthlyCashFlow, bucketTotals, leakageByParent, accountBalances,
  classifyParent, SPEND_CLASSES,
} from "@/lib/halan";
import { TrendingUp, TrendingDown, PiggyBank, AlertTriangle, Wallet } from "lucide-react";

export const dynamic = "force-dynamic";

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "income" | "leakage" | "invest" }) {
  const color = tone === "income" ? "text-income" : tone === "leakage" ? "text-leakage" : tone === "invest" ? "text-invest" : "text-foreground";
  return (
    <Card>
      <CardHeader className="pb-2"><CardDescription>{label}</CardDescription></CardHeader>
      <CardContent>
        <div className={`text-2xl font-semibold tracking-tight ${color}`}>{value}</div>
        {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
  );
}

export default async function DashboardPage() {
  const supabase = await createSupabaseServer();
  const [{ data: accountsRaw }, { data: txnsRaw }, { data: catsRaw }] = await Promise.all([
    supabase.from("accounts").select("id,name,kind,anchor_balance_paise,anchor_date"),
    supabase.from("transactions").select("txn_date,amount_paise,tags,account_id,category_id"),
    supabase.from("categories").select("id,name,parent_id"),
  ]);

  const accounts = accountsRaw ?? [];
  const txns = txnsRaw ?? [];
  const cats = catsRaw ?? [];

  if (txns.length === 0) {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <Card>
          <CardHeader>
            <CardTitle>No transactions yet</CardTitle>
            <CardDescription>Import a statement to see net worth, cash flow, and your Halan buckets.</CardDescription>
          </CardHeader>
          <CardContent><Button asChild><Link href="/import">Import a statement</Link></Button></CardContent>
        </Card>
      </div>
    );
  }

  // category_id -> parent bucket name
  const nameById = new Map(cats.map((c) => [c.id as string, c.name as string]));
  const parentByCatId = new Map<string, string | null>();
  for (const c of cats) {
    const parentName = c.parent_id ? nameById.get(c.parent_id as string) ?? null : null;
    // a leaf's bucket is its parent; a parent maps to itself
    parentByCatId.set(c.id as string, parentName ?? (c.name as string));
  }

  const halanTxns: TxnLike[] = txns.map((t) => ({
    txnDate: t.txn_date as string,
    amountPaise: t.amount_paise as number,
    parent: t.category_id ? parentByCatId.get(t.category_id as string) ?? null : null,
    tags: (t.tags as string[]) ?? [],
  }));

  const flows = monthlyCashFlow(halanTxns);
  const flowData: FlowPoint[] = flows.map((f) => ({ month: f.month, income: f.incomePaise, spend: f.spendPaise, invest: f.investPaise }));
  const latest = flows[flows.length - 1];

  const { netWorthPaise, balances } = accountBalances(
    accounts.map((a) => ({ id: a.id as string, name: a.name as string, kind: a.kind as string, anchorBalancePaise: a.anchor_balance_paise as number | null, anchorDate: a.anchor_date as string | null })),
    txns.map((t) => ({ accountId: t.account_id as string, txnDate: t.txn_date as string, amountPaise: t.amount_paise as number })),
  );

  const buckets = bucketTotals(halanTxns).filter((b) => SPEND_CLASSES.has(b.cls) && b.outflowPaise > 0).sort((a, b) => b.outflowPaise - a.outflowPaise);
  const maxBucket = Math.max(1, ...buckets.map((b) => b.outflowPaise));
  const leak = leakageByParent(halanTxns);
  const maxLeak = Math.max(1, ...leak.map((l) => l.paise));
  const totalLeak = leak.reduce((s, l) => s + l.paise, 0);

  const reviewCount = halanTxns.filter((t) => t.parent === "10 Transfers & Adjustments" && (t.tags.length === 0)).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">{latest ? `Latest month: ${formatMonth(latest.month)}` : ""} · {txns.length} transactions</p>
        </div>
        <Button asChild variant="outline"><Link href="/import">Import</Link></Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Net worth" value={formatINR(netWorthPaise)} sub="anchored to earliest statement" />
        {latest && <Tile label={`Income · ${formatMonth(latest.month)}`} value={formatINR(latest.incomePaise)} tone="income" />}
        {latest && <Tile label={`Invested · ${formatMonth(latest.month)}`} value={formatINR(latest.investPaise)} tone="invest" />}
        {latest && <Tile label={`Leakage · ${formatMonth(latest.month)}`} value={formatINR(latest.leakagePaise)} tone="leakage" sub="tagged at review" />}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><TrendingUp className="h-5 w-5" /> Cash flow</CardTitle>
          <CardDescription>Income vs spend vs invest by month. Transfers and unreviewed items are excluded.</CardDescription>
        </CardHeader>
        <CardContent><CashFlowChart data={flowData} /></CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><TrendingDown className="h-5 w-5" /> Where money went</CardTitle>
            <CardDescription>Spend by Halan bucket, all time.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {buckets.length === 0 && <p className="text-sm text-muted-foreground">No categorized spend yet.</p>}
            {buckets.map((b) => (
              <div key={b.parent} className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{b.parent}</span>
                  <span className="font-medium">{formatINR(b.outflowPaise)}</span>
                </div>
                <div className="h-2 w-full rounded-full bg-muted">
                  <div className="h-2 rounded-full bg-primary" style={{ width: `${(b.outflowPaise / maxBucket) * 100}%` }} />
                </div>
              </div>
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
              <div key={l.parent} className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{l.parent} · {l.count}</span>
                  <span className="font-medium text-leakage">{formatINR(l.paise)}</span>
                </div>
                <div className="h-2 w-full rounded-full bg-muted">
                  <div className="h-2 rounded-full bg-leakage" style={{ width: `${(l.paise / maxLeak) * 100}%` }} />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Wallet className="h-5 w-5" /> Accounts</CardTitle>
            <CardDescription>Current balance = anchor + flows since the anchor date.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {balances.map((b) => (
              <div key={b.id} className="flex items-center justify-between border-b py-2 text-sm last:border-0">
                <span className="flex items-center gap-2">{b.name}<Badge variant="secondary" className="text-[10px]">{b.kind.replace("_", " ")}</Badge></span>
                <span className={`font-medium ${b.balancePaise < 0 ? "text-leakage" : ""}`}>{formatINR(b.balancePaise)}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><PiggyBank className="h-5 w-5 text-invest" /> Review queue</CardTitle>
            <CardDescription>Uncategorized transactions waiting for a real bucket.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold">{reviewCount}</div>
            <p className="mt-1 text-sm text-muted-foreground">in Uncategorized Review</p>
            {reviewCount > 0 && <Button asChild variant="outline" className="mt-3"><Link href="/review">Review now</Link></Button>}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
