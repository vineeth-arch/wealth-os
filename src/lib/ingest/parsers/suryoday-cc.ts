import type { StatementParseResult, ParsedTransaction } from "../types.js";
import { parseAmount, parseDate, mdCells, isMdRow, isMdSeparator, finalizeHashes } from "../util.js";

const ACCOUNT = "Suryoday Credit Card";
const TYPES = ["PURCHASE", "PAYMENT", "CASHBACK", "REVERSAL", "FEE", "GST", "INTEREST"] as const;
type TxnType = (typeof TYPES)[number];
const CREDIT_TYPES = new Set<TxnType>(["PAYMENT", "CASHBACK", "REVERSAL"]);
const DATE_RE = /^\d{2}-[A-Za-z]{3}-\d{4}$/;
const PLAIN_ROW = new RegExp(`^(\\d{2}-[A-Za-z]{3}-\\d{4})\\s+(\\d{6,})\\s+(.+?)\\s+(${TYPES.join("|")})\\s+(-?[\\d,]+\\.\\d{2})\\s*$`);
const PLAIN_ROW_NOTYPE = /^(\d{2}-[A-Za-z]{3}-\d{4})\s+(\d{6,})\s+(.+?)\s+(-?[\d,]+\.\d{2})\s*$/;

interface Pending { txnDate: string; refNo: string; desc: string; type: TxnType | null; amount: number; }

/**
 * Suryoday SFB CC export: multiple statements AND duplicated, interleaved PDF pages —
 * verified on the fixture (350 ref instances, 234 unique; the same ref appears inside
 * two different statements' sections). Section-based parsing is therefore impossible.
 * Strategy:
 *   1. collect every Account Summary (statement date + 7 rupee figures) file-wide;
 *   2. collect every transaction row file-wide (table rows, plain rows, type-continuation
 *      rows, bare standalone type words);
 *   3. dedupe by ref number, keeping the copy with the richest description;
 *   4. bucket transactions into billing cycles by date window (prevStmtDate, stmtDate];
 *   5. reconcile every bucket against its own Account Summary:
 *        closing = opening + purchases + fees + cash + gst + payments(negative)
 * Statement-native amount sign is authoritative: positive = charge, negative = credit.
 */
