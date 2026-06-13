import type { StatementParseResult, ParsedTransaction } from "../types.js";
import { parseAmount, parseDate, mdCells, isMdRow, isMdSeparator, finalizeHashes } from "../util.js";

const ACCOUNT = "SBI Savings";

/**
 * SBI savings statement, MarkItDown-converted: one giant markdown table.
 * Preamble rows live INSIDE the table (Unnamed: N header). Transaction header row:
 * | Date | Details | Ref No/Cheque No | Debit | Credit | Balance |
 * Quirks: literal "\n" inside Details, "NaN" for empty cells, DD/MM/YYYY dates,
 * trailing branch boilerplate rows after the last transaction.
 */
export function parseSbi(content: string): StatementParseResult {
  const lines = content.split(/\r?\n/);
  const warnings: string[] = [];
  let periodStart: string | null = null, periodEnd: string | null = null;
  let inTxns = false;
  const raw: Array<Omit<ParsedTransaction, "occurrence" | "contentHash">> = [];
  let firstBalance: number | null = null, firstAmount: number | null = null, lastBalance: number | null = null;

  for (const line of lines) {
    if (!isMdRow(line) || isMdSeparator(line)) continue;
    const cells = mdCells(line);

    const period = line.match(/Statement From\s*:\s*(\d{2}-\d{2}-\d{4})\s*to\s*(\d{2}-\d{2}-\d{4})/);
    if (period) {
      periodStart = period[1].split("-").reverse().join("-");
      periodEnd = period[2].split("-").reverse().join("-");
    }

    if (!inTxns) {
      if (cells[0] === "Date" && cells[1] === "Details") inTxns = true;
      continue;
    }
    if (cells.length < 6) continue;
    const [dateC, detailsC, refC, debitC, creditC, balC] = cells;
    if (!/^\d{2}\/\d{2}\/\d{4}$/.test(dateC)) {
      // First non-date row after transactions = trailing boilerplate; stop.
      if (raw.length > 0) break;
      continue;
    }
    const txnDate = parseDate(dateC);
    const debit = debitC && debitC !== "NaN" ? parseAmount(debitC).paise : 0;
    const credit = creditC && creditC !== "NaN" ? parseAmount(creditC).paise : 0;
    if (debit === 0 && credit === 0) { warnings.push(`zero-amount row skipped @ ${dateC}`); continue; }
    if (debit > 0 && credit > 0) throw new Error(`SBI row has both debit and credit @ ${dateC}`);
    const amountPaise = credit > 0 ? credit : -debit;
    const balanceAfterPaise = balC && balC !== "NaN" ? parseAmount(balC).paise : undefined;
    if (balanceAfterPaise !== undefined) {
      if (firstBalance === null) { firstBalance = balanceAfterPaise; firstAmount = amountPaise; }
      lastBalance = balanceAfterPaise;
    }
    raw.push({
      txnDate,
      descriptionRaw: detailsC.replace(/\\n/g, " ").replace(/\s+/g, " ").trim(),
      amountPaise,
      balanceAfterPaise,
      refNo: refC && refC !== "NaN" ? refC : undefined,
    });
  }

  const transactions = finalizeHashes(ACCOUNT, raw);
  const opening = firstBalance !== null && firstAmount !== null ? firstBalance - firstAmount : null;
  const closing = lastBalance;
  const parsedSum = transactions.reduce((s, t) => s + t.amountPaise, 0);
  const expected = opening !== null && closing !== null ? closing - opening : null;

  // Independent check: every running balance must equal opening + cumulative sum.
  let chainOk = true;
  if (opening !== null) {
    let run = opening;
    for (const t of transactions) {
      run += t.amountPaise;
      if (t.balanceAfterPaise !== undefined && t.balanceAfterPaise !== run) { chainOk = false; break; }
    }
  }

  return {
    institution: "SBI", accountName: ACCOUNT, periodStart, periodEnd, transactions, warnings,
    reconciliation: {
      openingPaise: opening, closingPaise: closing, expectedDeltaPaise: expected, parsedSumPaise: parsedSum,
      ok: expected !== null && expected === parsedSum && chainOk,
      detail: chainOk ? "balance chain verified on every row" : "BALANCE CHAIN BROKEN",
    },
  };
}
