/**
 * Google Pay official "Transaction statement" (PDF → markdown) parser. ENRICHMENT ONLY — these rows
 * NEVER become transactions (every GPay payment is funded by a bank account that already produces a
 * statement, so importing as primary double-counts). A SECOND format alongside the BHIM HTML and the
 * GPay "My Activity" markdown; unlike those, this one carries the 12-digit UPI Transaction ID and the
 * funding bank + last-4 — enabling exact-ID matching and account routing downstream.
 *
 * Verified format (per page, repeated): a `Transaction statement` header + `<phone>, <email>`; page-1
 * summary row `| <period> | | ₹<Sent> | ₹<Received> | |`; then multi-line records:
 *   Row A: `| <date> | <verb><PARTY> | … | ₹<amount> |`   (column count varies 3–5; empty middle cells)
 *   (optional separator `| --- | … |`)
 *   Row B: `| <time> | UPITransactionID:<12-digit> | … |`
 *   Funding line (plain text, NOT a table row): `Paidby<Bank><last4>` (outflow) / `Paidto<Bank><last4>`
 *   (inflow — credited to that bank). Self transfers read `Selftransferto<Bank><last4>` in Row A.
 * Footer to strip: `Note:Thisstatementreflects…` + `Page N of M`. Spaces are stripped throughout.
 * Money is integer paise (`parseAmount`); no value ever passes through an LLM.
 */
import type { GooglePayStatementEntry, GpayStatementReconciliation } from "../types.js";
import { parseAmount, mdCells, isMdRow, isMdSeparator } from "../util.js";
import { isGpayTransfer } from "../google-pay-category-map.js";

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

const DATE_RE = /^(\d{1,2})([A-Za-z]{3,9}),(\d{4})$/;          // 02Dec,2025
const TIME_RE = /^\d{1,2}:\d{2}(?:AM|PM)$/i;                    // 08:30PM
const PERIOD_RE = /^\d{1,2}[A-Za-z]+\d{4}-\d{1,2}[A-Za-z]+\d{4}$/; // 01December2025-31May2026
const VERB_RE = /^(Paidto|Receivedfrom|Selftransferto)(.*)$/; // party may be blank (GPay shows "Paid to" with no payee)
const FUNDING_RE = /^Paid(?:by|to)([A-Za-z .]+?)(\d{4})$/;     // PaidbyHDFCBank0789 / PaidtoHDFCBank0789
const UPI_RE = /UPITransactionID:(\d+)/;

/** `02Dec,2025` → ISO YYYY-MM-DD. Throws on an unknown month (silent coercion is forbidden). */
function gpayDateToISO(raw: string): string {
  const m = DATE_RE.exec(raw);
  if (!m) throw new Error(`unparseable GPay date: "${raw}"`);
  const mon = MONTHS[m[2].slice(0, 3).toLowerCase()];
  if (!mon) throw new Error(`bad month: "${raw}"`);
  return `${m[3]}-${mon}-${m[1].padStart(2, "0")}`;
}

const KNOWN_BANKS: Record<string, string> = {
  hdfcbank: "HDFC Bank",
  statebankofindia: "State Bank of India",
  canarabank: "Canara Bank",
};
/** De-concatenate a known bank token to a display name; fall back to the raw token. */
function bankDisplay(raw: string): string {
  return KNOWN_BANKS[raw.replace(/\s+/g, "").toLowerCase()] ?? raw.trim();
}

interface Pending { txnDate: string; party: string; kind: GooglePayStatementEntry["kind"]; amountPaise: number; }

