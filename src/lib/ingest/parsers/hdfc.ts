import type { StatementParseResult, ParsedTransaction } from "../types.js";
import { parseAmount, parseDate, finalizeHashes } from "../util.js";

const ACCOUNT = "HDFC — Sample";

/**
 * HDFC savings statement — fixed-width COLUMNAR text (NOT a markdown table). Column boundaries are
 * set by the dashed rule line under the header; we derive the seven column ranges from it and slice
 * every line by position. A 19-line PII preamble (holder, email, Cust ID, account no) repeats on
 * every page (22 pages) — we never emit or log it; only the period and account header are read.
 *
 * Layout: Date | Narration | Chq./Ref.No. | Value Dt | Withdrawal Amt. | Deposit Amt. | Closing Balance
 * Dates are DD/MM/YY. Narration wraps mid-token at the fixed column width across continuation lines
 * (blank Date column) — segments are concatenated directly. The trailing STATEMENT SUMMARY block
 * gives a strong multi-way reconciliation anchor (opening, debits, credits, closing, Dr/Cr counts).
 */
export function parseHdfcBank(content: string): StatementParseResult {
  const lines = content.split(/\r?\n/);
  const warnings: string[] = [];
  let periodStart: string | null = null, periodEnd: string | null = null;

  // Column ranges from the first dashed rule line (runs of '-').
  const ruleLine = lines.find((l) => /^-{4,}( {2,}-{2,})+/.test(l));
  if (!ruleLine) throw new Error("HDFC: column rule line not found");
  const cols = dashRuns(ruleLine);
  if (cols.length !== 7) throw new Error(`HDFC: expected 7 columns, found ${cols.length}`);

  const raw: Array<Omit<ParsedTransaction, "occurrence" | "contentHash">> = [];
  let inTxnRegion = false;
  let current: (typeof raw)[number] | null = null;
  let narration: string[] = [];

  const flush = () => {
    if (current) { current.descriptionRaw = narration.join("").replace(/\s+/g, " ").trim(); raw.push(current); }
    current = null; narration = [];
  };

  for (const line of lines) {
    // Period header (DD/MM/YYYY here, not DD/MM/YY).
    const period = line.match(/Statement From\s*:\s*(\d{2}\/\d{2}\/\d{4})\s*To:\s*(\d{2}\/\d{2}\/\d{4})/);
    if (period) { periodStart = parseDate(period[1]); periodEnd = parseDate(period[2]); }

    if (line.includes("STATEMENT SUMMARY")) { flush(); inTxnRegion = false; break; }
    if (/Withdrawal Amt\.|Closing Balance/.test(line) && /Narration/.test(line)) {
      flush(); inTxnRegion = true; continue; // header row → enter region
    }
    if (!inTxnRegion) continue;
    if (line.includes("**Continue**") || /^\*{4,}/.test(line.trim())) { flush(); inTxnRegion = false; continue; }
    if (line.trim() === "" || /^[-\s]+$/.test(line)) continue;   // blank or rule line

    const dateC = slice(line, cols[0]).trim();
    if (/^\d{2}\/\d{2}\/\d{2}$/.test(dateC)) {
      flush();
      const withdrawal = slice(line, cols[4]).trim();
      const deposit = slice(line, cols[5]).trim();
      if (!!withdrawal === !!deposit) throw new Error(`HDFC: row must have exactly one of withdrawal/deposit @ ${dateC}`);
      const amountPaise = deposit ? parseAmount(deposit).paise : -parseAmount(withdrawal).paise;
      const balC = slice(line, cols[6]).trim();
      const refC = slice(line, cols[2]).trim();
      current = {
        txnDate: iso2(dateC),
        descriptionRaw: "",
        amountPaise,
        balanceAfterPaise: balC ? parseAmount(balC).paise : undefined,
        refNo: refC || undefined,
      };
      narration = [slice(line, cols[1]).trim()];
    } else if (current) {
      const cont = slice(line, cols[1]).trim();
      if (cont) narration.push(cont);
    }
  }
  flush();

  const transactions = finalizeHashes(ACCOUNT, raw);

  // ---- STATEMENT SUMMARY — strong multi-way reconciliation anchor ----
  const sum = parseSummary(lines);
  const parsedSum = transactions.reduce((s, t) => s + t.amountPaise, 0);
  const sumWithdrawals = transactions.reduce((s, t) => (t.amountPaise < 0 ? s - t.amountPaise : s), 0);
  const sumDeposits = transactions.reduce((s, t) => (t.amountPaise > 0 ? s + t.amountPaise : s), 0);
  const outCount = transactions.filter((t) => t.amountPaise < 0).length;
  const inCount = transactions.filter((t) => t.amountPaise > 0).length;
  const lastBalance = transactions.length ? transactions[transactions.length - 1].balanceAfterPaise ?? null : null;

  const opening = sum?.opening ?? null;
  const closing = sum?.closing ?? null;
  const expected = opening !== null && closing !== null ? closing - opening : null;

  // Independent balance-chain: each running balance = opening + cumulative sum.
  let chainOk = true;
  if (opening !== null) {
    let run = opening;
    for (const t of transactions) {
      run += t.amountPaise;
      if (t.balanceAfterPaise !== undefined && t.balanceAfterPaise !== run) { chainOk = false; break; }
    }
  }

  const checks: Array<[boolean, string]> = sum
    ? [
        [sumWithdrawals === sum.debits, `Σwithdrawals ${sumWithdrawals} vs debits ${sum.debits}`],
        [sumDeposits === sum.credits, `Σdeposits ${sumDeposits} vs credits ${sum.credits}`],
        [outCount === sum.drCount, `Dr count ${outCount} vs ${sum.drCount}`],
        [inCount === sum.crCount, `Cr count ${inCount} vs ${sum.crCount}`],
        [opening! + sum.credits - sum.debits === closing, `opening+credits-debits vs closing`],
        [lastBalance === closing, `last running balance ${lastBalance} vs closing ${closing}`],
        [expected === parsedSum, `expectedΔ ${expected} vs parsedΣ ${parsedSum}`],
        [chainOk, "balance chain"],
      ]
    : [[false, "STATEMENT SUMMARY not found"]];

  const failed = checks.filter(([ok]) => !ok).map(([, d]) => d);
  const ok = failed.length === 0;

  return {
    institution: "HDFC", accountName: ACCOUNT, periodStart, periodEnd, transactions, warnings,
    reconciliation: {
      openingPaise: opening, closingPaise: closing, expectedDeltaPaise: expected, parsedSumPaise: parsedSum,
      ok,
      detail: ok
        ? `summary reconciled: ${outCount} Dr / ${inCount} Cr, balance chain verified on every row`
        : `RECONCILIATION FAILED: ${failed.join("; ")}`,
    },
  };
}

