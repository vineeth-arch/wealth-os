import type { StatementParseResult, ParsedTransaction } from "../types.js";
import { parseAmount, isAmount, parseDate, mdCells, isMdRow, isMdSeparator, finalizeHashes, normalizeDesc } from "../util.js";

const ACCOUNT = "IDFC FIRST Credit Card";
const DATE_CELL = /^(\d{2}\/\d{2}\/\d{4}|\d{2} [A-Za-z]{3} \d{2}|\d{2}\/[A-Za-z]{3}\/\d{4})$/;
const PERIOD = /(\d{2}\/[A-Za-z]{3}\/\d{4})\s*(?:-|to)\s*(\d{2}\/[A-Za-z]{3}\/\d{4})/;

const NOISE = [
  /^Card Number:/i, /^Purchases, EMIs & Other Debits$/i, /^Payments & Other Credits$/i,
  /^YOUR TRANSACTIONS$/i, /^ACTIVE EMI DETAILS/i, /^Credit Card Statement$/i, /^Page \d+/i,
  /^Refer /i, /^Enjoy /i, /^Flexible/i, /^Covert your/i, /reward points/i, /^Apply now|^Upgrade now|^Refer now/i,
  /^<\d+\/\d+>$/, /^#/, /^Total Amount Due/i, /^Statement Date/i, /^To know more/i, /^Need help/i,
  /^Rewards/i, /^Late payment/i, /credited for that cycle/i, /^Loan Interest/i, /^Amount Amount/i,
  /^BALANCE CONVERSION/i, /^friends and earn/i, /^transactions to easy/i, /^Date Details EMI/i,
  /^Interest Amount Amortization/i, /^Principal Amount Amortization/i,
];

interface RawTxn { txnDate: string; amountPaise: number; desc: string; card: string; }

/**
 * IDFC FIRST CC export quirk (verified on the real fixture): the markdown contains the SAME
 * statement rendered multiple times (different PDF layout passes). Strategy:
 *  - split the stream into statement-period groups (last seen period header wins);
 *  - within a group, a chronological reset (date going backwards) marks a NEW RENDER of the
 *    same statement; hashes are finalized per render and unioned, so repeated renders collapse
 *    while genuine same-day duplicates inside one render survive (occurrence index).
 * Direction comes ONLY from the DR/CR suffix on the amount. DR = outflow (−), CR = payment/refund (+).
 */