export function parseGooglePayStatement(md: string): {
  entries: GooglePayStatementEntry[];
  reconciliation: GpayStatementReconciliation;
  warnings: string[];
} {
  const entries: GooglePayStatementEntry[] = [];
  const warnings: string[] = [];
  let sentTotalPaise: number | null = null;
  let receivedTotalPaise: number | null = null;

  let pending: Pending | null = null;
  let pendingUpi: string | null = null;
  let pendingTime = "";

  const finalize = (fundingRaw: string, last4: string) => {
    if (!pending) return;
    if (!pendingUpi) { warnings.push(`record without UPI id near ${pending.txnDate} ${pending.party}`); pending = null; return; }
    entries.push({
      txnDate: pending.txnDate,
      time: pendingTime,
      amountPaise: pending.amountPaise,
      direction: pending.amountPaise >= 0 ? "inflow" : "outflow",
      kind: pending.kind,
      party: pending.party,
      upiTxnId: pendingUpi,
      fundingBankName: bankDisplay(fundingRaw),
      fundingBankLast4: last4,
      merchantText: pending.party,
      rowRef: pendingUpi,
    });
    pending = null; pendingUpi = null; pendingTime = "";
  };

  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;

    // Funding line — plain text, finalizes the current record.
    const fund = FUNDING_RE.exec(line);
    if (fund && !isMdRow(line)) { finalize(fund[1], fund[2]); continue; }

    if (!isMdRow(line) || isMdSeparator(line)) continue; // headers/footers/separators
    const cells = mdCells(line);
    if (cells.length === 0) continue;
    const c0 = cells[0];

    // Page-1 summary row: period + Sent + Received (the two ₹ cells, in order).
    if (PERIOD_RE.test(c0.replace(/\s+/g, ""))) {
      const amts = cells.filter((c) => /^₹/.test(c));
      if (amts[0]) sentTotalPaise = parseAmount(amts[0]).paise;
      if (amts[1]) receivedTotalPaise = parseAmount(amts[1]).paise;
      continue;
    }

    // Row A — a transaction: date in c0; verb+party and the ₹ amount can sit in any column (3–5 vary).
    if (DATE_RE.test(c0)) {
      const verbCell = cells.find((c) => VERB_RE.test(c));
      const amtCell = cells.find((c) => /^₹/.test(c));
      const verb = verbCell ? VERB_RE.exec(verbCell) : null;
      if (!verb || !amtCell) { warnings.push(`date row without verb/amount: "${line}"`); continue; }
      if (pending) warnings.push(`incomplete record dropped near ${pending.txnDate} ${pending.party}`);
      const magnitude = parseAmount(amtCell).paise;
      const kind = verb[1] === "Receivedfrom" ? "received" : verb[1] === "Selftransferto" ? "self_transfer" : "paid";
      const signed = kind === "received" ? magnitude : -magnitude; // Paid/Self → outflow, Received → inflow
      let txnDate: string;
      try { txnDate = gpayDateToISO(c0); } catch (e) { warnings.push((e as Error).message); continue; }
      pending = { txnDate, party: verb[2].trim(), kind, amountPaise: signed };
      pendingUpi = null; pendingTime = "";
      continue;
    }

    // Row B — time + UPI id for the current record.
    if (TIME_RE.test(c0)) {
      const upi = UPI_RE.exec(cells[1] ?? line);
      if (pending && upi) { pendingUpi = upi[1]; pendingTime = c0; }
      continue;
    }
  }
  if (pending) warnings.push(`trailing incomplete record near ${pending.txnDate} ${pending.party}`);

  // Reconcile-or-show: Σ paid vs Sent, Σ received vs Received (self transfers excluded per the GPay note).
  const parsedSentPaise = entries.filter((e) => e.kind === "paid").reduce((s, e) => s + Math.abs(e.amountPaise), 0);
  const parsedReceivedPaise = entries.filter((e) => e.kind === "received").reduce((s, e) => s + e.amountPaise, 0);
  const sentDeltaPaise = sentTotalPaise === null ? null : parsedSentPaise - sentTotalPaise;
  const receivedDeltaPaise = receivedTotalPaise === null ? null : parsedReceivedPaise - receivedTotalPaise;
  const reconciliation: GpayStatementReconciliation = {
    sentTotalPaise, receivedTotalPaise, parsedSentPaise, parsedReceivedPaise,
    sentDeltaPaise, receivedDeltaPaise,
    ok: sentDeltaPaise === 0 && receivedDeltaPaise === 0,
  };

  return { entries, reconciliation, warnings };
}

// ─────────────────────────── matcher (Pass 2) ───────────────────────────
// Match GPay-statement entries to committed bank/credit_card transactions. ENRICHMENT ONLY. Two
// precision wins this statement uniquely supports: (1) ACCOUNT ROUTING by funding last-4 (restrict
// candidates to the right account, fall back to all bank/cc only when no last-4 hit); (2) UPI-ID
// TIEBREAK — when a candidate txn's narration/ref carries the same 12-digit UPI id, that is a near-
// exact primary key; otherwise fall back to same account + exact signed paise + date within window.
// 1:1, unambiguous only (mutual strict-closest); >1 candidate either way → ambiguous, never matched.

/** Minimal committed-txn shape: `refText` = ref_no + ' ' + upi_ref + ' ' + description_raw (for ID search). */
export interface GpayMatchableTxn { id: string; accountId: string; txnDate: string; amountPaise: number; refText: string; }
/** Account with the last 4 of its `account_number` (empty when unknown — routing then can't bind it). */
export interface GpayMatchableAccount { id: string; kind: string; last4: string; }

export interface GpayMatch { txnId: string; upiTxnId: string; confidence: "id" | "amount-window"; isTransfer: boolean; }
export interface GpayMatchResult {
  matched: GpayMatch[];
  ambiguous: GooglePayStatementEntry[];
  unmatched: GooglePayStatementEntry[];
  /** Per funding last-4: matched / total — surfaces which funding accounts are (un)imported. */
  byBank: Record<string, { matched: number; total: number }>;
}

const DAY_MS = 86400000;
const signOf = (n: number): number => (n < 0 ? -1 : n > 0 ? 1 : 0);
const gapDays = (a: string, b: string): number =>
  Math.round(Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / DAY_MS);

