import { readFileSync } from "node:fs";
import { parseSbi } from "../src/lib/ingest/parsers/sbi.js";
import { parseIdfcBank } from "../src/lib/ingest/parsers/idfc-bank.js";
import { parseFederal } from "../src/lib/ingest/parsers/federal.js";
import { parseIdfcCc } from "../src/lib/ingest/parsers/idfc-cc.js";
import { parseSuryodayCc } from "../src/lib/ingest/parsers/suryoday-cc.js";
import { parseBhimUpi, parseZerodhaHoldings } from "../src/lib/ingest/parsers/market.js";
import { loadTaxonomy, loadRules, categorize, FALLBACK_CATEGORY } from "../src/lib/ingest/rules.js";
import { deriveLlmStatus, isLlmProvider, DEFAULT_LLM_PROVIDER } from "../src/lib/integrations.js";
import { formatPaise } from "../src/lib/ingest/util.js";
import type { StatementParseResult } from "../src/lib/ingest/types.js";

const F = (p: string) => readFileSync(`fixtures/${p}`, "utf8");
let failures = 0;

function report(r: StatementParseResult) {
  const rec = r.reconciliation;
  const flag = rec.ok ? "PASS" : "FAIL";
  if (!rec.ok) failures++;
  console.log(`\n[${flag}] ${r.institution}  ${r.accountName}  ${r.periodStart ?? "?"} → ${r.periodEnd ?? "?"}`);
  console.log(`  txns: ${r.transactions.length}   opening: ${rec.openingPaise !== null ? formatPaise(rec.openingPaise) : "n/a"}   closing: ${rec.closingPaise !== null ? formatPaise(rec.closingPaise) : "n/a"}`);
  console.log(`  expected Δ: ${rec.expectedDeltaPaise !== null ? formatPaise(rec.expectedDeltaPaise) : "n/a"}   parsed Σ: ${formatPaise(rec.parsedSumPaise)}`);
  console.log(`  ${rec.detail}`);
  for (const w of r.warnings) console.log(`  warn: ${w}`);
  for (const t of r.transactions.slice(0, 3)) {
    console.log(`    ${t.txnDate}  ${formatPaise(t.amountPaise).padStart(14)}  ${t.descriptionRaw.slice(0, 60)}`);
  }
}

console.log("=".repeat(78));
console.log("WEALTH-OS PARSER VERIFICATION — real fixtures, hard reconciliation gates");
console.log("=".repeat(78));

// ---- SBI ----
const sbi = parseSbi(F("AccountStatement_27052026_133757.md"));
report(sbi);

// ---- IDFC Bank ----
const idfc = parseIdfcBank(F("IDFC_BANK_STATEMENT-2026-05-27.md"));
report(idfc);

// ---- Federal ----
const fedAll = parseFederal(F("Federalbank-2026-05-27.md"));
for (const r of fedAll) report(r);

// ---- IDFC CC (multi-statement) ----
const idfcCcAll = parseIdfcCc(F("IDFC_CC-2026-05-27.md"));
for (const r of idfcCcAll) report(r);

// ---- Suryoday CC (multi-statement) ----
const suryAll = parseSuryodayCc(F("Surodyay_CC-2026-05-27.md"));
for (const r of suryAll) report(r);

// ---- Expected-count gates: silence is failure ----
console.log("\n" + "-".repeat(78));
const expectCounts: Array<[string, number, number]> = [
  ["SBI txns", sbi.transactions.length, 183],
  ["IDFC bank txns", idfc.transactions.length, 34],
  ["Federal statements", fedAll.length, 12],
  ["IDFC CC statements", idfcCcAll.length, 10],
  ["Suryoday statements", suryAll.length, 6],
];
for (const [label, got, want] of expectCounts) {
  const ok = got === want;
  if (!ok) failures++;
  console.log(`COUNT ${ok ? "PASS" : "FAIL"}: ${label} = ${got} (expected ${want})`);
}

