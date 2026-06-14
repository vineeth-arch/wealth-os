"use client";
import { useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatINR, formatPct } from "@/lib/format";
import { fireCorpus, swpDrawdown } from "@/lib/calc/retirement";
import { AssumptionsCard, NumberField, ResultTile, toPaise, toNum } from "@/components/calculators/shared";

export function RetirementCalculator() {
  // FIRE corpus
  const [annualExpense, setAnnualExpense] = useState("600000");
  const [inflation, setInflation] = useState("6");
  const [years, setYears] = useState("20");
  const [swr, setSwr] = useState("4");
  const [currentCorpus, setCurrentCorpus] = useState("5000000");

  const fire = useMemo(() => fireCorpus({
    annualExpensePaise: toPaise(annualExpense), inflationPct: toNum(inflation),
    yearsToRetire: Math.round(toNum(years)), swrPct: Math.max(0.1, toNum(swr)),
    currentCorpusPaise: toPaise(currentCorpus),
  }), [annualExpense, inflation, years, swr, currentCorpus]);

  // SWP drawdown
  const [swCorpus, setSwCorpus] = useState("50000000");
  const [swWithdraw, setSwWithdraw] = useState("2000000");
  const [swReturn, setSwReturn] = useState("8");
  const [swInflation, setSwInflation] = useState("6");
  const [swYears, setSwYears] = useState("30");

  const swp = useMemo(() => swpDrawdown({
    corpusPaise: toPaise(swCorpus), annualWithdrawalPaise: toPaise(swWithdraw),
    nominalReturnPct: toNum(swReturn), inflationPct: toNum(swInflation), years: Math.round(toNum(swYears)) || 1,
  }), [swCorpus, swWithdraw, swReturn, swInflation, swYears]);

  const independent = fire.freedomRatio >= 1;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Freedom number (FIRE corpus)</CardTitle>
          <CardDescription>Inflate today&apos;s expenses to retirement, then size the corpus at your safe-withdrawal rate.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <NumberField id="fire-exp" label="Annual expense today (₹)" value={annualExpense} onChange={setAnnualExpense} />
          <NumberField id="fire-infl" label="Inflation (% p.a.)" mode="decimal" value={inflation} onChange={setInflation} />
          <NumberField id="fire-yrs" label="Years to retirement" value={years} onChange={setYears} />
          <NumberField id="fire-swr" label="Safe withdrawal rate (%)" mode="decimal" value={swr} onChange={setSwr} hint="3–4% is typical for an Indian retiree." />
          <NumberField id="fire-cur" label="Current corpus (₹)" value={currentCorpus} onChange={setCurrentCorpus} />
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-3">
        <ResultTile label="Expense at retirement (annual)" value={formatINR(fire.futureAnnualExpensePaise)} />
        <ResultTile label="Target corpus" value={formatINR(fire.targetCorpusPaise)} />
        <ResultTile label="Freedom ratio" value={formatPct(fire.freedomRatio * 100)} accent={independent} />
      </div>
      <div className="rounded-md border bg-card p-4 text-sm">
        {independent ? (
          <>You are at <Badge variant="success">financial independence</Badge> for these assumptions.</>
        ) : (
          <>You are <span className="font-semibold">{formatPct(fire.freedomRatio * 100)}</span> of the way to your freedom number —
            a gap of <span className="font-semibold text-leakage">{formatINR(Math.max(0, fire.targetCorpusPaise - fire.currentCorpusPaise))}</span>.</>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Drawdown (SWP)</CardTitle>
          <CardDescription>Inflation-indexed withdrawal taken at the start of each year, remainder grows at the nominal return.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <NumberField id="swp-corpus" label="Starting corpus (₹)" value={swCorpus} onChange={setSwCorpus} />
          <NumberField id="swp-wd" label="First-year withdrawal (₹)" value={swWithdraw} onChange={setSwWithdraw} />
          <NumberField id="swp-ret" label="Nominal return (% p.a.)" mode="decimal" value={swReturn} onChange={setSwReturn} />
          <NumberField id="swp-infl" label="Inflation (% p.a.)" mode="decimal" value={swInflation} onChange={setSwInflation} />
          <NumberField id="swp-yrs" label="Horizon (years)" value={swYears} onChange={setSwYears} />
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        <ResultTile label="Years the corpus lasts" value={`${swp.yearsLasted} yr`} />
        <ResultTile
          label="Outcome"
          value={swp.depletedYear === null ? `Survives ${swYears} yrs` : `Depletes in year ${swp.depletedYear}`}
          accent={swp.depletedYear === null}
        />
      </div>

      <Card>
        <CardHeader><CardTitle>Year-by-year</CardTitle></CardHeader>
        <CardContent>
          <div className="max-h-80 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-card text-xs text-muted-foreground">
                <tr className="border-b text-right">
                  <th className="py-2 text-left">Year</th>
                  <th className="py-2">Opening</th><th className="py-2">Withdrawal</th><th className="py-2">Growth</th><th className="py-2">Closing</th>
                </tr>
              </thead>
              <tbody>
                {swp.rows.map((r) => (
                  <tr key={r.year} className="border-b text-right last:border-0">
                    <td className="py-1.5 text-left">{r.year}</td>
                    <td className="py-1.5">{formatINR(r.openingPaise)}</td>
                    <td className="py-1.5">{formatINR(r.withdrawalPaise)}</td>
                    <td className="py-1.5">{formatINR(r.growthPaise)}</td>
                    <td className="py-1.5">{formatINR(r.closingPaise)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <AssumptionsCard items={[
        "Constant inflation and nominal return — a smoothed long-run average, not real year-to-year volatility.",
        "Safe-withdrawal rate of 3–4% is the common FIRE convention; lower is safer over long Indian retirements.",
        "Withdrawal grows with inflation each year; figures are post-tax. Sequence-of-returns risk is only approximated.",
      ]} />
    </div>
  );
}
