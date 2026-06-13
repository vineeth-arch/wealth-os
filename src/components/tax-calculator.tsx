"use client";
import { useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatINR } from "@/lib/format";
import { compareRegimes, type RegimeResult } from "@/lib/calc/tax";

const RUPEE = 100;
function toPaise(rupees: string): number {
  const n = Number(rupees.replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n * RUPEE) : 0;
}

function RegimeCard({ title, r, winner }: { title: string; r: RegimeResult; winner: boolean }) {
  return (
    <Card className={winner ? "border-income/50" : undefined}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">{title}</CardTitle>
          {winner && <Badge variant="success">lower tax</Badge>}
        </div>
        <CardDescription>Taxable income {formatINR(r.taxablePaise)}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-1 text-sm">
        <Row label="Tax on slabs" value={r.slabTaxPaise} />
        {r.rebatePaise > 0 && <Row label="§87A rebate" value={-r.rebatePaise} />}
        {r.surchargePaise > 0 && <Row label="Surcharge" value={r.surchargePaise} />}
        <Row label="Health & education cess (4%)" value={r.cessPaise} />
        <div className="mt-2 flex items-center justify-between border-t pt-2 font-semibold">
          <span>Total tax</span><span>{formatINR(r.totalTaxPaise)}</span>
        </div>
      </CardContent>
    </Card>
  );
}
function Row({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className={value < 0 ? "text-income" : ""}>{formatINR(value, { sign: value < 0 })}</span>
    </div>
  );
}

export function TaxCalculator() {
  const [gross, setGross] = useState("1500000");
  const [deductions, setDeductions] = useState("150000");

  const result = useMemo(() => compareRegimes({
    grossSalaryPaise: toPaise(gross),
    oldRegimeDeductionsPaise: toPaise(deductions),
  }), [gross, deductions]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Salaried income (annual)</CardTitle>
          <CardDescription>Standard deduction is applied automatically (₹75,000 new · ₹50,000 old).</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="gross">Gross salary (₹)</Label>
            <Input id="gross" inputMode="numeric" value={gross} onChange={(e) => setGross(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ded">Old-regime deductions (₹)</Label>
            <Input id="ded" inputMode="numeric" value={deductions} onChange={(e) => setDeductions(e.target.value)} />
            <p className="text-xs text-muted-foreground">80C + HRA exemption + home-loan interest + … (new regime ignores these).</p>
          </div>
        </CardContent>
      </Card>

      <div className="rounded-md border bg-card p-4 text-sm">
        {result.savingPaise === 0 ? (
          <>Both regimes cost the same: <span className="font-semibold">{formatINR(result.new.totalTaxPaise)}</span>.</>
        ) : (
          <>The <span className="font-semibold">{result.cheaper === "new" ? "new" : "old"} regime</span> saves{" "}
            <span className="font-semibold text-income">{formatINR(result.savingPaise)}</span> a year.</>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <RegimeCard title="New regime" r={result.new} winner={result.cheaper === "new"} />
        <RegimeCard title="Old regime" r={result.old} winner={result.cheaper === "old"} />
      </div>

      <p className="text-xs text-muted-foreground">
        FY 2025-26 / AY 2026-27 slabs (unchanged for FY 2026-27 per Budget 2026). v1 applies §87A as a
        plain cutoff; marginal relief near the rebate threshold is not yet modelled.
      </p>
    </div>
  );
}
