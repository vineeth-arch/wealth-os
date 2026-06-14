"use client";
import { useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatINR } from "@/lib/format";
import { sipFutureValue, sipInvestedPaise, goalCorpus, requiredMonthlySip } from "@/lib/calc/sip";
import { AssumptionsCard, NumberField, ResultTile, toPaise, toNum } from "@/components/calculators/shared";

export function SipCalculator() {
  // Future value of a SIP
  const [monthly, setMonthly] = useState("10000");
  const [ret, setRet] = useState("12");
  const [years, setYears] = useState("10");
  const [stepUp, setStepUp] = useState("0");

  const months = Math.max(1, Math.round(toNum(years) * 12));
  const fv = useMemo(() => sipFutureValue({ monthlyPaise: toPaise(monthly), annualReturnPct: toNum(ret), months, stepUpPct: toNum(stepUp) }), [monthly, ret, months, stepUp]);
  const invested = useMemo(() => sipInvestedPaise({ monthlyPaise: toPaise(monthly), months, stepUpPct: toNum(stepUp) }), [monthly, months, stepUp]);
  const gains = Math.max(0, fv - invested);

  // Goal planner → required SIP
  const [goalToday, setGoalToday] = useState("2500000");
  const [goalInfl, setGoalInfl] = useState("8");
  const [goalYears, setGoalYears] = useState("15");
  const [goalRet, setGoalRet] = useState("11");
  const [goalStep, setGoalStep] = useState("10");

  const goalMonths = Math.max(1, Math.round(toNum(goalYears) * 12));
  const goalTarget = useMemo(() => goalCorpus({ targetTodayPaise: toPaise(goalToday), inflationPct: toNum(goalInfl), years: Math.round(toNum(goalYears)) }), [goalToday, goalInfl, goalYears]);
  const requiredSip = useMemo(() => requiredMonthlySip({ targetPaise: goalTarget, annualReturnPct: toNum(goalRet), months: goalMonths, stepUpPct: toNum(goalStep) }), [goalTarget, goalRet, goalMonths, goalStep]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>SIP future value</CardTitle>
          <CardDescription>What a monthly SIP grows to, with an optional annual step-up.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <NumberField id="sip-m" label="Monthly SIP (₹)" value={monthly} onChange={setMonthly} />
          <NumberField id="sip-r" label="Return (% p.a.)" mode="decimal" value={ret} onChange={setRet} />
          <NumberField id="sip-y" label="Duration (years)" mode="decimal" value={years} onChange={setYears} />
          <NumberField id="sip-s" label="Annual step-up (%)" mode="decimal" value={stepUp} onChange={setStepUp} hint="Raise the SIP each year." />
        </CardContent>
      </Card>
      <div className="grid gap-4 sm:grid-cols-3">
        <ResultTile label="Invested" value={formatINR(invested)} />
        <ResultTile label="Est. gains" value={formatINR(gains)} accent />
        <ResultTile label="Future value" value={formatINR(fv)} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Goal planner → required SIP</CardTitle>
          <CardDescription>Inflate today&apos;s goal cost, then find the monthly SIP needed to reach it.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <NumberField id="goal-t" label="Goal cost today (₹)" value={goalToday} onChange={setGoalToday} hint="e.g. education, marriage, retirement." />
          <NumberField id="goal-i" label="Inflation (% p.a.)" mode="decimal" value={goalInfl} onChange={setGoalInfl} />
          <NumberField id="goal-y" label="Years to goal" value={goalYears} onChange={setGoalYears} />
          <NumberField id="goal-r" label="Expected return (% p.a.)" mode="decimal" value={goalRet} onChange={setGoalRet} />
          <NumberField id="goal-s" label="Annual step-up (%)" mode="decimal" value={goalStep} onChange={setGoalStep} />
        </CardContent>
      </Card>
      <div className="grid gap-4 sm:grid-cols-2">
        <ResultTile label="Inflation-adjusted target" value={formatINR(goalTarget)} />
        <ResultTile label="Required monthly SIP (start)" value={formatINR(requiredSip)} accent />
      </div>

      <AssumptionsCard items={[
        "Contributions at the start of each month; constant nominal post-tax return (a long-run average).",
        "Step-up raises the SIP once every 12 months by the given percentage.",
        "Goal cost is inflated at a constant rate; the required SIP is rounded up so the target is met.",
      ]} />
    </div>
  );
}