/** Column ranges [start, end) from runs of '-' in the rule line. The last range extends to EOL so
 *  right-aligned amounts wider than the nominal field are never clipped. */
function dashRuns(rule: string): Array<[number, number]> {
  const runs: Array<[number, number]> = [];
  const re = /-+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(rule))) runs.push([m.index, m.index + m[0].length]);
  if (runs.length) runs[runs.length - 1][1] = Number.MAX_SAFE_INTEGER;
  return runs;
}

function slice(line: string, [start, end]: [number, number]): string {
  return line.slice(start, end === Number.MAX_SAFE_INTEGER ? undefined : end);
}

/** DD/MM/YY → 20YY-MM-DD. */
function iso2(d: string): string {
  const m = d.match(/^(\d{2})\/(\d{2})\/(\d{2})$/);
  if (!m) throw new Error(`HDFC: unparseable date "${d}"`);
  return `20${m[3]}-${m[2]}-${m[1]}`;
}

interface Summary { opening: number; debits: number; credits: number; closing: number; drCount: number; crCount: number; }

function parseSummary(lines: string[]): Summary | null {
  const idx = lines.findIndex((l) => l.includes("STATEMENT SUMMARY"));
  if (idx < 0) return null;
  const amtRe = /\d[\d,]*\.\d{2}/g;
  let amounts: number[] | null = null;
  let counts: number[] | null = null;
  for (let i = idx + 1; i < lines.length && i < idx + 12; i++) {
    const l = lines[i];
    if (!amounts) {
      const a = l.match(amtRe);
      if (a && a.length >= 4) amounts = a.slice(0, 4).map((s) => parseAmount(s).paise);
    } else if (!counts) {
      const c = l.match(/\b\d+\b/g);
      if (c && c.length >= 2) counts = c.slice(0, 2).map(Number);
    }
  }
  if (!amounts || !counts) return null;
  return { opening: amounts[0], debits: amounts[1], credits: amounts[2], closing: amounts[3], drCount: counts[0], crCount: counts[1] };
}