const uniqueNearest = <T extends { gap: number }>(arr: T[]): T | null => {
  if (arr.length === 0) return null;
  let min = Infinity;
  for (const x of arr) min = Math.min(min, x.gap);
  const at = arr.filter((x) => x.gap === min);
  return at.length === 1 ? at[0] : null; // tie → ambiguous
};

export function matchGooglePayStatement(
  entries: GooglePayStatementEntry[],
  txns: GpayMatchableTxn[],
  accounts: GpayMatchableAccount[],
  opts: { windowDays?: number } = {},
): GpayMatchResult {
  const windowDays = opts.windowDays ?? 3;
  const bankAccts = accounts.filter((a) => a.kind === "bank" || a.kind === "credit_card");
  const allBankIds = bankAccts.map((a) => a.id);
  const allBankSet = new Set(allBankIds);

  const byLast4 = new Map<string, string[]>();
  for (const a of bankAccts) if (a.last4) (byLast4.get(a.last4) ?? byLast4.set(a.last4, []).get(a.last4)!).push(a.id);
  const txnsByAccount = new Map<string, GpayMatchableTxn[]>();
  for (const t of txns) if (allBankSet.has(t.accountId)) (txnsByAccount.get(t.accountId) ?? txnsByAccount.set(t.accountId, []).get(t.accountId)!).push(t);

  // Routed candidate txns per entry: the account(s) whose last-4 matches the funding line, else all bank/cc.
  const entryRouted = entries.map((e) => {
    const ids = byLast4.get(e.fundingBankLast4);
    const accountIds = ids && ids.length ? ids : allBankIds;
    const out: GpayMatchableTxn[] = [];
    for (const id of accountIds) { const arr = txnsByAccount.get(id); if (arr) out.push(...arr); }
    return out;
  });

  const taken = new Set<string>();
  const decided = new Set<number>();
  const ambiguousIdx = new Set<number>();
  const matched: GpayMatch[] = [];

  // Phase A — UPI-ID match (primary). Accept iff the entry has exactly one id-candidate AND that txn
  // is id-claimed by exactly one entry.
  const idCands = entries.map((e, i) => entryRouted[i].filter((t) => t.refText.includes(e.upiTxnId)));
  const idClaimants = new Map<string, number[]>();
  entries.forEach((_, i) => { for (const t of idCands[i]) (idClaimants.get(t.id) ?? idClaimants.set(t.id, []).get(t.id)!).push(i); });
  entries.forEach((e, i) => {
    const cands = idCands[i];
    if (cands.length === 0) return;
    if (cands.length > 1) { ambiguousIdx.add(i); decided.add(i); return; }
    const t = cands[0];
    if ((idClaimants.get(t.id) ?? []).length !== 1) { ambiguousIdx.add(i); decided.add(i); return; }
    matched.push({ txnId: t.id, upiTxnId: e.upiTxnId, confidence: "id", isTransfer: isGpayTransfer(e) });
    taken.add(t.id); decided.add(i);
  });

  // Phase B — same account + exact signed paise + date within window, mutual strict-closest 1:1.
  const amtCands = entries.map((e, i) => decided.has(i) ? [] : entryRouted[i]
    .filter((t) => !taken.has(t.id) && signOf(t.amountPaise) === signOf(e.amountPaise) && t.amountPaise === e.amountPaise && gapDays(t.txnDate, e.txnDate) <= windowDays)
    .map((t) => ({ txnId: t.id, gap: gapDays(t.txnDate, e.txnDate) })));
  const txnClaimants = new Map<string, Array<{ idx: number; gap: number }>>();
  entries.forEach((_, i) => { for (const c of amtCands[i]) (txnClaimants.get(c.txnId) ?? txnClaimants.set(c.txnId, []).get(c.txnId)!).push({ idx: i, gap: c.gap }); });
  entries.forEach((e, i) => {
    if (decided.has(i)) return;
    if (amtCands[i].length === 0) return; // → unmatched
    const best = uniqueNearest(amtCands[i]);
    if (!best) { ambiguousIdx.add(i); decided.add(i); return; }
    const claim = uniqueNearest(txnClaimants.get(best.txnId) ?? []);
    if (!claim || claim.idx !== i || taken.has(best.txnId)) { ambiguousIdx.add(i); decided.add(i); return; }
    matched.push({ txnId: best.txnId, upiTxnId: e.upiTxnId, confidence: "amount-window", isTransfer: isGpayTransfer(e) });
    taken.add(best.txnId); decided.add(i);
  });

  const ambiguous = [...ambiguousIdx].map((i) => entries[i]);
  const unmatched = entries.filter((_, i) => !decided.has(i));

  const matchedRefs = new Set(matched.map((m) => m.upiTxnId));
  const byBank: Record<string, { matched: number; total: number }> = {};
  for (const e of entries) {
    const k = e.fundingBankLast4 || "unknown";
    (byBank[k] ??= { matched: 0, total: 0 }).total++;
    if (matchedRefs.has(e.upiTxnId)) byBank[k].matched++;
  }

  return { matched, ambiguous, unmatched, byBank };
}
