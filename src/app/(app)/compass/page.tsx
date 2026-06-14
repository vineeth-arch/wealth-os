import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCard, BandPill } from "@/components/compass/check-card";
import { Sparkbars, SparkTrend } from "@/components/compass/sparks";
import { ReflectionChecklist } from "@/components/compass/reflection-checklist";
import { LensToggle } from "@/components/compass/lens-toggle";
import { loadDrillData } from "@/lib/server/load-drill";
import { createSupabaseServer } from "@/lib/supabase/server";
import { accountBalances } from "@/lib/halan";
import {
  type CompassTxn, type HoldingValue, type CompassProfile, type Band, computeWindow,
  machineH1, machineH2, machineH3, machineH4, machineH5, machineH6Leakage, netWorthSeries,
  freedomRatio, lifestyleCreep, enjoymentFloor, worstBand, machineSummary, sanityFlags,
  TRAILING_WINDOW_MONTHS,
} from "@/lib/compass";
import { formatINR, formatPct, formatMonth } from "@/lib/format";
import { Gauge, Sparkles, ArrowUpRight, ArrowDownRight, ArrowRight } from "lucide-react";

export const dynamic = "force-dynamic";

type InstrumentJoin = { name: string; asset_class: string } | null;

export default async function CompassPage({ searchParams }: { searchParams: Promise<{ lens?: string }> }) {
  const lens = (await searchParams).lens === "business" ? "business" : "personal";
  const { drillTxns, accounts } = await loadDrillData();
  const supabase = await createSupabaseServer();
  const [{ data: snapsRaw }, { data: pricesRaw }, { data: userData }, { data: profileRow }] = await Promise.all([
    supabase.from("holdings_snapshots").select("account_id,as_of,isin,qty,last_price_paise,instruments(name,asset_class)").order("as_of", { ascending: false }),
    supabase.from("prices").select("isin,price_paise,price_date"),
    supabase.auth.getUser(),
    supabase.from("profile").select("data").maybeSingle(),
  ]);
  const userId = userData.user?.id ?? "";
  const savedProfile = (profileRow?.data as CompassProfile | undefined) ?? null;

  if (drillTxns.length === 0) {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <h1 className="text-2xl font-semibold tracking-tight">Compass</h1>
        <Card>
          <CardHeader>
            <CardTitle>Nothing to read yet</CardTitle>
            <CardDescription>Import a statement and categorize a couple of months — the Compass needs real, bucketed transactions to read your money health.</CardDescription>
          </CardHeader>
          <CardContent><Button asChild><Link href="/transactions?tab=import">Import a statement</Link></Button></CardContent>
        </Card>
      </div>
    );
  }

  const compassTxns: CompassTxn[] = drillTxns.map((t) => ({
    txnDate: t.txnDate, amountPaise: t.amountPaise, parent: t.parent, tags: t.tags, categoryName: t.categoryName,
  }));
  const window = computeWindow(compassTxns);
  const inWindow = new Set(window.months);
  const windowTxns = compassTxns.filter((t) => inWindow.has(t.txnDate.slice(0, 7)));

  // Liquid cash = bank-kind balances only (survives a market crash). H2's denominator.
  const { balances, netWorthPaise: cashNetWorthPaise } = accountBalances(
    accounts.map((a) => ({ id: a.id, name: a.name, kind: a.kind, anchorBalancePaise: a.anchorBalancePaise, anchorDate: a.anchorDate })),
    drillTxns.map((t) => ({ accountId: t.accountId, txnDate: t.txnDate, amountPaise: t.amountPaise })),
  );
  const liquidCashPaise = balances.filter((b) => b.kind === "bank").reduce((s, b) => s + b.balancePaise, 0);

  const h1 = machineH1(window.avg);
  const h2 = machineH2(window.avg, liquidCashPaise);
  const h3 = machineH3(windowTxns);

  // H4 — investing consistency over the window
  const h4 = machineH4(window, h1.saveRate.band);

  // H5 — allocation: per-holding present value (latest price, last-known fallback) from current snapshots
  const latestAsOf = new Map<string, string>();
  for (const s of snapsRaw ?? []) {
    const a = s.account_id as string, d = s.as_of as string;
    if (!latestAsOf.has(a) || d > latestAsOf.get(a)!) latestAsOf.set(a, d);
  }
  // most-recent price per ISIN
  const priceByIsin = new Map<string, { paise: number; date: string }>();
  for (const p of pricesRaw ?? []) {
    const isin = p.isin as string, d = p.price_date as string;
    const cur = priceByIsin.get(isin);
    if (!cur || d > cur.date) priceByIsin.set(isin, { paise: p.price_paise as number, date: d });
  }
  const holdingValues: HoldingValue[] = (snapsRaw ?? [])
    .filter((s) => latestAsOf.get(s.account_id as string) === (s.as_of as string))
    .map((s) => {
      const raw = s.instruments as unknown;
      const inst = (Array.isArray(raw) ? raw[0] : raw) as InstrumentJoin;
      const unit = priceByIsin.get(s.isin as string)?.paise ?? (s.last_price_paise as number);
      return {
        name: inst?.name ?? (s.isin as string),
        assetClass: inst?.asset_class ?? "equity",
        valuePaise: Math.round(Number(s.qty) * unit),
      };
    });
  const h5 = machineH5(holdingValues);

  // H6 — leakage (the tag) + cash net-worth trajectory across the window
  const h6leak = machineH6Leakage(windowTxns, window.totals);
  const allAccounts = accounts.map((a) => ({ id: a.id, name: a.name, kind: a.kind, anchorBalancePaise: a.anchorBalancePaise, anchorDate: a.anchorDate }));
  const allFlows = drillTxns.map((t) => ({ accountId: t.accountId, txnDate: t.txnDate, amountPaise: t.amountPaise }));
  const h6trend = netWorthSeries(allAccounts, allFlows, window.months);

  // The Mirror — behavioural signals (reflection, not scoring)
  const freedom = freedomRatio(window.avg, cashNetWorthPaise, h5.totalPaise);
  const creep = lifestyleCreep(window);
  const enjoy = enjoymentFloor(window.avg);

  const flags = sanityFlags(window.totals);
  const hasIncome = window.avg.personalIncome > 0;

  const windowLabel = `trailing ${window.monthsCovered} month${window.monthsCovered === 1 ? "" : "s"}${window.monthsCovered < TRAILING_WINDOW_MONTHS ? ` (target ${TRAILING_WINDOW_MONTHS})` : ""}`;
  const pctText = (r: { pct: number | null }) => (r.pct === null ? "—" : formatPct(r.pct));

  // One plain-string next-action per check — reused by the cards and the summary header (no drift).
  const saveAction = !hasIncome ? "Categorize income & spend to compute this." : h1.saveRate.band === "green" ? "Above the 20% band — keep it automated." : `Free up ${formatINR(h1.saveRate.gapToGreenPaise)}/mo to reach the 20% save-rate band.`;
  const emiAction = !hasIncome ? "Categorize income & debt to compute this." : h1.emiLoad.band === "green" ? "Comfortable — under the 25% line." : `Trim ${formatINR(h1.emiLoad.gapToGreenPaise)}/mo of EMI to get under 25%.`;
  const livingAction = !hasIncome ? "Categorize income & spend to compute this." : h1.livingCost.band === "green" ? "Lean — living on under half your income." : `Cut ${formatINR(h1.livingCost.gapToGreenPaise)}/mo of spend to get under 50%.`;
  const efAction = h2.months === null ? "Categorize spend to compute this." : h2.band === "green" ? "Above the 6-month buffer — solid." : `Add ${formatINR(h2.gapToTargetPaise)} to reach a 6-month buffer.`;
  const protectionAction = h3.anyPresent ? "Protection detected — confirm your cover amount vs HLV in Calculators." : "No term/health premiums detected — term + health come before investing.";
  const investAction = h4.band === null ? "Categorize investments to compute this." : h4.skipped === 0 ? "Investing every month — keep it automated." : `You skipped ${h4.skipped} month${h4.skipped === 1 ? "" : "s"} — set a standing SIP.`;
  const allocAction = h5.band === null ? "Import broker holdings to compute this." : h5.band === "green" ? "Well spread — no single holding dominates." : `Largest holding is ${formatPct(h5.top!.pct)} of the portfolio — trim toward <20%.`;
  const leakAction = h6leak.pct === null ? "Categorize spend to compute this." : h6leak.totalLeakagePaise === 0 ? "No leakage tagged — clean." : `${formatINR(h6leak.totalLeakagePaise)} leaked over the window — review the top categories.`;
  const trendAction = h6trend.band === null ? "Needs ≥2 months for a trend." : h6trend.direction === "up" ? "Net worth rising — keep it up." : h6trend.direction === "flat" ? "Net worth flat — lift the save rate." : "Net worth falling — cut spend or lift income.";

  // Collapse H1 (3 ratios) and H6 (leakage + trend) to their worst band; build the H1–H6 summary.
  const worstOf = (subs: Array<{ band: Band | null; action: string }>) => {
    const wb = worstBand(subs.map((s) => s.band));
    return { band: wb, action: subs.find((s) => s.band === wb)?.action ?? "" };
  };
  const h1Worst = worstOf([{ band: h1.saveRate.band, action: saveAction }, { band: h1.emiLoad.band, action: emiAction }, { band: h1.livingCost.band, action: livingAction }]);
  const h6Worst = worstOf([{ band: h6leak.band, action: leakAction }, { band: h6trend.band, action: trendAction }]);
  const summary = machineSummary([
    { id: "H1 · Cash flow", band: h1Worst.band, action: h1Worst.action },
    { id: "H2 · Emergency fund", band: h2.band, action: efAction },
    { id: "H3 · Protection", band: h3.band, action: protectionAction },
    { id: "H4 · Investing", band: h4.band, action: investAction },
    { id: "H5 · Allocation", band: h5.band, action: allocAction },
    { id: "H6 · Scoreboard", band: h6Worst.band, action: h6Worst.action },
  ]);

  if (lens === "business") {
    const t = window.totals, a = window.avg;
    const PnlRow = ({ label, paise, strong, sub }: { label: string; paise: number; strong?: boolean; sub?: boolean }) => (
      <div className={`flex items-center justify-between py-2 ${sub ? "border-b last:border-0" : "border-t-2"} ${strong ? "font-semibold" : ""}`}>
        <span className={sub ? "text-muted-foreground" : ""}>{label}</span>
        <span className={`tabular-nums ${paise < 0 ? "text-leakage" : ""}`}>{formatINR(paise)}</span>
      </div>
    );
    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Compass</h1>
            <p className="text-sm text-muted-foreground">Business lens · {windowLabel} · simple proprietor P&amp;L</p>
          </div>
          <LensToggle current={lens} />
        </div>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Proprietor P&amp;L</CardTitle>
            <CardDescription>From your categories: business-income leaves of 01, costs in parent 11, taxes in parent 12. Drawings (parent-10 transfers) are excluded — they&apos;re neither income nor cost.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-sm">
              <PnlRow label="Business revenue" paise={t.businessRevenue} sub />
              <PnlRow label="Business costs (11 Work & Business)" paise={-t.businessCosts} sub />
              <PnlRow label="Business profit" paise={t.businessProfit} strong />
              <PnlRow label="Taxes (12 Taxes & Compliance)" paise={-t.tax} sub />
              <PnlRow label="Profit after tax" paise={t.businessProfitAfterTax} strong />
            </div>
            <p className="mt-4 text-xs text-muted-foreground">
              Per-month average over the window: revenue {formatINR(a.businessRevenue)} · costs {formatINR(a.businessCosts)} · tax {formatINR(a.tax)} · profit after tax {formatINR(a.businessProfitAfterTax)}.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Compass</h1>
          <p className="text-sm text-muted-foreground">Personal lens · {windowLabel} · {drillTxns.length} transactions</p>
        </div>
        <LensToggle current={lens} />
      </div>

      <Card>
        <CardContent className="flex flex-col gap-3 py-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 text-sm">
              <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-red-500" />{summary.counts.red}</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-amber-500" />{summary.counts.amber}</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-emerald-500" />{summary.counts.green}</span>
              {summary.counts.na > 0 && <span className="inline-flex items-center gap-1.5 text-muted-foreground"><span className="h-2 w-2 rounded-full bg-muted-foreground/40" />{summary.counts.na}</span>}
            </div>
            <span className="text-xs text-muted-foreground">across H1–H6</span>
          </div>
          <div className="text-sm">
            {summary.topAction ? (
              <span><span className={summary.topAction.band === "red" ? "font-medium text-red-500" : "font-medium text-amber-500"}>Start here:</span> {summary.topAction.action}</span>
            ) : summary.counts.green > 0 ? (
              <span className="text-emerald-500">All computed checks are green — steady as she goes.</span>
            ) : (
              <span className="text-muted-foreground">Categorize a couple of months to light up the checks.</span>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base"><Gauge className="h-4 w-4" /> The Machine</CardTitle>
            <CardDescription>Is your money healthy? Six checks (H1–H6) on the numbers — each with a band and one next action. This is the diagnostic half.</CardDescription>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base"><Sparkles className="h-4 w-4" /> The Mirror</CardTitle>
            <CardDescription>Is your spending buying a better life? Behavioural signals and a calm checklist — for reflection, not scoring. There are no right answers; just notice.</CardDescription>
          </CardHeader>
        </Card>
      </div>

      {flags.messages.length > 0 && (
        <Card className="border-amber-500/30">
          <CardHeader className="pb-2"><CardTitle className="text-sm text-amber-500">Categorization sanity check</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-xs text-muted-foreground">
            {flags.messages.map((m, i) => <p key={i}>{m}</p>)}
          </CardContent>
        </Card>
      )}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">The Machine</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <CheckCard
            tag="H1 · Cash flow" title="Save rate" value={pctText(h1.saveRate)} band={h1.saveRate.band}
            caption="Savings (invest + protect) ÷ personal income. Target ≥20%."
            action={saveAction}
          />
          <CheckCard
            tag="H1 · Cash flow" title="EMI / debt load" value={pctText(h1.emiLoad)} band={h1.emiLoad.band}
            caption="Parent-05 EMI ÷ personal income. Target ≤25%."
            action={emiAction}
          />
          <CheckCard
            tag="H1 · Cash flow" title="Living cost" value={pctText(h1.livingCost)} band={h1.livingCost.band}
            caption="Personal spend ÷ personal income. Target ≤50%."
            action={livingAction}
          />
          <CheckCard
            tag="H2 · Foundation" title="Emergency fund" value={h2.months === null ? "—" : `${h2.months.toFixed(1)} mo`} band={h2.band}
            caption="Liquid bank cash ÷ avg monthly spend. Self-employed target 6 months (lumpy income), not 3."
            action={efAction}
          />
          <CheckCard
            tag="H3 · Shield" title="Protection funded" value={h3.anyPresent ? "Detected" : "None"} band={h3.band}
            caption={<>Term {h3.termPresent ? "✓" : "✗"} · Health {h3.healthPresent ? "✓" : "✗"}. Presence only — confirm the cover amount vs HLV yourself.</>}
            action={h3.anyPresent ? <Link href="/calculators" className="underline">Compare cover vs HLV →</Link> : protectionAction}
          />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">The Machine — continued</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <CheckCard
            tag="H4 · Engine" title="Investing consistency"
            value={h4.band === null ? "—" : `${h4.monthsInvested}/${h4.monthsCovered} mo`} band={h4.band}
            caption="Parent-08 invested per month. Automate it — consistency beats timing."
            action={investAction}
          >
            {h4.series.length > 0 && <Sparkbars values={h4.series.map((s) => s.investPaise)} labels={h4.series.map((s) => `${formatMonth(s.month)}: ${formatINR(s.investPaise)}`)} />}
          </CheckCard>

          <CheckCard
            tag="H5 · Spread" title="Allocation / concentration"
            value={h5.top ? formatPct(h5.top.pct) : "—"} band={h5.band}
            caption={h5.top ? <>Largest holding: <span className="font-medium text-foreground">{h5.top.name}</span>. A diversified fund at high % is fine; a single stock at high % is concentration risk.</> : "No holdings imported yet."}
            action={allocAction}
          >
            {h5.topHoldings.length > 0 && (
              <div className="space-y-2">
                <div className="space-y-1">
                  {h5.topHoldings.slice(0, 3).map((h) => (
                    <div key={h.name} className="flex items-center justify-between gap-2 text-xs">
                      <span className="truncate text-muted-foreground">{h.name}</span>
                      <span className="shrink-0 tabular-nums">{formatPct(h.pct)}</span>
                    </div>
                  ))}
                </div>
                <div className="flex flex-wrap gap-1 border-t pt-2 text-[11px] text-muted-foreground">
                  {h5.byClass.map((c) => <span key={c.assetClass} className="rounded bg-secondary px-1.5 py-0.5">{c.assetClass.replace("_", " ")} {Math.round(c.pct)}%</span>)}
                </div>
              </div>
            )}
          </CheckCard>

          <CheckCard
            tag="H6 · Scoreboard" title="Leakage"
            value={h6leak.pct === null ? "—" : formatPct(h6leak.pct)} band={h6leak.band}
            caption="Tagged leakage ÷ personal spend. Target <5%."
            action={leakAction}
          >
            {h6leak.byParent.length > 0 && (
              <div className="space-y-1">
                {h6leak.byParent.slice(0, 3).map((p) => (
                  <div key={p.parent} className="flex items-center justify-between gap-2 text-xs">
                    <span className="truncate text-muted-foreground">{p.parent}</span>
                    <span className="shrink-0 tabular-nums text-leakage">{formatINR(p.paise)}</span>
                  </div>
                ))}
              </div>
            )}
            <div className="mt-2 space-y-1 border-t pt-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium">Net-worth trend</span>
                <BandPill band={h6trend.band} />
              </div>
              {h6trend.band === null ? (
                <p className="text-xs text-muted-foreground">Needs ≥2 months of history.</p>
              ) : (
                <>
                  <div className="flex items-center gap-1 text-xs">
                    {h6trend.direction === "up" ? <ArrowUpRight className="h-3.5 w-3.5 text-emerald-500" /> : h6trend.direction === "down" ? <ArrowDownRight className="h-3.5 w-3.5 text-red-500" /> : <ArrowRight className="h-3.5 w-3.5 text-amber-500" />}
                    <span className={h6trend.changePaise >= 0 ? "text-emerald-500" : "text-red-500"}>{formatINR(h6trend.changePaise, { sign: true })}</span>
                    <span className="text-muted-foreground">cash, over the window</span>
                  </div>
                  <SparkTrend values={h6trend.series.map((s) => s.netWorthPaise)} labels={h6trend.series.map((s) => `${formatMonth(s.month)}: ${formatINR(s.netWorthPaise)}`)} />
                  <p className="text-[11px] text-muted-foreground">Cash/account trajectory; historical holdings value isn&apos;t stored.</p>
                </>
              )}
            </div>
          </CheckCard>
        </div>
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">The Mirror</h2>
          <p className="text-sm text-muted-foreground">Behavioural signals — for reflection, not scoring.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Freedom ratio</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              <div className="text-2xl font-semibold tracking-tight">{freedom.months === null ? "—" : `${freedom.months.toFixed(1)} mo`}</div>
              <p className="text-xs text-muted-foreground">
                Total liquid net worth <span className="font-medium text-foreground">including investments</span> ({formatINR(freedom.liquidNetWorthPaise)}) ÷ avg monthly spend — months you could fund your life with zero income. Broader than H2&apos;s cash-only buffer. <span className="italic">Independence is the highest dividend.</span>
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm">Lifestyle creep</CardTitle>
              <BandPill band={creep.band} />
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="text-2xl font-semibold tracking-tight">{creep.creepPct === null ? "—" : `${creep.creepPct > 0 ? "+" : ""}${creep.creepPct.toFixed(0)}%`}</div>
              {creep.creepPct === null ? (
                <p className="text-xs text-muted-foreground">Needs ≥2 months of history.</p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Spend {creep.spendGrowthPct!.toFixed(0)}% vs income {creep.incomeGrowthPct!.toFixed(0)}% (first vs second half of the window).
                  {creep.creepPct > 0 ? " Spending is outpacing income — " : " Income is keeping ahead — "}
                  <span className="italic">watch for expectations growing faster than income.</span>
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Enjoyment floor</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              <div className="text-2xl font-semibold tracking-tight">{enjoy.saveRatePct === null ? "—" : enjoy.triggered ? "Over-saving?" : "Balanced"}</div>
              {enjoy.triggered ? (
                <p className="text-xs text-muted-foreground">
                  Saving {enjoy.saveRatePct!.toFixed(0)}% with wants at only {enjoy.wantsSharePct!.toFixed(0)}% of income. <span className="italic">You can afford to enjoy more — don&apos;t let money become an accounting hobby.</span>
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {enjoy.saveRatePct === null ? "Categorize income & spend to compute this." : <>Saving {enjoy.saveRatePct.toFixed(0)}%, wants {enjoy.wantsSharePct!.toFixed(0)}% of income — a healthy balance between saving and living.</>}
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        <ReflectionChecklist userId={userId} initial={savedProfile} />

        <p className="text-xs text-muted-foreground">
          The Machine measures whether the numbers are healthy; the Mirror asks whether your spending is buying a better life.
          The Machine has bands and actions; the Mirror does not keep score — it&apos;s a prompt to reflect, nothing more.
        </p>
      </section>
    </div>
  );
}
