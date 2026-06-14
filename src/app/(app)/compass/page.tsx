import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCard } from "@/components/compass/check-card";
import { loadDrillData } from "@/lib/server/load-drill";
import { accountBalances } from "@/lib/halan";
import {
  type CompassTxn, computeWindow, machineH1, machineH2, machineH3, sanityFlags,
  TRAILING_WINDOW_MONTHS,
} from "@/lib/compass";
import { formatINR, formatPct } from "@/lib/format";
import { Gauge, Sparkles } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function CompassPage() {
  const { drillTxns, accounts } = await loadDrillData();

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
  const { balances } = accountBalances(
    accounts.map((a) => ({ id: a.id, name: a.name, kind: a.kind, anchorBalancePaise: a.anchorBalancePaise, anchorDate: a.anchorDate })),
    drillTxns.map((t) => ({ accountId: t.accountId, txnDate: t.txnDate, amountPaise: t.amountPaise })),
  );
  const liquidCashPaise = balances.filter((b) => b.kind === "bank").reduce((s, b) => s + b.balancePaise, 0);

  const h1 = machineH1(window.avg);
  const h2 = machineH2(window.avg, liquidCashPaise);
  const h3 = machineH3(windowTxns);
  const flags = sanityFlags(window.totals);
  const hasIncome = window.avg.personalIncome > 0;

  const windowLabel = `trailing ${window.monthsCovered} month${window.monthsCovered === 1 ? "" : "s"}${window.monthsCovered < TRAILING_WINDOW_MONTHS ? ` (target ${TRAILING_WINDOW_MONTHS})` : ""}`;
  const pctText = (r: { pct: number | null }) => (r.pct === null ? "—" : formatPct(r.pct));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Compass</h1>
        <p className="text-sm text-muted-foreground">Personal lens · {windowLabel} · {drillTxns.length} transactions</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base"><Gauge className="h-4 w-4" /> The Machine</CardTitle>
            <CardDescription>Is your money healthy? Six checks (H1–H6) on the numbers — each with a band and one next action.</CardDescription>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base"><Sparkles className="h-4 w-4" /> The Mirror</CardTitle>
            <CardDescription>Is your spending buying a better life? Behavioural signals and a calm reflection checklist — for reflection, not scoring.</CardDescription>
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
            action={!hasIncome ? "Categorize income & spend to compute this." : h1.saveRate.band === "green" ? "Above the 20% band — keep it automated." : `Free up ${formatINR(h1.saveRate.gapToGreenPaise)}/mo to reach the 20% band.`}
          />
          <CheckCard
            tag="H1 · Cash flow" title="EMI / debt load" value={pctText(h1.emiLoad)} band={h1.emiLoad.band}
            caption="Parent-05 EMI ÷ personal income. Target ≤25%."
            action={!hasIncome ? "Categorize income & debt to compute this." : h1.emiLoad.band === "green" ? "Comfortable — under the 25% line." : `Trim ${formatINR(h1.emiLoad.gapToGreenPaise)}/mo of EMI to get under 25%.`}
          />
          <CheckCard
            tag="H1 · Cash flow" title="Living cost" value={pctText(h1.livingCost)} band={h1.livingCost.band}
            caption="Personal spend ÷ personal income. Target ≤50%."
            action={!hasIncome ? "Categorize income & spend to compute this." : h1.livingCost.band === "green" ? "Lean — living on under half your income." : `Cut ${formatINR(h1.livingCost.gapToGreenPaise)}/mo of spend to get under 50%.`}
          />
          <CheckCard
            tag="H2 · Foundation" title="Emergency fund" value={h2.months === null ? "—" : `${h2.months.toFixed(1)} mo`} band={h2.band}
            caption="Liquid bank cash ÷ avg monthly spend. Self-employed target 6 months (lumpy income), not 3."
            action={h2.months === null ? "Categorize spend to compute this." : h2.band === "green" ? "Above the 6-month buffer — solid." : `Add ${formatINR(h2.gapToTargetPaise)} to reach a 6-month buffer.`}
          />
          <CheckCard
            tag="H3 · Shield" title="Protection funded" value={h3.anyPresent ? "Detected" : "None"} band={h3.band}
            caption={<>Term {h3.termPresent ? "✓" : "✗"} · Health {h3.healthPresent ? "✓" : "✗"}. Presence only — confirm the cover amount vs HLV yourself.</>}
            action={h3.anyPresent ? <Link href="/calculators" className="underline">Compare cover vs HLV →</Link> : "No term/health premiums detected — term + health come before investing."}
          />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">The Machine — continued</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <CheckCard tag="H4 · Engine" title="Investing consistency" value="—" band={null} caption="Computed in the next pass." />
          <CheckCard tag="H5 · Spread" title="Allocation / concentration" value="—" band={null} caption="Computed in the next pass." />
          <CheckCard tag="H6 · Scoreboard" title="Leakage + net-worth trend" value="—" band={null} caption="Computed in the next pass." />
        </div>
      </section>
    </div>
  );
}