export function parseSuryodayCc(content: string): StatementParseResult[] {
  const lines = content.split(/\r?\n/);

  // ---- pass 1: statement summaries ----
  interface Summary { stmtDate: string; figures: number[]; }
  const summaries: Summary[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/Statement Summary/.test(lines[i])) continue;
    let stmtDate: string | null = null;
    const figures: number[] = [];
    let inAcct = false;
    for (let j = i; j < Math.min(i + 40, lines.length); j++) {
      if (!stmtDate) {
        const dm = lines[j].match(/(\d{2}-[A-Za-z]{3}-\d{4})/);
        if (dm) stmtDate = parseDate(dm[1]);
      }
      if (/Account Summary/.test(lines[j])) inAcct = true;
      if (inAcct) {
        for (const m of lines[j].matchAll(/₹\s*(-?[\d,]+\.\d{2})/g)) figures.push(parseAmount(m[1]).paise);
        if (figures.length >= 7) break;
      }
    }
    if (stmtDate && figures.length >= 7 && !summaries.some((s) => s.stmtDate === stmtDate)) {
      summaries.push({ stmtDate, figures: figures.slice(0, 7) });
    }
  }
  summaries.sort((a, b) => a.stmtDate.localeCompare(b.stmtDate));

  // ---- pass 2: transactions file-wide ----
  const pend: Pending[] = [];
  let cashbackDetail = false; // "Details of Cashback Credited" lists per-purchase accruals, NOT money movements
  for (const lineRaw of lines) {
    const line = lineRaw.trim();
    if (!line || isMdSeparator(line)) continue;
    if (/Details of Cashback Credited/i.test(line)) { cashbackDetail = true; continue; }
    if (/^TRANSACTIONS$/.test(line) || /FEES, PAYMENTS, ADJUSTMENTS/i.test(line) || /Statement Summary/.test(line)) cashbackDetail = false;
    if (cashbackDetail) continue;

    const pm = line.match(PLAIN_ROW);
    if (pm) {
      pend.push({ txnDate: parseDate(pm[1]), refNo: pm[2], desc: pm[3], type: pm[4] as TxnType, amount: parseAmount(pm[5]).paise });
      continue;
    }
    const pn = line.match(PLAIN_ROW_NOTYPE);
    if (pn) {
      pend.push({ txnDate: parseDate(pn[1]), refNo: pn[2], desc: pn[3], type: null, amount: parseAmount(pn[4]).paise });
      continue;
    }
    if (!isMdRow(line)) {
      if (TYPES.includes(line as TxnType) && pend.length && pend[pend.length - 1].type === null) {
        pend[pend.length - 1].type = line as TxnType;
      }
      continue;
    }
    const cells = mdCells(line);
    const dateIdx = cells.findIndex((c) => DATE_RE.test(c));
    const typeCell = cells.find((c) => TYPES.includes(c as TxnType)) as TxnType | undefined;
    if (dateIdx === -1) {
      if (typeCell && pend.length && pend[pend.length - 1].type === null) pend[pend.length - 1].type = typeCell;
      continue;
    }
    const amtCell = [...cells].reverse().find((c) => /^-?[\d,]+\.\d{2}$/.test(c));
    if (!amtCell) continue;
    const refNo = cells.find((c) => /^\d{6,}$/.test(c)) ?? "";
    const descCells = cells.filter((c, i) => i !== dateIdx && c && c !== amtCell && c !== refNo && !TYPES.includes(c as TxnType));
    pend.push({
      txnDate: parseDate(cells[dateIdx]), refNo,
      desc: descCells.join(" "),
      type: typeCell ?? null,
      amount: parseAmount(amtCell).paise,
    });
  }

  // ---- pass 3: dedupe by ref (richest description wins) ----
  const byRef = new Map<string, Pending>();
  const noRef: Pending[] = [];
  for (const p of pend) {
    if (!p.refNo) { noRef.push(p); continue; }
    const prev = byRef.get(p.refNo);
    if (!prev) { byRef.set(p.refNo, p); continue; }
    if (prev.amount !== p.amount || prev.txnDate !== p.txnDate) {
      // same ref, different facts — keep both, flag later via reconciliation
      noRef.push(p);
      continue;
    }
    const richer = (a: Pending, b: Pending) => (a.desc.replace(/PURCHASE/g, "").trim().length >= b.desc.replace(/PURCHASE/g, "").trim().length ? a : b);
    const merged = richer(prev, p);
    merged.type = prev.type ?? p.type;
    byRef.set(p.refNo, merged);
  }
  const unique = [...byRef.values(), ...noRef];

  // ---- pass 4: bucket by cycle; boundary-day txns solved by reconciliation ----
  // Suryoday assigns same-day boundary txns by posting TIME, which the export does not
  // carry. Txns dated exactly on a statement date are therefore ambiguous between the
  // statement ending that day and the next one. We resolve them with a subset-sum
  // solver so that EVERY statement's Account Summary reconciles exactly; if no exact
  // assignment exists, we fail loudly rather than guess.
  const stmtDates = new Set(summaries.map((s) => s.stmtDate));
  const results: StatementParseResult[] = [];
  let carry: Pending[] = []; // boundary txns pushed forward from the previous statement

  const subsetReaching = (pool: Pending[], target: number): Pending[] | null => {
    // DP over signed paise sums; pool is small (boundary-day txns only)
    if (pool.length > 22) throw new Error(`Suryoday: boundary pool too large (${pool.length})`);
    const memo = new Map<string, Pending[] | null>();
    const go = (i: number, rest: number): Pending[] | null => {
      if (rest === 0 && i === pool.length) return [];
      if (i === pool.length) return null;
      const key = `${i}|${rest}`;
      if (memo.has(key)) return memo.get(key)!;
      const skip = go(i + 1, rest);
      let res: Pending[] | null = skip;
      if (res === null) {
        const take = go(i + 1, rest - pool[i].amount);
        if (take !== null) res = [pool[i], ...take];
      }
      memo.set(key, res);
      return res;
    };
    return go(0, target);
  };

  for (let s = 0; s < summaries.length; s++) {
    const { stmtDate, figures } = summaries[s];
    const prevDate = s > 0 ? summaries[s - 1].stmtDate : "0000-00-00";
    const [opening, , , , , , closing] = figures;
    const expected = closing - opening;
    const warnings: string[] = [];
    const eq = figures[0] + figures[1] + figures[2] + figures[3] + figures[4] + figures[5];
    if (eq !== closing) warnings.push(`Account Summary arithmetic off by ${closing - eq} paise`);

    const fixed = [...carry, ...unique.filter((p) => p.txnDate > prevDate && p.txnDate < stmtDate)];
    const pool = unique.filter((p) => p.txnDate === stmtDate);
    carry = [];

    // statement-native sign: liability delta contribution of txn = +amount (charges positive, credits negative)
    const fixedDelta = fixed.reduce((t, p) => t + p.amount, 0);
    let chosen: Pending[] = pool;
    if (stmtDates.has(stmtDate) && s < summaries.length - 1) {
      const need = expected - fixedDelta;
      const sol = subsetReaching(pool, need);
      if (sol === null) {
        warnings.push(`no boundary assignment reconciles ${stmtDate}; keeping all ${pool.length} boundary txns here`);
      } else {
        chosen = sol;
        const ids = new Set(sol.map((x) => x.refNo + "|" + x.amount + "|" + x.desc));
        carry = pool.filter((x) => !ids.has(x.refNo + "|" + x.amount + "|" + x.desc));
        if (carry.length) warnings.push(`${carry.length} boundary txn(s) on ${stmtDate} assigned to next cycle by reconciliation`);
      }
    }
    const bucket = [...fixed, ...chosen];

    const raw = bucket.map((p) => {
      let type = p.type;
      if (type === null && p.amount < 0) type = "PAYMENT";
      if (type === null) throw new Error(`Suryoday: type never resolved @ ${p.txnDate} "${p.desc.slice(0, 40)}"`);
      const abs = Math.abs(p.amount);
      const isCredit = p.amount < 0 || CREDIT_TYPES.has(type);
      return {
        txnDate: p.txnDate,
        descriptionRaw: (p.desc === "PURCHASE" ? "" : p.desc).replace(/\s+/g, " ").trim(),
        amountPaise: isCredit ? abs : -abs,
        refNo: p.refNo || undefined,
        nativeType: type,
      };
    }).sort((a, b) => a.txnDate.localeCompare(b.txnDate));

    const transactions = finalizeHashes(ACCOUNT, raw);
    const parsedSum = transactions.reduce((t, x) => t + x.amountPaise, 0);
    const ok = expected === -parsedSum && transactions.length > 0;
    results.push({
      institution: "SURYODAY_CC", accountName: ACCOUNT,
      periodStart: prevDate === "0000-00-00" ? null : prevDate, periodEnd: stmtDate,
      transactions, warnings,
      reconciliation: {
        openingPaise: opening, closingPaise: closing, expectedDeltaPaise: expected, parsedSumPaise: parsedSum,
        ok,
        detail: ok ? "liability delta matches signed txn sum exactly (ref-deduped; boundary txns reconciliation-assigned)" : `MISMATCH: stmt delta ${expected} vs −sum ${-parsedSum}`,
      },
    });
  }
  return results;
}
