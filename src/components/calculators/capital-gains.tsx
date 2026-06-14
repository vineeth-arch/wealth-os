"use client";
import { useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatINR } from "@/lib/format";
import { computeCapitalGainsTax, projectCapitalGainsTax, DEFAULT_CG_RATES, type CgSegment } from "@/lib/calc/capital-gains";
import { AssumptionsCard, NumberField, ResultTile, toNum } from "@/components/calculators/shared";

export interface CgSegmentRow {
  financialYear: string;
  segment: string;
  shortTermPaise: number;
  longTermPaise: number;
}

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={muted ? "text-muted-foreground" : ""}>{value}</span>
    </div>
  );
}

export function CapitalGainsCalculator({ segments }: { segments: CgSegmentRow[] }) {
  const fys = useMemo(() => Array.from(new Set(segments.map((s) => s.financialYear))).sort().reverse(), [segments]);
  const [fy, setFy] = useState(fys[0] ?? "");
  const [growth, setGrowth] = useState("10");

  const rows: CgSegment[] = useMemo(
    () => segments.filter((s) => s.financialYear === fy).map((s) => ({ segment: s.segment, shortTermPaise: s.shortTermPaise, longTermPaise: s.longTermPaise })),
    [segments, fy],
  );
  const cg = useMemo(() => computeCapitalGainsTax(rows), [rows]);
  const projected = useMemo(() => projectCapitalGainsTax(rows, toNum(growth)), [rows, growth]);

  if (segments.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>No realized-gains record</CardTitle>
          <CardDescription>
            Import an Upstox tax report on the <span className="font-medium">Upstox</span> page. This view reads the
            parsed realized gains — it never recomputes them.
          </CardDescription>
        </CardHeader>
        <CardContent />
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Capital-gains tax</CardTitle>
          <CardDescription>From your imported realized-gains record. Equity short-/long-term is taxed here; other segments are slab income.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <label htmlFor="cg-fy" className="text-sm font-medium">Financial year</label>
            <select id="cg-fy" className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              value={fy} onChange={(e) => setFy(e.target.value)}>
              {fys.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <Row label="Equity STCG (net)" value={formatINR(cg.equityStcgPaise)} />
          <Row label="Equity LTCG (net, before exemption)" value={formatINR(cg.equityLtcgPaise)} />
          <Row label={`LTCG exemption used (₹${(DEFAULT_CG_RATES.ltcgExemptionPaise / 100).toLocaleString("en-IN")})`} value={formatINR(cg.ltcgExemptionUsedPaise)} muted />
          {(cg.otherStcgPaise !== 0 || cg.otherLtcgPaise !== 0) && (
            <Row label="Non-equity (F&O/commodities/currency) — slab income" value={`${formatINR(cg.otherStcgPaise + cg.otherLtcgPaise)}`} muted />
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-3">
        <ResultTile label={`STCG tax (${DEFAULT_CG_RATES.stcgRatePct}%)`} value={formatINR(cg.stcgTaxPaise)} />
        <ResultTile label={`LTCG tax (${DEFAULT_CG_RATES.ltcgRatePct}%)`} value={formatINR(cg.ltcgTaxPaise)} />
        <ResultTile label="Total equity CG tax" value={formatINR(cg.totalTaxPaise)} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Next-year projection</CardTitle>
          <CardDescription>Scale this year&apos;s realized gains by an assumed growth rate to estimate next year&apos;s tax.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="sm:max-w-xs">
            <NumberField id="cg-growth" label="Assumed gains growth (%)" mode="decimal" value={growth} onChange={setGrowth} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <ResultTile label="Projected equity CG tax" value={formatINR(projected.totalTaxPaise)} />
            <ResultTile label="Change vs this year" value={formatINR(projected.totalTaxPaise - cg.totalTaxPaise)} />
          </div>
        </CardContent>
      </Card>

      <AssumptionsCard items={[
        "Equity STCG 20% (§111A) and LTCG 12.5% over a ₹1,25,000 annual exemption (§112A), rates on/after 23-Jul-2024 — verify against the current Finance Act.",
        "Only net positive gains are taxed; a net loss in a bucket shows ₹0 here. Loss set-off / carry-forward is not modelled.",
        "Cess and surcharge are excluded. F&O/commodities/currencies are business/speculative income taxed at slab, not here.",
        "Gains are read from the parsed Upstox record — they are never recomputed.",
      ]} />
    </div>
  );
}
