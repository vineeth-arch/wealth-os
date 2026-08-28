import { createSupabaseServer } from "@/lib/supabase/server";
import { CalculatorsHub } from "@/components/calculators-hub";
import type { CgSegmentRow } from "@/components/calculators/capital-gains";
import { fetchAllRows } from "@/lib/supabase/paginate";

export const dynamic = "force-dynamic";

export default async function CalculatorsPage() {
  const supabase = await createSupabaseServer();
  type RawSeg = { financial_year: string; segment: string; short_term_paise: number; long_term_paise: number };
  // Multi-year realized-gain segments across many lots can exceed Supabase's 1000-row cap.
  const segRaw = await fetchAllRows<RawSeg>((from, to) =>
    supabase.from("realized_gain_segments")
      .select("financial_year,segment,short_term_paise,long_term_paise")
      .order("financial_year", { ascending: false }).order("segment").order("account_id").range(from, to));
  const segments: CgSegmentRow[] = segRaw.map((s) => ({
    financialYear: s.financial_year,
    segment: s.segment,
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
