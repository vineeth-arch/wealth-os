"use client";
import { useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatINR } from "@/lib/format";
import { hlvIncomeReplacement, hlvExpenseLiability, type HlvResult } from "@/lib/calc/hlv";
import { AssumptionsCard, NumberField, ResultTile, toPaise, toNum } from "@/components/calculators/shared";

function GapSummary({ r, label }: { r: HlvResult; label: string }) {
  const covered = r.gapPaise === 0;
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <ResultTile label={label} value={formatINR(r.needPaise)} />
      <ResultTile label="Existing cover" value={formatINR(r.existingCoverPaise)} />
      <div className="rounded-md border bg-card p-3">
        <div className="text-xs text-muted-foreground">Additional cover needed</div>
        <div className={`text-lg font-semibold ${covered ? "text-income" : "text-leakage"}`}>{formatINR(r.gapPaise)}</div>
        {covered && <Badge variant="success" className="mt-1">adequately covered</Badge>}
      </div>
    </div>
  );
}

export function HumanLifeValueCalculator() {
  // Income-replacement
  const [income, setIncome] = useState("1500000");
  const [ownConsumption, setOwnConsumption] = useState("30");
  const [workingYears, setWorkingYears] = useState("25");
  const [discount, setDiscount] = useState("3");
  const [coverIR, setCoverIR] = useState("5000000");

  const ir = useMemo(() => hlvIncomeReplacement({
    annualIncomePaise: toPaise(income), ownConsumptionPct: toNum(ownConsumption),
    workingYears: Math.round(toNum(workingYears)), discountRatePct: toNum(discount), existingCoverPaise: toPaise(coverIR),
  }), [income, ownConsumption, workingYears, discount, coverIR]);

  // Expense + liabilities
  const [expense, setExpense] = useState("600000");
  const [yearsToCover, setYearsToCover] = useState("25");
  const [discountEL, setDiscountEL] = useState("3");
  const [liabilities, setLiabilities] = useState("4000000");
  const [assets, setAssets] = useState("2000000");
  const [coverEL, setCoverEL] = useState("5000000");

  const el = useMemo(() => hlvExpenseLiability({
    annualExpensePaise: toPaise(expense), yearsToCover: Math.round(toNum(yearsToCover)), discountRatePct: toNum(discountEL),
    outstandingLiabilitiesPaise: toPaise(liabilities), existingAssetsPaise: toPaise(assets), existingCoverPaise: toPaise(coverEL),
  }), [expense, yearsToCover, discountEL, liabilities, assets, coverEL]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Income-replacement method</CardTitle>
          <CardDescription>Present value of income the family loses — income net of your own consumption.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <NumberField id="hlv-income" label="Annual income (₹)" value={income} onChange={setIncome} />
          <NumberField id="hlv-own" label="Own consumption (%)" mode="decimal" value={ownConsumption} onChange={setOwnConsumption} hint="Share you spend on yourself; excluded from the need." />
          <NumberField id="hlv-wy" label="Remaining working years" value={workingYears} onChange={setWorkingYears} />
          <NumberField id="hlv-disc" label="Real discount rate (%)" mode="decimal" value={discount} onChange={setDiscount} hint="Net of income growth/inflation." />
          <NumberField id="hlv-cover" label="Existing life cover (₹)" value={coverIR} onChange={setCoverIR} />
        </CardContent>
      </Card>
      <GapSummary r={ir} label="Human Life Value" />

      <Card>
        <CardHeader>
          <CardTitle>Expense + liabilities method</CardTitle>
          <CardDescription>Cover dependents&apos; expenses and clear liabilities, net of assets already available.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <NumberField id="hlv-exp" label="Annual household expense (₹)" value={expense} onChange={setExpense} />
          <NumberField id="hlv-ytc" label="Years to cover" value={yearsToCover} onChange={setYearsToCover} />
          <NumberField id="hlv-disc2" label="Real discount rate (%)" mode="decimal" value={discountEL} onChange={setDiscountEL} />
          <NumberField id="hlv-liab" label="Outstanding liabilities (₹)" value={liabilities} onChange={setLiabilities} />
          <NumberField id="hlv-assets" label="Existing assets (₹)" value={assets} onChange={setAssets} />
          <NumberField id="hlv-cover2" label="Existing life cover (₹)" value={coverEL} onChange={setCoverEL} />
        </CardContent>
      </Card>
      <GapSummary r={el} label="Cover needed" />

      <AssumptionsCard items={[
        "Discount rate is real (net of income growth / inflation), so level amounts stand in for growing ones in today's money.",
        "Income-replacement counts income net of your own consumption; expense method counts dependents' spending plus debts minus assets.",
        "Pick the higher of the two as a guide; term insurance is the cheapest way to close the gap.",
      ]} />
    </div>
  );
}
