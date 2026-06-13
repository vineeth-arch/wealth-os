import type { StatementParseResult, ParsedTransaction } from "../types.js";
import { parseAmount, isAmount, parseDate, mdCells, isMdRow, isMdSeparator, finalizeHashes } from "../util.js";

const ACCOUNT = "IDFC FIRST Savings";
const TS = /(\d{2} [A-Za-z]{3} \d{2}) (\d{2}:\d{2})/;

const BOILERPLATE = [
  /^REGISTERED OFFICE/i, /^Page \d+ of \d+/i, /^STATEMENT OF ACCOUNT/i, /^CONSOLIDATED STATEMENT/i,
  /^CUSTOMER ID/i, /^STATEMENT FOR/i, /^Cheque No\.?$/i, /^Trans Date and$/i, /^Time$/i, /^Name$/i,
  /^Value Date Transaction Details/i, /^Brought forward/i, /^Carried forward/i, /^Opening Balance/i,
  /End of the statement/i, /^IMPORTANT/i, /^Chetpet, Chennai/i, /^Chennai-/i, /^GSTIN/i, /^Legends?:?$/i,
];

const GLOSSARY = /^(ATM|CDM|CHQ|Fund Trf|IDFC|IFSC|IFT|IMPS|MICR|NEFT|OTP|PIN|POS|RD|RTGS|SI|TPT|TRF|TXN|UPI|URN|EMI|ECS|INB|VMT|NACH|MMID|PG)(-[A-Z]+)?\s+[A-Z]/;

function isNoise(line: string): boolean {
  return BOILERPLATE.some((r) => r.test(line)) || GLOSSARY.test(line);
}

/**
 * IDFC bank statement: each transaction is split across (a) plain-text description
 * fragments and (b) a one-row markdown table holding timestamp, value date, amount,
 * and running balance with CR/DR suffix. Some rows (ATM) are fully plain text.
 * Direction is derived from the running-balance delta — never guessed from text.
 * Header carries Opening/Total Debits/Total Credits/Closing for full reconciliation.
 */
