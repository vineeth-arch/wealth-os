import { createSupabaseServer } from "@/lib/supabase/server";
import { CalculatorsHub } from "@/components/calculators-hub";
import type { CgSegmentRow } from "@/components/calculators/capital-gains";

export const dynamic = "force-dynamic";

export default async function CalculatorsPage() {
  const supabase = await createSupabaseServer();
  const { data: segRaw } = await supabase.from("realized_gain_segments")
    .select("financial_year,segment,short_term_paise,long_term_paise")
    .order("financial_year", { ascending: false });
  const segments: CgSegmentRow[] = (segRaw ?? []).map((s) => ({
    financialYear: s.financial_year as string,
    segment: s.segment as string,
    shortTermPaise: Number(s.short_term_paise),
    longTermPaise: Number(s.long_term_paise),
  }));

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Calculators</h1>
        <p className="text-sm text-muted-foreground">
          India-focused planning calculators. Each surfaces its assumptions; all are educational, not financial advice.
        </p>
      </div>
      <CalculatorsHub capitalGainsSegments={segments} />
    </div>
  );
}
