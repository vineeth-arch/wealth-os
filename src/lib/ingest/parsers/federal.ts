import type { StatementParseResult, ParsedTransaction } from "../types.js";
import { parseAmount, parseDate, mdCells, isMdRow, isMdSeparator, finalizeHashes } from "../util.js";

const ACCOUNT = "Federal Bank Savings";
const HEADING = /# Federal Bank - Savings Account Statement (\d{1,2} [A-Za-z]{3} \d{4})\s*-\s*(\d{1,2} [A-Za-z]{3} \d{4})/;

/**
 * Federal Bank export = MANY monthly statements concatenated (one H1 per month).
 * Direction resolution priority: 1) running-balance chain (paise-exact);
 * 2) IN/OUT token in narration; 3) first row only: rounded summary opening (tol < Rs 1).
 * Anything still ambiguous throws.
 */
export function parseFederal(content: string): StatementParseResult[] {
  const lines = content.split(/\r?\n/);
  const starts: number[] = [];
  lines.forEach((l, i) => { if (HEADING.test(l)) starts.push(i); });
  if (!starts.length) throw new Error("Federal: no statement headings found");

  const results: StatementParseResult[] = [];
  for (let s = 0; s < starts.length; s++) {
    const seg = lines.slice(starts[s], starts[s + 1] ?? lines.length);
    const hm = seg[0].match(HEADING)!;
    const periodStart = parseDate(hm[1]);
    const periodEnd = parseDate(hm[2]);
    const year = Number(periodStart.slice(0, 4));
    const warnings: string[] = [];

    let roundedOpening: number | null = null, roundedClosing: number | null = null;
    for (const l of seg) {
      if (!isMdRow(l)) continue;
      const rupeeCells = mdCells(l).filter((c) => /^₹-?[\d,]+$/.test(c));
      if (rupeeCells.length >= 4) {
        roundedOpening = parseAmount(rupeeCells[0].replace("₹", "")).paise;
        roundedClosing = parseAmount(rupeeCells[rupeeCells.length - 1].replace("₹", "")).paise;
        break;
      }
    }

    interface Pending { txnDate: string; amount: number; balance: number; desc: string[]; }
    const pend: Pending[] = [];
    let currentDate: string | null = null;
    let descBuf: string[] = [];
    let numBuf: number[] = [];
    const DEC = /^-?[\d,]+\.\d{2}$/;
    const isFooter = (l: string) => /5AM - 6PM|CONTACT US|PAGE \d+ OF \d+|080-\d+|Day\/Night Comment|Opening Balance|\+ Money In/i.test(l);
    const isDoubled = (l: string) => /^([A-Za-z])\1/.test(l); // AAcc.., DDaa.. PDF artifacts
    const isTail = (l: string) => l.length <= 10 && /^[a-z0-9./@:-]+$/i.test(l) && !DEC.test(l);
    const emit = (amount: number, balance: number) => {
      if (!currentDate) return;
      pend.push({ txnDate: currentDate, amount, balance, desc: [...descBuf] });
      descBuf = []; numBuf = [];
    };

    for (const lineRaw of seg) {
      const line = lineRaw.trim();
      if (!line || isMdSeparator(line) || HEADING.test(line)) continue;
      if (isFooter(line) || isDoubled(line)) { descBuf = []; numBuf = []; continue; }

      const dm = line.match(/^(\d{1,2} [A-Za-z]{3})$/);
      if (dm) { currentDate = parseDate(dm[1], year); descBuf = []; numBuf = []; continue; }

      if (isMdRow(line)) {
        const cells = mdCells(line).filter(Boolean);
        const decimals: string[] = [];
        const textCells: string[] = [];
        for (const c of cells) {
          const pair = c.match(/^(-?[\d,]+\.\d{2})\s+(-?[\d,]+\.\d{2})$/); // "4.25 27,469.72" in one cell
          if (pair) { decimals.push(pair[1], pair[2]); continue; }
          if (DEC.test(c)) decimals.push(c);
          else if (!isFooter(c)) textCells.push(c);
        }
        if (decimals.length === 2 && currentDate) {
          descBuf.push(...textCells);
          emit(parseAmount(decimals[0]).paise, parseAmount(decimals[1]).paise);
        }
        continue;
      }
      if (DEC.test(line)) {
        numBuf.push(parseAmount(line).paise);
        if (numBuf.length === 2) emit(numBuf[0], numBuf[1]);
        continue;
      }
      const pairLine = line.match(/^(-?[\d,]+\.\d{2})\s+(-?[\d,]+\.\d{2})$/); // "1,817.00 720.18" on one plain line
      if (pairLine) {
        emit(parseAmount(pairLine[1]).paise, parseAmount(pairLine[2]).paise);
        continue;
      }
      const inline = line.match(/^(.*\S)\s+(-?[\d,]+\.\d{2})\s+(-?[\d,]+\.\d{2})$/);
      if (inline) {
        descBuf.push(inline[1]);
        emit(parseAmount(inline[2]).paise, parseAmount(inline[3]).paise);
        continue;
      }
      // plain text: short tail fragments attach to the LAST txn; everything else starts the next
      if (isTail(line)) {
        if (pend.length && descBuf.length === 0) pend[pend.length - 1].desc.push(line);
        continue;
      }
      numBuf = [];
      descBuf.push(line);
    }

    const raw: Array<Omit<ParsedTransaction, "occurrence" | "contentHash">> = [];
    let prev: number | null = null;
    for (let i = 0; i < pend.length; i++) {
      const t = pend[i];
      const descJoined = t.desc.join(" ");
      let signed: number | null = null;
      if (prev !== null) {
        const delta = t.balance - prev;
        if (delta === t.amount) signed = t.amount;
        else if (delta === -t.amount) signed = -t.amount;
        else warnings.push(`balance chain gap @ ${t.txnDate} (delta ${delta}, amt ${t.amount})`);
      }
      if (signed === null) {
        const hasOut = /UPIOUT|UPI ?OUT|\bOUT\//.test(descJoined);
        const hasIn = /UPI ?IN\b|\bIN\//.test(descJoined);
        if (hasOut && !hasIn) signed = -t.amount;
        else if (hasIn && !hasOut) signed = t.amount;
        else if (roundedOpening !== null && i === 0) {
          const asCredit = Math.abs(t.balance - t.amount - roundedOpening);
          const asDebit = Math.abs(t.balance + t.amount - roundedOpening);
          if (asCredit < 100 && asDebit >= 100) signed = t.amount;
          else if (asDebit < 100 && asCredit >= 100) signed = -t.amount;
        }
        if (signed === null) throw new Error(`Federal ${periodStart}: cannot resolve direction @ ${t.txnDate} amt ${t.amount} desc "${descJoined.slice(0, 50)}"`);
      }
      prev = t.balance;
      raw.push({ txnDate: t.txnDate, descriptionRaw: descJoined.replace(/\s+/g, " ").trim() || "UPI", amountPaise: signed, balanceAfterPaise: t.balance });
    }

    const transactions = finalizeHashes(ACCOUNT, raw);
    const opening = transactions.length ? transactions[0].balanceAfterPaise! - transactions[0].amountPaise : roundedOpening;
    const closing = transactions.length ? transactions[transactions.length - 1].balanceAfterPaise! : roundedClosing;
    const parsedSum = transactions.reduce((x, t) => x + t.amountPaise, 0);
    const expected = opening !== null && closing !== null ? closing - opening : null;
    const summaryOk =
      roundedOpening === null || opening === null || closing === null || roundedClosing === null ||
      (Math.abs(opening - roundedOpening) < 100 && Math.abs(closing - roundedClosing) < 100);
    if (!summaryOk) warnings.push(`derived opening/closing disagree with rounded summary (${roundedOpening}/${roundedClosing})`);

    results.push({
      institution: "FEDERAL", accountName: ACCOUNT, periodStart, periodEnd, transactions, warnings,
      reconciliation: {
        openingPaise: opening, closingPaise: closing, expectedDeltaPaise: expected, parsedSumPaise: parsedSum,
        ok: expected !== null && expected === parsedSum && summaryOk,
        detail: "balance-chain + rounded-summary cross-check",
      },
    });
  }
  return results.sort((a, b) => (a.periodStart ?? "").localeCompare(b.periodStart ?? ""));
}
