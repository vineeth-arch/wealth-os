/**
 * Monika Halan bucket aggregation. Pure functions, no framework imports, fully testable.
 * Money is integer paise. Sign: + = inflow to account, − = outflow.
 *
 * The 15 parent buckets are identified by their leading two-digit prefix so renames of
 * the human-readable suffix never break the math.
 */

export type BucketClass =
  | "income" | "needs" | "wants" | "protect" | "debt" | "planned_needs" | "planned_wants"
  | "invest" | "assets" | "transfer" | "work" | "tax" | "family" | "leakage_watch" | "review" | "uncategorized";

const PREFIX_TO_CLASS: Record<string, BucketClass> = {
  "01": "income", "02": "needs", "03": "wants", "04": "protect", "05": "debt",
  "06": "planned_needs", "07": "planned_wants", "08": "invest", "09": "assets",
  "10": "transfer", "11": "work", "12": "tax", "13": "family", "14": "leakage_watch", "15": "review",
};

/** Classes that are real spending (the denominator for "where did money go"). Excludes income, invest, transfers, assets, review. */
export const SPEND_CLASSES: ReadonlySet<BucketClass> = new Set<BucketClass>([
  "needs", "wants", "protect", "debt", "planned_needs", "planned_wants", "work", "tax", "family", "leakage_watch",
]);

export const LEAKAGE_TAG = "leakage";

export function classifyParent(parent: string | null | undefined): BucketClass {
  if (!parent) return "uncategorized";
  const m = parent.match(/^(\d{2})/);
  return (m && PREFIX_TO_CLASS[m[1]]) || "uncategorized";
}

export interface TxnLike {
  txnDate: string;        // ISO YYYY-MM-DD
  amountPaise: number;    // signed
  parent: string | null;  // parent bucket name of the txn's category, or null
  tags: string[];
}

export interface BucketTotal {
  parent: string;
  cls: BucketClass;
  inflowPaise: number;
  outflowPaise: number;   // stored positive (magnitude of negatives)
  netPaise: number;
  count: number;
}

/** Totals per parent bucket across the given transactions. */
export function bucketTotals(txns: TxnLike[]): BucketTotal[] {
  const map = new Map<string, BucketTotal>();
  for (const t of txns) {
    const parent = t.parent ?? "(uncategorized)";
    const cls = classifyParent(t.parent);
    const cur = map.get(parent) ?? { parent, cls, inflowPaise: 0, outflowPaise: 0, netPaise: 0, count: 0 };
    if (t.amountPaise >= 0) cur.inflowPaise += t.amountPaise;
    else cur.outflowPaise += -t.amountPaise;
    cur.netPaise += t.amountPaise;
    cur.count += 1;
    map.set(parent, cur);
  }
  return [...map.values()].sort((a, b) => a.parent.localeCompare(b.parent));
}

export interface MonthlyFlow {
  month: string;          // YYYY-MM
  incomePaise: number;    // inflows classified income
  spendPaise: number;     // outflows in SPEND_CLASSES
  investPaise: number;    // outflows in invest
  leakagePaise: number;   // outflows tagged leakage (subset of spend)
}

/** Monthly cash flow. Transfers (10), assets (09) and review (15) are excluded from income/spend. */
export function monthlyCashFlow(txns: TxnLike[]): MonthlyFlow[] {
  const map = new Map<string, MonthlyFlow>();
  for (const t of txns) {
    const month = t.txnDate.slice(0, 7);
    const cls = classifyParent(t.parent);
    const row = map.get(month) ?? { month, incomePaise: 0, spendPaise: 0, investPaise: 0, leakagePaise: 0 };
    if (cls === "income" && t.amountPaise > 0) row.incomePaise += t.amountPaise;
    else if (cls === "invest" && t.amountPaise < 0) row.investPaise += -t.amountPaise;
    else if (SPEND_CLASSES.has(cls) && t.amountPaise < 0) row.spendPaise += -t.amountPaise;
    if (t.amountPaise < 0 && t.tags.includes(LEAKAGE_TAG)) row.leakagePaise += -t.amountPaise;
    map.set(month, row);
  }
  return [...map.values()].sort((a, b) => a.month.localeCompare(b.month));
}

