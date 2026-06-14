/**
 * Pure aggregation for dashboard drill-downs. No framework imports → unit-tested in verify.ts and
 * runnable client-side on the rows the dashboard already loaded. Money is integer paise; sign + =
 * inflow, − = outflow.
 *
 * The income/spend/invest/leakage definitions are NOT re-derived here — `metricValue` mirrors
 * `monthlyCashFlow` (src/lib/halan.ts) exactly, reusing `classifyParent` + `SPEND_CLASSES`, so the
 * drill-down of a KPI always sums back to that KPI.
 */
import { classifyParent, SPEND_CLASSES, LEAKAGE_TAG } from "./halan.js";

export type DrillMetric = "income" | "spend" | "invest" | "leakage" | "net";

/** A committed transaction enriched with the display fields a drill-down needs. */
export interface DrillTxn {
  id: string;
  txnDate: string;        // ISO YYYY-MM-DD
  amountPaise: number;    // signed
  accountId: string;
  accountName: string;
  descriptionRaw: string;
  merchant: string;       // enriched counterpart name ("" if none)
  categoryId: string;     // "" if uncategorized
  categoryName: string;   // "" if uncategorized
  parent: string | null;  // parent bucket name (e.g. "03 Spend-it Wants"), or null
  categorySource: string; // default | rule | ai_suggested | user
  tags: string[];
}

const monthOf = (txnDate: string): string => txnDate.slice(0, 7);

/**
 * The signed paise a txn contributes to `metric` (positive magnitude for spend/invest/leakage, the
 * inflow for income), or null when it doesn't contribute. Mirrors monthlyCashFlow's conditions.
 *
 * `net` is the only signed metric: it returns the txn's raw signed amount for any income/spend/invest
 * contributor (and null otherwise), so Σ over a month = income − spend − invest (the leftover cash
 * flow). Transfers/assets/review are excluded exactly as monthlyCashFlow excludes them.
 */
export function metricValue(t: DrillTxn, metric: DrillMetric): number | null {
  const cls = classifyParent(t.parent);
  switch (metric) {
    case "income": return cls === "income" && t.amountPaise > 0 ? t.amountPaise : null;
    case "invest": return cls === "invest" && t.amountPaise < 0 ? -t.amountPaise : null;
    case "spend": return SPEND_CLASSES.has(cls) && t.amountPaise < 0 ? -t.amountPaise : null;
    case "leakage": return t.amountPaise < 0 && t.tags.includes(LEAKAGE_TAG) ? -t.amountPaise : null;
    case "net": {
      if (cls === "income" && t.amountPaise > 0) return t.amountPaise;
      if (cls === "invest" && t.amountPaise < 0) return t.amountPaise;
      if (SPEND_CLASSES.has(cls) && t.amountPaise < 0) return t.amountPaise;
      return null;
    }
  }
}

export interface AccountSubtotal { accountId: string; accountName: string; subtotalPaise: number; count: number }

/** Per-account subtotals of `metric` for `month`. Σ subtotalPaise === the KPI headline for that month. */
export function breakdownByAccount(txns: DrillTxn[], metric: DrillMetric, month: string): AccountSubtotal[] {
  const map = new Map<string, AccountSubtotal>();
  for (const t of txns) {
    if (monthOf(t.txnDate) !== month) continue;
    const v = metricValue(t, metric);
    if (v === null) continue;
    const cur = map.get(t.accountId) ?? { accountId: t.accountId, accountName: t.accountName, subtotalPaise: 0, count: 0 };
    cur.subtotalPaise += v;
    cur.count += 1;
    map.set(t.accountId, cur);
  }
  return [...map.values()].sort((a, b) => b.subtotalPaise - a.subtotalPaise);
}

/** The `n` largest contributing txns to `metric` for `month`, by absolute amount (desc). */
export function topNTransactions(txns: DrillTxn[], metric: DrillMetric, month: string, n: number): DrillTxn[] {
  return txns
    .filter((t) => monthOf(t.txnDate) === month && metricValue(t, metric) !== null)
    .sort((a, b) => Math.abs(b.amountPaise) - Math.abs(a.amountPaise))
    .slice(0, n);
}

export interface BucketLeaf { categoryName: string; inflowPaise: number; outflowPaise: number; netPaise: number; count: number; txns: DrillTxn[] }
export interface BucketDrill { inflowPaise: number; outflowPaise: number; netPaise: number; totalPaise: number; leaves: BucketLeaf[] }

/**
 * Every txn in a parent bucket, grouped by leaf category. Tracks inflow, outflow and signed net per
 * leaf so the function serves every parent (income/transfers, not just spend) — the bucket pages use
 * net; the dashboard's "Where money went"/leakage cards still read outflow (`totalPaise` === outflow).
 * Σ leaf.outflowPaise === bucket outflow; Σ leaf.netPaise === bucket net. Pre-filter `txns` by month to
 * scope it to a period; pass all txns for all-time.
 */
export function bucketDrill(txns: DrillTxn[], parent: string): BucketDrill {
  const leaves = new Map<string, BucketLeaf>();
  let inflowPaise = 0, outflowPaise = 0;
  for (const t of txns) {
    if ((t.parent ?? "(uncategorized)") !== parent) continue;
    const name = t.categoryName || "(uncategorized)";
    const leaf = leaves.get(name) ?? { categoryName: name, inflowPaise: 0, outflowPaise: 0, netPaise: 0, count: 0, txns: [] };
    if (t.amountPaise < 0) { leaf.outflowPaise += -t.amountPaise; outflowPaise += -t.amountPaise; }
    else { leaf.inflowPaise += t.amountPaise; inflowPaise += t.amountPaise; }
    leaf.netPaise += t.amountPaise;
    leaf.count += 1;
    leaf.txns.push(t);
    leaves.set(name, leaf);
  }
  return {
    inflowPaise, outflowPaise, netPaise: inflowPaise - outflowPaise, totalPaise: outflowPaise,
    leaves: [...leaves.values()].sort((a, b) => Math.abs(b.netPaise) - Math.abs(a.netPaise)),
  };
}
