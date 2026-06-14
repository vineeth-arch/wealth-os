/**
 * Money Manager → committed-transaction matcher. Pure — no Supabase, no I/O.
 *
 * The MM `Period` is LOG time, not settlement time, so matching is by direction + exact signed amount
 * within a small date WINDOW (default ±3 days) — unlike the UPI enricher's exact-date key. ENRICHMENT
 * ONLY: a matched MM entry attaches its richer merchant/note/category to an existing bank/credit_card
 * transaction; an unmatched MM entry is NEVER inserted (that would double-count a separate ledger).
 *
 * 1:1, unambiguous only. Greedy by closest date, but only a MUTUAL strict-closest pairing is accepted:
 * an entry E matches txn T iff T is E's unique nearest candidate AND E is T's unique nearest candidate.
 * Any tie (same-day same-amount pair) or contested pairing is left AMBIGUOUS and never guessed.
 */
import type { MatchableTxn } from "./enrich.js";
import type { MoneyManagerEntry } from "./types.js";

export interface MmMatch {
  txnId: string;
  mmRowRef: string;
  /** Whole-day gap between the txn date and the MM log date (0 = same day). */
  dayGap: number;
  confidence: "exact-day" | "within-window";
}

export interface MmMatchResult {
  matched: MmMatch[];
  /** MM entries that had ≥1 candidate but no unambiguous 1:1 pairing (never guessed). */
  ambiguous: MoneyManagerEntry[];
  /** MM entries with no candidate transaction at all (likely cash / timing gap / un-imported account). */
  unmatchedMM: MoneyManagerEntry[];
}

const DAY_MS = 86400000;
const sign = (n: number): number => (n < 0 ? -1 : n > 0 ? 1 : 0);
const dayGap = (isoA: string, isoB: string): number =>
  Math.round(Math.abs(Date.parse(`${isoA}T00:00:00Z`) - Date.parse(`${isoB}T00:00:00Z`)) / DAY_MS);

export const DEFAULT_WINDOW_DAYS = 3;

/**
 * Pair MM entries to committed transactions (already filtered to bank/credit_card accounts).
 * Candidate = same direction AND exact signed `amountPaise` AND |date gap| ≤ windowDays.
 */
export function matchMoneyManager(
  txns: MatchableTxn[],
  entries: MoneyManagerEntry[],
  opts: { windowDays?: number } = {},
): MmMatchResult {
  const windowDays = opts.windowDays ?? DEFAULT_WINDOW_DAYS;

  // Index txns by signed amount for O(candidates) lookup.
  const byAmount = new Map<number, MatchableTxn[]>();
  for (const t of txns) {
    const arr = byAmount.get(t.amountPaise);
    if (arr) arr.push(t); else byAmount.set(t.amountPaise, [t]);
  }

  // candidate pairs per entry index and per txn id
  const entryCands: Array<Array<{ txnId: string; gap: number }>> = entries.map(() => []);
  const txnCands = new Map<string, Array<{ entryIdx: number; gap: number }>>();

  entries.forEach((e, ei) => {
    if (e.amountPaise === 0) return;
    const pool = byAmount.get(e.amountPaise);
    if (!pool) return;
    for (const t of pool) {
      if (sign(t.amountPaise) !== sign(e.amountPaise)) continue; // direction must match (amount equality already implies it, kept explicit)
      const gap = dayGap(t.txnDate, e.loggedAt);
      if (gap > windowDays) continue;
      entryCands[ei].push({ txnId: t.id, gap });
      const arr = txnCands.get(t.id);
      if (arr) arr.push({ entryIdx: ei, gap }); else txnCands.set(t.id, [{ entryIdx: ei, gap }]);
    }
  });

  // Unique strict-nearest pick for a candidate list; null when empty or tied at the minimum.
  const uniqueNearest = <T extends { gap: number }>(cands: T[]): T | null => {
    if (cands.length === 0) return null;
    let min = Infinity;
    for (const c of cands) min = Math.min(min, c.gap);
    const atMin = cands.filter((c) => c.gap === min);
    return atMin.length === 1 ? atMin[0] : null; // tie → ambiguous
  };

  const matched: MmMatch[] = [];
  const ambiguous: MoneyManagerEntry[] = [];
  const unmatchedMM: MoneyManagerEntry[] = [];

  entries.forEach((e, ei) => {
    const cands = entryCands[ei];
    if (cands.length === 0) { unmatchedMM.push(e); return; }
    const best = uniqueNearest(cands);
    if (!best) { ambiguous.push(e); return; } // tie among txns
    const txnBest = uniqueNearest(txnCands.get(best.txnId) ?? []);
    if (!txnBest || txnBest.entryIdx !== ei) { ambiguous.push(e); return; } // not mutual → contested
    matched.push({
      txnId: best.txnId,
      mmRowRef: e.rowRef,
      dayGap: best.gap,
      confidence: best.gap === 0 ? "exact-day" : "within-window",
    });
  });

  return { matched, ambiguous, unmatchedMM };
}