export function parseIdfcCc(content: string): StatementParseResult[] {
  const lines = content.split(/\r?\n/);
  type Group = { period: string; renders: RawTxn[][]; summaryNums: number[] };
  const groups = new Map<string, Group>();
  let currentPeriod: string | null = null;
  let card = "unknown";
  let pendingHead: string[] = [];
  let lastTxn: RawTxn | null = null;
  let lastDate: string | null = null;
  const warnings: string[] = [];

  const groupOf = (p: string): Group => {
    if (!groups.has(p)) groups.set(p, { period: p, renders: [[]], summaryNums: [] });
    return groups.get(p)!;
  };

  for (const lineRaw of lines) {
    const line = lineRaw.trim();
    if (!line || isMdSeparator(line)) continue;

    const pm = line.match(PERIOD);
    if (pm) {
      const p = `${parseDate(pm[1])}..${parseDate(pm[2])}`;
      if (p !== currentPeriod) { currentPeriod = p; lastDate = null; lastTxn = null; pendingHead = []; }
      continue;
    }
    if (!currentPeriod) continue;
    const g = groupOf(currentPeriod);

    const cm = line.match(/^Card Number:\s*XXXX\s*(\d{4})/i);
    if (cm) { card = cm[1]; pendingHead = []; lastTxn = null; continue; }

    if (isMdRow(line)) {
      const cells = mdCells(line);
      const dateIdx = cells.findIndex((c) => DATE_CELL.test(c));
      if (dateIdx === -1) { continue; }
      // amount + marker may be split across adjacent cells: "| 8,753.18 | DR |"
      const joined = [...cells];
      for (let i = 0; i < joined.length - 1; i++) {
        if (/^-?[\d,]+\.\d{2}$/.test(joined[i]) && /^(CR|DR)$/.test(joined[i + 1])) {
          joined[i] = `${joined[i]} ${joined[i + 1]}`;
          joined[i + 1] = "";
        }
      }
      const amtCell = [...joined].reverse().find((c) => /(CR|DR)$/.test(c) && isAmount(c));
      if (!amtCell) { warnings.push(`date row without DR/CR amount: "${line.slice(0, 70)}"`); continue; }
      const { paise, marker } = parseAmount(amtCell);
      const txnDate = parseDate(cells[dateIdx]);
      const descCells = joined.filter((c, i) =>
        i !== dateIdx && c && c !== amtCell && !isAmount(c) && !/^(CR|DR)$/.test(c) &&
        !/^(Convert|USD [\d.]+|EUR [\d.]+)$/.test(c));
      // chronological reset ⇒ new render of the same statement
      if (lastDate && txnDate < lastDate) { g.renders.push([]); }
      lastDate = txnDate;
      const t: RawTxn = {
        txnDate,
        amountPaise: marker === "DR" ? -paise : paise,
        desc: [...pendingHead, ...descCells].join(" "),
        card,
      };
      pendingHead = [];
      g.renders[g.renders.length - 1].push(t);
      lastTxn = t;
      continue;
    }

    if (NOISE.some((r) => r.test(line))) { pendingHead = []; lastTxn = null; continue; }
    if (/^r[\d,]+\.\d{2}/.test(line) || isAmount(line)) continue;
    // plain fragment: first after a txn row = its tail; later ones = next head
    if (lastTxn) { lastTxn.desc = `${lastTxn.desc} ${line}`.trim(); lastTxn = null; }
    else pendingHead.push(line);
  }

  // Per group: union renders by hash, reconcile against the statement's own DR/CR arithmetic.
  const results: StatementParseResult[] = [];
  for (const g of [...groups.values()].sort((a, b) => a.period.localeCompare(b.period))) {
    const byHash = new Map<string, ParsedTransaction>();
    const renderSizes: number[] = [];
    for (const render of g.renders) {
      if (!render.length) continue;
      renderSizes.push(render.length);
      const finalized = finalizeHashes(ACCOUNT, render.map((t) => ({
        txnDate: t.txnDate,
        descriptionRaw: t.desc.replace(/\s+/g, " ").trim(),
        amountPaise: t.amountPaise,
        subAccount: t.card,
      })));
      for (const f of finalized) if (!byHash.has(f.contentHash)) byHash.set(f.contentHash, f);
    }
    // renders of the same statement can truncate differently; union is authoritative
    const transactions = [...byHash.values()].sort((a, b) => a.txnDate.localeCompare(b.txnDate));
    const [periodStart, periodEnd] = g.period.split("..");
    const drSum = -transactions.filter((t) => t.amountPaise < 0).reduce((s, t) => s + t.amountPaise, 0);
    const crSum = transactions.filter((t) => t.amountPaise > 0).reduce((s, t) => s + t.amountPaise, 0);
    results.push({
      institution: "IDFC_CC", accountName: ACCOUNT, periodStart, periodEnd, transactions,
      warnings: renderSizes.length > 1
        ? [`statement rendered ${renderSizes.length}x in file (sizes: ${renderSizes.join(",")}) — unioned by content hash`]
        : [],
      reconciliation: {
        openingPaise: null, closingPaise: null, expectedDeltaPaise: null,
        parsedSumPaise: transactions.reduce((s, t) => s + t.amountPaise, 0),
        ok: transactions.length > 0,
        detail: `debits ${drSum} | credits ${crSum} — verify against statement summary in verify script`,
      },
    });
  }
  void normalizeDesc;
  if (warnings.length && results.length) results[0].warnings.push(...warnings);
  return results;
}
