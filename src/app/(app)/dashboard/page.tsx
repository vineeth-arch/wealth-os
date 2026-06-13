import Link from "next/link";
import { createSupabaseServer } from "@/lib/supabase/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CashFlowChart, type FlowPoint } from "@/components/charts";
import { FlowKpis } from "@/components/dashboard/flow-kpis";
import { SpendBuckets } from "@/components/dashboard/spend-buckets";
import { type DrillTxn } from "@/lib/drilldown";
import { type CategoryOption } from "@/components/category-select";
import { formatINR, formatMonth, formatDate } from "@/lib/format";
import {
  type TxnLike, type HoldingLike, type PriceLike, monthlyCashFlow, bucketTotals, leakageByParent,
  accountBalances, holdingsValue, SPEND_CLASSES,
} from "@/lib/halan";
import { TrendingUp, PiggyBank, Wallet, LineChart } from "lucide-react";

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
  const [{ data: accountsRaw }, { data: txnsRaw }, { data: catsRaw }, { data: snapsRaw }, { data: pricesRaw }] = await Promise.all([
    supabase.from("accounts").select("id,name,kind,anchor_balance_paise,anchor_date"),
    supabase.from("transactions").select("id,txn_date,amount_paise,tags,account_id,category_id,description_raw,merchant,category_source"),
    supabase.from("categories").select("id,name,parent_id"),
    supabase.from("holdings_snapshots").select("account_id,as_of,isin,qty,last_price_paise").order("as_of", { ascending: false }),
    supabase.from("prices").select("isin,price_paise,price_date"),
  ]);

  const accounts = accountsRaw ?? [];
  const txns = txnsRaw ?? [];
  const cats = catsRaw ?? [];

  // Investments: current holdings (latest snapshot per account) valued at latest prices, last-known fallback.
  const latestAsOf = new Map<string, string>();
  for (const s of snapsRaw ?? []) {
    const a = s.account_id as string, d = s.as_of as string;
    if (!latestAsOf.has(a) || d > latestAsOf.get(a)!) latestAsOf.set(a, d);
  }
  const currentHoldings: HoldingLike[] = (snapsRaw ?? [])
    .filter((s) => latestAsOf.get(s.account_id as string) === (s.as_of as string))
    .map((s) => ({ isin: s.isin as string, qty: Number(s.qty), lastPricePaise: s.last_price_paise as number, asOf: s.as_of as string }));
  const priceRows: PriceLike[] = (pricesRaw ?? []).map((p) => ({ isin: p.isin as string, pricePaise: p.price_paise as number, priceDate: p.price_date as string }));
  const investments = holdingsValue(currentHoldings, priceRows);
  const hasHoldings = currentHoldings.length > 0;

  // per-account snapshot coverage range (earliest → latest as_of)
  const covMap = new Map<string, { from: string; to: string }>();
  for (const s of snapsRaw ?? []) {
    const id = s.account_id as string, d = s.as_of as string;
    const cur = covMap.get(id);
    if (!cur) covMap.set(id, { from: d, to: d });
    else { if (d < cur.from) cur.from = d; if (d > cur.to) cur.to = d; }
  }
  const accNameById = new Map(accounts.map((a) => [a.id as string, a.name as string]));
  const coverage = [...covMap.entries()].map(([id, r]) => ({ name: accNameById.get(id) ?? id, from: r.from, to: r.to }));

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
  // Taxonomy options for the inline category dropdown in the drill-downs (same shape the review screen uses).
  const categoryOptions: CategoryOption[] = cats.map((c) => ({
    id: c.id as string, name: c.name as string,
    parent: c.parent_id ? nameById.get(c.parent_id as string) ?? null : null,
  }));

  const halanTxns: TxnLike[] = txns.map((t) => ({
    txnDate: t.txn_date as string,
    amountPaise: t.amount_paise as number,
    parent: t.category_id ? parentByCatId.get(t.category_id as string) ?? null : null,
    tags: (t.tags as string[]) ?? [],
  }));

  // Full per-transaction rows for the drill-down modals (pure aggregation runs client-side on these).
  const drillTxns: DrillTxn[] = txns.map((t) => ({
    id: t.id as string,
    txnDate: t.txn_date as string,
    amountPaise: t.amount_paise as number,
    accountId: (t.account_id as string) ?? "",
    accountName: t.account_id ? accNameById.get(t.account_id as string) ?? "" : "",
    descriptionRaw: (t.description_raw as string) ?? "",
    merchant: (t.merchant as string | null) ?? "",
    categoryId: (t.category_id as string) ?? "",
    categoryName: t.category_id ? nameById.get(t.category_id as string) ?? "" : "",
    parent: t.category_id ? parentByCatId.get(t.category_id as string) ?? null : null,
    categorySource: (t.category_source as string) ?? "default",
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
  const leak = leakageByParent(halanTxns);

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
        <Tile label="Cash net worth" value={formatINR(netWorthPaise)} sub="bank + cards; broker cash excluded" />
        {hasHoldings && <Tile label="Investments" value={formatINR(investments.valuePaise)} tone="invest" sub={investments.asOfDate ? `as of ${formatDate(investments.asOfDate)}` : undefined} />}
        {hasHoldings && <Tile label="Total net worth" value={formatINR(netWorthPaise + investments.valuePaise)} sub="cash + investments" />}
        {latest && <FlowKpis txns={drillTxns} month={latest.month} categories={categoryOptions}
          totals={{ income: latest.incomePaise, spend: latest.spendPaise, invest: latest.investPaise, leakage: latest.leakagePaise }} />}
      </div>

      {hasHoldings && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><LineChart className="h-5 w-5 text-invest" /> Investments</CardTitle>
            <CardDescription>
              Present value {formatINR(investments.valuePaise)}
              {investments.asOfDate && <> · priced as of {formatDate(investments.asOfDate)}</>}
              {investments.fallbackCount > 0 && <> · {investments.fallbackCount} using last-known price (refresh pending)</>}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {coverage.map((c) => (
              <div key={c.name} className="flex items-center justify-between border-b py-2 text-sm last:border-0">
                <span className="text-muted-foreground">{c.name}</span>
                <span className="text-xs text-muted-foreground">{c.from === c.to ? formatDate(c.to) : `${formatDate(c.from)} → ${formatDate(c.to)}`}</span>
              </div>
            ))}
            <Button asChild variant="outline" className="mt-1"><Link href="/holdings">Manage holdings</Link></Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><TrendingUp className="h-5 w-5" /> Cash flow</CardTitle>
          <CardDescription>Income vs spend vs invest by month. Transfers and unreviewed items are excluded.</CardDescription>
        </CardHeader>
        <CardContent><CashFlowChart data={flowData} /></CardContent>
      </Card>

      <SpendBuckets txns={drillTxns} buckets={buckets} leak={leak} categories={categoryOptions} />

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