export function parseIdfcBank(content: string): StatementParseResult {
  const lines = content.split(/\r?\n/);
  const warnings: string[] = [];
  let periodStart: string | null = null, periodEnd: string | null = null;
  let opening: number | null = null, closing: number | null = null;
  let totalDebits: number | null = null, totalCredits: number | null = null;

  const pm = content.match(/STATEMENT FOR\s*\|?\s*(\d{2}-[A-Z]{3}-\d{4}) to (\d{2}-[A-Z]{3}-\d{4})/i);
  if (pm) { periodStart = parseDate(pm[1]); periodEnd = parseDate(pm[2]); }

  // Header summary row: | | 14,435.41 CR | | 38,678.75 | | 24,409.00 | | | 165.66 CR | |
  for (let i = 0; i < lines.length; i++) {
    if (/Opening Balance/.test(lines[i]) && /Total Debits/.test(lines[i]) && isMdRow(lines[i])) {
      for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
        if (!isMdRow(lines[j]) || isMdSeparator(lines[j])) continue;
        const nums = mdCells(lines[j]).filter((c) => isAmount(c));
        if (nums.length === 4) {
          const [o, d, c2, cl] = nums.map((n) => parseAmount(n));
          opening = o.marker === "DR" ? -o.paise : o.paise;
          totalDebits = d.paise; totalCredits = c2.paise;
          closing = cl.marker === "DR" ? -cl.paise : cl.paise;
          break;
        }
      }
      if (opening !== null) break;
    }
  }

  interface Pending { txnDate: string; amounts: { paise: number; marker: "CR" | "DR" | null }[]; balance: number; descParts: string[]; }
  const txns: Pending[] = [];
  let pendingHead: string[] = [];      // plain lines accumulated before next anchor
  let started = false;                  // ignore everything before the Opening Balance line
  let tailTarget: Pending | null = null; // most recent txn, eligible for ONE tail line
  let stop = false;

  for (const lineRaw of lines) {
    if (stop) break;
    const line = lineRaw.trim();
    if (!line) continue;
    if (!started) { if (/^Opening Balance\s+[\d,]+\.\d{2}/.test(line)) started = true; continue; }
    if (/End of the statement|^CONSOLIDATED STATEMENT/i.test(line)) { stop = true; break; }
    if (isMdSeparator(line)) continue;

    const ts = line.match(TS);
    if (ts) {
      // anchor row — table or plain text
      const txnDate = parseDate(ts[1]);
      let cells: string[];
      if (isMdRow(line)) cells = mdCells(line).filter(Boolean);
      else cells = [line];
      // amounts: all CR/DR-or-plain numbers in the row, excluding the timestamp/value-date cells
      const amountTokens: { paise: number; marker: "CR" | "DR" | null }[] = [];
      let descInline = "";
      for (const cell of cells) {
        const rest = cell.replace(TS, "").trim();
        // plain-text anchor: pull trailing "amount balance CR" pattern
        const tokens = rest.length ? rest.split(/\s{2,}|\s(?=\d[\d,]*\.\d{2}\s*(?:CR|DR)?$)/) : [];
        if (!isMdRow(line)) {
          const m = rest.match(/^(.*?)\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s*(CR|DR)\s*$/);
          if (m) {
            descInline = m[1].replace(/\d{2} [A-Za-z]{3} \d{2}\s*/g, "").trim();
            amountTokens.push(parseAmount(m[2]), parseAmount(`${m[3]} ${m[4]}`));
            continue;
          }
        }
        if (isAmount(cell) && !/^\d{2} [A-Za-z]{3} \d{2}/.test(cell)) amountTokens.push(parseAmount(cell));
        else if (!TS.test(cell) && !/^\d{2} [A-Za-z]{3} \d{2}$/.test(cell) && cell && isMdRow(line)) descInline += (descInline ? " " : "") + cell;
        void tokens;
      }
      if (amountTokens.length < 2) { warnings.push(`anchor without amount+balance: "${line.slice(0, 60)}"`); continue; }
      const balTok = amountTokens[amountTokens.length - 1];
      if (balTok.marker === null) warnings.push(`balance without CR/DR marker @ ${txnDate}`);
      const balance = balTok.marker === "DR" ? -balTok.paise : balTok.paise;
      const t: Pending = { txnDate, amounts: amountTokens.slice(0, -1), balance, descParts: [...pendingHead] };
      if (descInline) t.descParts.push(descInline);
      pendingHead = [];
      txns.push(t);
      tailTarget = t;
      continue;
    }

    if (isMdRow(line) || isNoise(line)) { continue; }
    // plain description fragment: first one after an anchor is its tail, rest belong to the next head
    if (tailTarget) { tailTarget.descParts.push(line); tailTarget = null; }
    else pendingHead.push(line);
  }

  // Direction by balance-chain: prev → next balance delta must equal ±amount.
  const raw: Array<Omit<ParsedTransaction, "occurrence" | "contentHash">> = [];
  let prev = opening;
  for (const t of txns) {
    const amt = t.amounts[0].paise; // single amount cell per row in this layout
    let signed: number;
    if (prev !== null) {
      const delta = t.balance - prev;
      if (delta === amt) signed = amt;
      else if (delta === -amt) signed = -amt;
      else { throw new Error(`IDFC balance chain broken @ ${t.txnDate}: prev=${prev} bal=${t.balance} amt=${amt}`); }
    } else {
      signed = t.amounts[0].marker === "DR" ? -amt : amt;
      warnings.push("no opening balance — first txn direction from marker");
    }
    prev = t.balance;
    raw.push({
      txnDate: t.txnDate,
      descriptionRaw: t.descParts.join(" ").replace(/\s+/g, " ").trim(),
      amountPaise: signed,
      balanceAfterPaise: t.balance,
    });
  }

  const transactions = finalizeHashes(ACCOUNT, raw);
  const parsedSum = transactions.reduce((s, t) => s + t.amountPaise, 0);
  const expected = opening !== null && closing !== null ? closing - opening : null;
  const debitsSum = -transactions.filter((t) => t.amountPaise < 0).reduce((s, t) => s + t.amountPaise, 0);
  const creditsSum = transactions.filter((t) => t.amountPaise > 0).reduce((s, t) => s + t.amountPaise, 0);
  const totalsOk = totalDebits === null || (debitsSum === totalDebits && creditsSum === totalCredits);

  return {
    institution: "IDFC_BANK", accountName: ACCOUNT, periodStart, periodEnd, transactions, warnings,
    reconciliation: {
      openingPaise: opening, closingPaise: closing, expectedDeltaPaise: expected, parsedSumPaise: parsedSum,
      ok: expected !== null && expected === parsedSum && totalsOk,
      detail: totalsOk
        ? `debits ${debitsSum} == stated ${totalDebits}; credits ${creditsSum} == stated ${totalCredits}; balance chain enforced per row`
        : `TOTALS MISMATCH: debits ${debitsSum} vs ${totalDebits}, credits ${creditsSum} vs ${totalCredits}`,
    },
  };
}
