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
import { mergeMerchant, type MatchableTxn } from "./enrich.js";
import { resolveMmCategory } from "./money-manager-category-map.js";
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

// ─────────────────────────── apply-plan (Pass 3) ───────────────────────────
// Pure planning of the DB writes for matched pairs. Mirrors the UPI enricher's write contract:
// `merchant` only IMPROVES (mergeMerchant), `description_raw` is NEVER touched, and a re-run is a
// no-op. Adds: a single replaceable `MM: …` notes line, a category applied ONLY over an
// Uncategorized-Review (category_source='default') row (else surfaced as a suggestion), and provenance
// (enrichment_source='money_manager', mm_row_ref) for idempotent re-uploads.

/** Marker owning the single Money Manager line inside the free-text `notes` column. */
export const MM_NOTE_PREFIX = "MM: ";

/** Build the one MM context line for a matched entry: `MM: <category> / <note> · <description>`. */
export function mmNoteLine(entry: MoneyManagerEntry): string {
  const head = [entry.categoryRaw, entry.note].filter((s) => s && s.trim()).join(" / ");
  const base = `${MM_NOTE_PREFIX}${head}`;
  return entry.description && entry.description.trim() ? `${base} · ${entry.description.trim()}` : base;
}

/**
 * Replace (not duplicate) the single line owned by `prefix` in a free-text notes blob: drop any prior
 * line starting with `prefix`, append the fresh one. Re-running with the same line is a no-op; an
 * updated export updates in place. Shared by every enrichment source (each owns its own prefix, so
 * `MM:` and `GPay:` lines coexist without clobbering each other).
 */
export function mergeSourceNote(existing: string | null, line: string, prefix: string): string {
  const kept = (existing ?? "").split("\n").filter((l) => l.trim() !== "" && !l.startsWith(prefix));
  if (line.trim()) kept.push(line);
  return kept.join("\n");
}

/** MM-specific note merge (keeps the historical name + gate). */
export function mergeMmNote(existing: string | null, mmLine: string): string {
  return mergeSourceNote(existing, mmLine, MM_NOTE_PREFIX);
}

/** Current persisted state of a matched transaction the planner needs to decide improve-vs-overwrite. */
export interface MmTxnState {
  id: string;
  merchant: string | null;
  notes: string | null;
  /** 'rule' | 'ai_suggested' | 'user' | 'default' | 'money_manager' — 'default' == still Uncategorized Review. */
  categorySource: string;
  /** Previously-recorded MM provenance, for idempotency. */
  mmRowRef: string | null;
}

/** One intended write. `changed === false` means an idempotent re-run — the caller skips it. */
export interface MmWrite {
  id: string;
  mmRowRef: string;
  /** Merged notes blob (MM line replaced/added). */
  notes: string;
  /** Present only when it IMPROVES the current merchant (never blanks, never `description_raw`). */
  merchant?: string;
  /** Present only when a category is APPLIED (row was Uncategorized Review). */
  categoryId?: string;
  categorySource?: "money_manager";
  /** Present (instead of applying) when the row is already categorized — shown in the report to confirm. */
  suggestedCategoryName?: string;
  changed: boolean;
}

/**
 * Plan the per-transaction writes for the matched pairs. `resolveCategory` maps a target leaf NAME to
 * its id, returning null when it must NOT be applied (unknown, or a Leakage 14 / Review 15 guard hit) —
 * such a mapping is neither applied nor suggested.
 */
export function planMoneyManagerWrites(
  matched: MmMatch[],
  entriesByRef: Map<string, MoneyManagerEntry>,
  txnStates: Map<string, MmTxnState>,
  resolveCategory: (name: string) => { id: string } | null,
): MmWrite[] {
  const writes: MmWrite[] = [];
  for (const m of matched) {
    const entry = entriesByRef.get(m.mmRowRef);
    const state = txnStates.get(m.txnId);
    if (!entry || !state) continue;

    const mergedMerchant = mergeMerchant(state.merchant, entry.merchantText);
    const merchantChanged = mergedMerchant !== (state.merchant ?? "");
    const mergedNotes = mergeMmNote(state.notes, mmNoteLine(entry));
    const notesChanged = mergedNotes !== (state.notes ?? "");

    let categoryId: string | undefined;
    let categorySource: "money_manager" | undefined;
    let suggestedCategoryName: string | undefined;
    const resolution = resolveMmCategory(entry);
    if (resolution.categoryName) {
      const resolved = resolveCategory(resolution.categoryName); // null ⇒ forbidden/unknown ⇒ skip
      if (resolved) {
        if (state.categorySource === "default") {
          categoryId = resolved.id;        // apply ONLY over Uncategorized Review
          categorySource = "money_manager";
        } else {
          suggestedCategoryName = resolution.categoryName; // already categorized ⇒ suggest, never overwrite
        }
      }
    }

    const categoryApplied = categoryId !== undefined;
    const provenanceChanged = state.mmRowRef !== m.mmRowRef;
    const changed = merchantChanged || notesChanged || categoryApplied || provenanceChanged;

    const w: MmWrite = { id: m.txnId, mmRowRef: m.mmRowRef, notes: mergedNotes, changed };
    if (merchantChanged) w.merchant = mergedMerchant;
    if (categoryApplied) { w.categoryId = categoryId; w.categorySource = categorySource; }
    if (suggestedCategoryName) w.suggestedCategoryName = suggestedCategoryName;
    writes.push(w);
  }
  return writes;
}