/** Total leakage (the tag) over the window, by spend category parent. */
export function leakageByParent(txns: TxnLike[]): { parent: string; paise: number; count: number }[] {
  const map = new Map<string, { parent: string; paise: number; count: number }>();
  for (const t of txns) {
    if (!t.tags.includes(LEAKAGE_TAG) || t.amountPaise >= 0) continue;
    const parent = t.parent ?? "(uncategorized)";
    const cur = map.get(parent) ?? { parent, paise: 0, count: 0 };
    cur.paise += -t.amountPaise;
    cur.count += 1;
    map.set(parent, cur);
  }
  return [...map.values()].sort((a, b) => b.paise - a.paise);
}

export interface AccountLike {
  id: string;
  name: string;
  kind: string;                 // 'bank' | 'credit_card' | 'broker' | 'asset_snapshot'
  anchorBalancePaise: number | null;
  anchorDate: string | null;    // ISO
}

export interface AccountBalance { id: string; name: string; kind: string; balancePaise: number; }

/**
 * Current balance per account = anchor balance + Σ(amounts on/after the anchor date).
 * Net worth = Σ across accounts (credit-card balances are naturally negative).
 */
export function accountBalances(accounts: AccountLike[], txns: Array<{ accountId: string; txnDate: string; amountPaise: number }>): {
  balances: AccountBalance[];
  netWorthPaise: number;
} {
  const sums = new Map<string, number>();
  for (const a of accounts) sums.set(a.id, a.anchorBalancePaise ?? 0);
  for (const t of txns) {
    const acct = accounts.find((a) => a.id === t.accountId);
    if (!acct) continue;
    if (acct.anchorDate && t.txnDate < acct.anchorDate) continue; // pre-anchor flows already baked into the opening balance
    sums.set(t.accountId, (sums.get(t.accountId) ?? 0) + t.amountPaise);
  }
  const balances = accounts.map((a) => ({ id: a.id, name: a.name, kind: a.kind, balancePaise: sums.get(a.id) ?? 0 }));
  return { balances, netWorthPaise: balances.reduce((s, b) => s + b.balancePaise, 0) };
}

export interface HoldingLike {
  isin: string;
  qty: number;
  lastPricePaise: number; // snapshot's own last price — the last-known fallback
  asOf: string;           // snapshot date
}
export interface PriceLike { isin: string; pricePaise: number; priceDate: string }
export interface HoldingsValuation {
  valuePaise: number;
  asOfDate: string | null; // most recent price/snapshot date contributing to the value
  pricedCount: number;     // holdings valued from a fetched price row
  fallbackCount: number;   // holdings valued from the snapshot's last-known price
}

/**
 * Present value of holdings = Σ qty × latest price. Price source is the most recent `prices` row per
 * ISIN; when none exists (refresh hasn't run, or fetch failed) it falls back to the snapshot's own
 * last price — it NEVER blanks. Returns the as-of date actually used so the UI can label staleness.
 */
export function holdingsValue(holdings: HoldingLike[], prices: PriceLike[]): HoldingsValuation {
  const latestPrice = new Map<string, PriceLike>();
  for (const p of prices) {
    const cur = latestPrice.get(p.isin);
    if (!cur || p.priceDate > cur.priceDate) latestPrice.set(p.isin, p);
  }
  let valuePaise = 0, pricedCount = 0, fallbackCount = 0;
  let asOfDate: string | null = null;
  for (const h of holdings) {
    const p = latestPrice.get(h.isin);
    const unit = p ? p.pricePaise : h.lastPricePaise;
    const usedDate = p ? p.priceDate : h.asOf;
    if (p) pricedCount++; else fallbackCount++;
    valuePaise += Math.round(h.qty * unit);
    if (usedDate && (asOfDate === null || usedDate > asOfDate)) asOfDate = usedDate;
  }
  return { valuePaise, asOfDate, pricedCount, fallbackCount };
}