// ---- Idempotency proof: re-parse + union by hash must add zero rows ----
console.log("\n" + "-".repeat(78));
const all = [sbi, idfc, ...fedAll, ...idfcCcAll, ...suryAll];
const hashSet = new Set<string>();
let dupWithin = 0;
for (const r of all) for (const t of r.transactions) {
  if (hashSet.has(t.contentHash)) dupWithin++;
  hashSet.add(t.contentHash);
}
const second = [parseSbi(F("AccountStatement_27052026_133757.md")), parseIdfcBank(F("IDFC_BANK_STATEMENT-2026-05-27.md"))];
let reimportInserts = 0;
for (const r of second) for (const t of r.transactions) if (!hashSet.has(t.contentHash)) reimportInserts++;
console.log(`DEDUP: ${hashSet.size} unique txns; cross-statement hash collisions: ${dupWithin}; re-import inserts: ${reimportInserts} ${reimportInserts === 0 ? "(PASS — idempotent)" : "(FAIL)"}`);
if (reimportInserts > 0 || dupWithin > 0) failures++;

// ---- BHIM UPI enrichment ----
const upi = parseBhimUpi(F("TransactionHistory_1781297699.html"));
const banks = new Map<string, number>();
for (const r of upi.rows) banks.set(r.bankName, (banks.get(r.bankName) ?? 0) + 1);
console.log(`\nBHIM UPI: ${upi.rows.length} SUCCESS rows (${upi.skipped} non-success skipped)`);
for (const [b, n] of banks) console.log(`  ${n.toString().padStart(4)}  ${b}`);

// enrichment match-rate against IDFC bank txns (same date+amount)
const idfcKey = new Set(idfc.transactions.map((t) => `${t.txnDate}|${Math.abs(t.amountPaise)}`));
const matched = upi.rows.filter((r) => r.bankName.includes("IDFC") && idfcKey.has(`${r.txnDate}|${Math.abs(r.amountPaise)}`)).length;
const idfcUpiRows = upi.rows.filter((r) => r.bankName.includes("IDFC") && r.txnDate >= (idfc.periodStart ?? "") && r.txnDate <= (idfc.periodEnd ?? "")).length;
console.log(`  enrichment match-rate vs IDFC bank statement period: ${matched}/${idfcUpiRows} UPI rows matched by (date, amount)`);

// ---- Zerodha ----
const z = parseZerodhaHoldings(readFileSync("fixtures/holdingsVUZ281.xlsx"));
console.log(`\nZERODHA: ${z.rows.length} holdings (as of ${z.asOf ?? "unknown"})  invested ${z.investedPaise !== null ? formatPaise(z.investedPaise) : "?"}  present ${z.presentPaise !== null ? formatPaise(z.presentPaise) : "?"}  reconcile: ${z.reconciliationOk ? "PASS" : "FAIL"}`);
if (!z.reconciliationOk) { failures++; for (const w of z.warnings) console.log(`  warn: ${w}`); }
for (const r of z.rows) console.log(`  ${r.assetClass.padEnd(12)} ${r.symbol.padEnd(28).slice(0, 28)} ${r.isin}  qty ${r.qty}`);

// ---- Taxonomy + rule engine ----
const taxonomy = loadTaxonomy(readFileSync("supabase/seed/taxonomy_master_from_sure.csv", "utf8"));
const parents = [...taxonomy.values()].filter((c) => !c.parent).length;
console.log(`\nTAXONOMY: ${taxonomy.size} names (${parents} parents, ${taxonomy.size - parents} leaves)`);
const rules = loadRules(readFileSync("supabase/seed/vendor_to_category_starter.yaml", "utf8"), taxonomy);
console.log(`RULES: ${rules.length} loaded — all categories validated, Leakage/Review guards enforced at load`);

