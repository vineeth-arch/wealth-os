"use client";
import { useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatINR, formatPct } from "@/lib/format";
import { emergencyFund } from "@/lib/calc/emergency";
import { AssumptionsCard, NumberField, toPaise } from "@/components/calculators/shared";

export function EmergencyFundCalculator() {
  const [needs, setNeeds] = useState("60000");
  const [liquid, setLiquid] = useState("300000");

  const result = useMemo(
    () => emergencyFund({ monthlyNeedsPaise: toPaise(needs), currentLiquidPaise: toPaise(liquid) }),
    [needs, liquid],
  );

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Emergency fund</CardTitle>
          <CardDescription>How many months of essentials your buffer should cover, and the gap versus what you hold.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <NumberField id="ef-needs" label="Monthly essentials (₹)" value={needs} onChange={setNeeds}
            hint="Recurring Spend-it Needs only: rent/EMI, utilities, groceries, insurance, fees." />
          <NumberField id="ef-liquid" label="Current liquid assets (₹)" value={liquid} onChange={setLiquid}
            hint="Cash, savings, sweep-FDs, liquid funds you can reach within days." />
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-3">
        {result.targets.map((t) => {
          const funded = t.gapPaise === 0;
          return (
            <Card key={t.months} className={funded ? "border-income/50" : undefined}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">{t.months} months</CardTitle>
                  {funded && <Badge variant="success">funded</Badge>}
                </div>
                <CardDescription>Target {formatINR(t.targetPaise)}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Funded</span><span>{formatPct(t.fundedPct)}</span>
                </div>
                <div className="h-2 w-full rounded-full bg-muted">
                  <div className="h-2 rounded-full bg-primary" style={{ width: `${t.fundedPct}%` }} />
                </div>
                <div className="flex items-center justify-between border-t pt-2 font-medium">
                  <span>Gap</span><span className={funded ? "text-income" : "text-leakage"}>{formatINR(t.gapPaise)}</span>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <AssumptionsCard items={[
        "Buffer is sized in months of essential expenses (Spend-it Needs), not total spend.",
        "6 months for stable salaried income; 9–12 months if income is variable or you are the sole earner.",
        "Keep the fund liquid (savings + sweep-FD + liquid fund); returns are not modelled.",
      ]} />
    </div>
  );
}
