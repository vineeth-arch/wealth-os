/**
 * Capital-gains tax on REALIZED gains. Integer paise; format at the view. No deps.
 *
 * This does NOT recompute gains — it consumes the per-segment realized-gains record parsed from the
 * Upstox tax report (src/lib/ingest/parsers/upstox.ts → realized_gain_segments) and applies tax to the
 * EQUITY short-term / long-term split. Non-equity segments (F&O, commodities, currencies) are business/
 * speculative income taxed at slab; they are surfaced separately, not taxed here.
 *
 * Rates are configurable constants (current Indian equity rates, on/after 23-Jul-2024 per Budget 2024):
 *   - Equity STCG (§111A): 20%
 *   - Equity LTCG (§112A): 12.5% on gains above a ₹1,25,000 annual exemption
 * Verify these against the live Finance Act before filing.
 *
 * ASSUMPTIONS (surfaced in the UI): only net POSITIVE gains are taxed (a net loss in a bucket → ₹0 here;
 * set-off / carry-forward of losses is not modelled); cess/surcharge are excluded. Educational, not
 * financial advice.
 */

export interface CgRates {
  stcgRatePct: number;
  ltcgRatePct: number;
  ltcgExemptionPaise: number;
}
export const DEFAULT_CG_RATES: CgRates = {
  stcgRatePct: 20,
  ltcgRatePct: 12.5,
  ltcgExemptionPaise: 125_000 * 100, // ₹1,25,000 annual LTCG exemption
};

/** A realized-gains segment row as stored/parsed (paise). */
export interface CgSegment {
  segment: string;            // 'equities' | 'fo' | 'commodities' | 'currencies'
  shortTermPaise: number;
  longTermPaise: number;
}

export interface CapitalGainsResult {
  equityStcgPaise: number;            // net positive equity short-term gains
  equityLtcgPaise: number;            // net positive equity long-term gains (before exemption)
  ltcgExemptionUsedPaise: number;
  ltcgTaxablePaise: number;
  stcgTaxPaise: number;
  ltcgTaxPaise: number;
  totalTaxPaise: number;
  otherStcgPaise: number;             // non-equity short-term (slab — informational)
  otherLtcgPaise: number;             // non-equity long-term (slab — informational)
}

function isEquity(segment: string): boolean {
  return segment.toLowerCase() === "equities" || segment.toLowerCase() === "equity";
}

/** Compute equity capital-gains tax from realized segments. Rates are injectable for what-if scenarios. */
export function computeCapitalGainsTax(segments: CgSegment[], rates: CgRates = DEFAULT_CG_RATES): CapitalGainsResult {
  let eqST = 0, eqLT = 0, otherST = 0, otherLT = 0;
  for (const s of segments) {
    if (isEquity(s.segment)) { eqST += s.shortTermPaise; eqLT += s.longTermPaise; }
    else { otherST += s.shortTermPaise; otherLT += s.longTermPaise; }
  }
  const equityStcgPaise = Math.max(0, eqST);
  const equityLtcgPaise = Math.max(0, eqLT);
  const ltcgExemptionUsedPaise = Math.min(equityLtcgPaise, rates.ltcgExemptionPaise);
  const ltcgTaxablePaise = Math.max(0, equityLtcgPaise - rates.ltcgExemptionPaise);
  const stcgTaxPaise = Math.round((equityStcgPaise * rates.stcgRatePct) / 100);
  const ltcgTaxPaise = Math.round((ltcgTaxablePaise * rates.ltcgRatePct) / 100);
  return {
    equityStcgPaise, equityLtcgPaise, ltcgExemptionUsedPaise, ltcgTaxablePaise,
    stcgTaxPaise, ltcgTaxPaise, totalTaxPaise: stcgTaxPaise + ltcgTaxPaise,
    otherStcgPaise: otherST, otherLtcgPaise: otherLT,
  };
}

/** Project next year's equity CG tax by scaling this year's gains by a growth rate. */
export function projectCapitalGainsTax(segments: CgSegment[], growthPct: number, rates: CgRates = DEFAULT_CG_RATES): CapitalGainsResult {
  const factor = 1 + growthPct / 100;
  const scaled = segments.map((s) => ({
    segment: s.segment,
    shortTermPaise: Math.round(s.shortTermPaise * factor),
    longTermPaise: Math.round(s.longTermPaise * factor),
  }));
  return computeCapitalGainsTax(scaled, rates);
}