const everyTxn = all.flatMap((r) => r.transactions);
let hit = 0; const catCount = new Map<string, number>(); const ruleHits = new Map<number, number>();
for (const t of everyTxn) {
  const { category, ruleIndex } = categorize(t.descriptionRaw, rules);
  if (ruleIndex !== null) { hit++; ruleHits.set(ruleIndex, (ruleHits.get(ruleIndex) ?? 0) + 1); }
  catCount.set(category, (catCount.get(category) ?? 0) + 1);
}
console.log(`AUTO-CATEGORIZATION: ${hit}/${everyTxn.length} matched a rule; ${catCount.get(FALLBACK_CATEGORY) ?? 0} → ${FALLBACK_CATEGORY}`);
const topRules = [...ruleHits.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
for (const [i, n] of topRules) console.log(`  ${n.toString().padStart(4)}×  "${rules[i].match}" → ${rules[i].category}`);

// ---- Halan bucket math: synthetic, hard-asserted ----
console.log("\n" + "-".repeat(78));
import { bucketTotals, monthlyCashFlow, leakageByParent, accountBalances, classifyParent } from "../src/lib/halan.js";
const synth = [
  { txnDate: "2026-03-05", amountPaise: 18500000, parent: "01 Income", tags: [] as string[] },             // salary +185000
  { txnDate: "2026-03-06", amountPaise: -120000, parent: "03 Spend-it Wants", tags: ["leakage"] },          // impulse, tagged
  { txnDate: "2026-03-07", amountPaise: -450000, parent: "02 Spend-it Needs", tags: [] },                   // groceries
  { txnDate: "2026-03-10", amountPaise: -5000000, parent: "08 Invest-it", tags: [] },                       // SIP
  { txnDate: "2026-03-12", amountPaise: -2000000, parent: "10 Transfers & Adjustments", tags: [] },         // own-account transfer (excluded)
  { txnDate: "2026-04-02", amountPaise: -80000, parent: "03 Spend-it Wants", tags: ["leakage"] },           // impulse next month
  { txnDate: "2026-04-03", amountPaise: -300000, parent: "10 Transfers & Adjustments", tags: [] },          // Uncategorized Review sits here
];
const assert = (label: string, got: number, want: number) => {
  const ok = got === want; if (!ok) failures++;
  console.log(`HALAN ${ok ? "PASS" : "FAIL"}: ${label} = ${got} (expected ${want})`);
};
assert("classify 14→leakage_watch", classifyParent("14 Cash Leakage Watchlist") === "leakage_watch" ? 1 : 0, 1);
const mar = monthlyCashFlow(synth).find((m) => m.month === "2026-03")!;
assert("Mar income", mar.incomePaise, 18500000);
assert("Mar spend (needs+wants, transfers/invest excluded)", mar.spendPaise, 570000);
assert("Mar invest", mar.investPaise, 5000000);
assert("Mar leakage (tag)", mar.leakagePaise, 120000);
const leak = leakageByParent(synth);
assert("total leakage across window", leak.reduce((s, x) => s + x.paise, 0), 200000);
const transferBucket = bucketTotals(synth).find((b) => b.parent === "10 Transfers & Adjustments")!;
assert("transfer bucket excluded from spend but tracked", transferBucket.outflowPaise, 2300000);
const bal = accountBalances(
  [{ id: "a", name: "SBI", kind: "bank", anchorBalancePaise: 1000000, anchorDate: "2026-03-01" }],
  [
    { accountId: "a", txnDate: "2026-02-20", amountPaise: -999999 }, // pre-anchor: ignored
    { accountId: "a", txnDate: "2026-03-05", amountPaise: 18500000 },
    { accountId: "a", txnDate: "2026-03-07", amountPaise: -450000 },
  ],
);
assert("account balance respects anchor date", bal.netWorthPaise, 1000000 + 18500000 - 450000);

// ---- Integrations: LLM status is derived purely from server env-var presence ----
console.log("\n" + "-".repeat(78));
assert("LLM connected when key present", deriveLlmStatus(true) === "connected" ? 1 : 0, 1);
assert("LLM not_connected when key absent", deriveLlmStatus(false) === "not_connected" ? 1 : 0, 1);
assert("anthropic is a known LLM provider (default)", isLlmProvider(DEFAULT_LLM_PROVIDER) ? 1 : 0, 1);
assert("unknown LLM provider rejected", isLlmProvider("totally-made-up") ? 1 : 0, 0);

console.log("\n" + "=".repeat(78));
console.log(failures === 0 ? "ALL GATES PASSED" : `${failures} GATE(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
