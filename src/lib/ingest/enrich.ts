/**
 * Source-agnostic UPI enrichment matcher. Pure — imports no Supabase, no I/O.
 *
 * Given UPI-app export rows (BHIM today, Google Pay later — both produce the SAME `UpiEnrichmentRow`
 * shape) and the user's already-committed bank transactions, attach the real counterpart name to
 * each transaction it can match UNAMBIGUOUSLY. ENRICHMENT ONLY: never inserts a transaction, never
 * touches an amount or date. The same UPI money already lives in the bank statement, so adding rows
 * would double-count.
 *
 * Match key = (txnDate, |amountPaise|, sign), where sign follows the project convention
 * (− = outflow ↔ DR/Paid/Sent, + = inflow ↔ CR/Received).
 *   - exactly one candidate transaction  → unique match, write the counterpart name
 *   - ≥2 candidates                       → try to narrow by the row's bank → account; still ≥2 (or
 *                                           unresolved) → ambiguous (NEVER guess)
 *   - 0 candidates, or the row carries no usable name → unmatched
 *
 * `matched + ambiguous + unmatched === rows.length` always holds (every row is classified once).
 */
import type { UpiEnrichmentRow } from "./types.js";

/** Minimal committed-transaction shape the matcher needs (subset of the `transactions` row). */
export interface MatchableTxn {
  id: string;
  accountId: string;
  txnDate: string; // ISO YYYY-MM-DD
  amountPaise: number; // signed
}

/** Minimal account shape, used only to break a ≥2-candidate tie via the row's bank name. */
export interface MatchableAccount {
  id: string;
  name: string;
  institution: string; // SBI | FEDERAL | IDFC_BANK | IDFC_CC | SURYODAY_CC | ...
  kind: string; // bank | credit_card | broker | asset_snapshot
}

export interface EnrichResult {
  /** Transactions to enrich: one entry per uniquely-matched txn (a counterpart name to write). */
  updates: Array<{ id: string; merchant: string }>;
  /** Row-level tallies — sum to rows.length. */
  matched: number;
  ambiguous: number;
  unmatched: number;
}

const keyOf = (txnDate: string, amountPaise: number): string =>
  `${txnDate}|${Math.abs(amountPaise)}|${amountPaise < 0 ? "-" : "+"}`;

/**
 * Additively LAYER a counterpart name onto whatever `merchant` a transaction already carries, so a
 * second UPI source (Google Pay after BHIM) or a re-run adds context instead of wiping it. Enrichment
 * only ever grows the merchant string; it never replaces `description_raw`.
 *   - empty/null existing          → the incoming name
 *   - empty incoming               → existing unchanged (never blank a populated cell)
 *   - existing already contains it → unchanged (case-insensitive; re-uploads stay idempotent)
 *   - otherwise                    → `${existing} · ${incoming}`
 */
export function mergeMerchant(existing: string | null, incoming: string): string {
  const cur = (existing ?? "").trim();
  const add = incoming.trim();
  if (!cur) return add;
  if (!add) return cur;
  if (cur.toLowerCase().includes(add.toLowerCase())) return cur;
  return `${cur} · ${add}`;
}

/**
 * Resolve a UPI row's bank to exactly one of the user's accounts, or null when it can't be pinned
 * down. Heuristic on institution keywords — used ONLY to break a ≥2-candidate tie, and accepted only
 * when it yields a single account. Accounts carry no stored account number, so `accountMask` cannot
 * bind here; the bank name is the only signal (Google Pay rows have none → null → ambiguous).
 */
export function resolveAccountId(row: UpiEnrichmentRow, accounts: MatchableAccount[]): string | null {
  const b = row.bankName.toUpperCase();
  if (!b.trim()) return null;
  const isCc = /CREDIT|CARD/.test(b);
  const wants = (institution: string): boolean => {
    switch (institution) {
      case "SURYODAY_CC": return b.includes("SURYODAY");
      case "IDFC_CC": return b.includes("IDFC") && isCc;
      case "IDFC_BANK": return b.includes("IDFC") && !isCc;
      case "FEDERAL": return b.includes("FEDERAL");
      case "SBI": return b.includes("SBI") || b.includes("STATE BANK");
      default: return false;
    }
  };
  const hits = accounts.filter((a) => wants(a.institution));
  return hits.length === 1 ? hits[0].id : null;
}

export function matchEnrichment(
  rows: UpiEnrichmentRow[],
  txns: MatchableTxn[],
  accounts: MatchableAccount[],
): EnrichResult {
  // Index committed txns by (date, |amount|, sign).
  const index = new Map<string, MatchableTxn[]>();
  for (const t of txns) {
    const k = keyOf(t.txnDate, t.amountPaise);
    const arr = index.get(k);
    if (arr) arr.push(t); else index.set(k, [t]);
  }

  let unmatched = 0;
  let ambiguous = 0;
  // txn id → candidate names from every row that uniquely targets it (one txn, one merchant).
  const buckets = new Map<string, string[]>();

  for (const row of rows) {
    const name = row.counterpartyName.trim() || row.counterpartyVpa.trim();
    if (!name) { unmatched++; continue; } // nothing to enrich with (some Google Pay P2P rows)

    const candidates = index.get(keyOf(row.txnDate, row.amountPaise));
    if (!candidates || candidates.length === 0) { unmatched++; continue; }

    let target: MatchableTxn | null = candidates.length === 1 ? candidates[0] : null;
    if (!target) {
      const accId = resolveAccountId(row, accounts);
      const narrowed = accId ? candidates.filter((c) => c.accountId === accId) : [];
      if (narrowed.length === 1) target = narrowed[0];
    }
    if (!target) { ambiguous++; continue; } // ≥2 after narrowing → never guess

    const arr = buckets.get(target.id);
    if (arr) arr.push(name); else buckets.set(target.id, [name]);
  }

  let matched = 0;
  const updates: Array<{ id: string; merchant: string }> = [];
  for (const [id, names] of buckets) {
    if (new Set(names).size === 1) {
      updates.push({ id, merchant: names[0] });
      matched += names.length; // every row that pointed here matched
    } else {
      ambiguous += names.length; // two different names on one txn → trust none
    }
  }

  return { updates, matched, ambiguous, unmatched };
}
