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
