import { readFileSync } from "node:fs";
import { parseSbi } from "../src/lib/ingest/parsers/sbi.js";
import { parseIdfcBank } from "../src/lib/ingest/parsers/idfc-bank.js";
import { parseFederal } from "../src/lib/ingest/parsers/federal.js";
import { parseIdfcCc } from "../src/lib/ingest/parsers/idfc-cc.js";
import { parseSuryodayCc } from "../src/lib/ingest/parsers/suryoday-cc.js";
import { parseBhimUpi, parseGooglePay, parseZerodhaHoldings } from "../src/lib/ingest/parsers/market.js";
import { matchEnrichment, mergeMerchant } from "../src/lib/ingest/enrich.js";
import { buildSuggestPrompt } from "../src/lib/llm/prompt.js";
import { breakdownByAccount, topNTransactions, type DrillTxn } from "../src/lib/drilldown.js";
import { loadTaxonomy, loadRules, categorize, FALLBACK_CATEGORY } from "../src/lib/ingest/rules.js";
import { deriveLlmStatus, isLlmProvider, DEFAULT_LLM_PROVIDER } from "../src/lib/integrations.js";
import { parseMfapiNav } from "../src/lib/prices/mfapi.js";
import { parseNavAll, parseNavAllForIsinMap } from "../src/lib/prices/amfi.js";
import { selectSourceIds } from "../src/lib/prices/types.js";
import { autoMapHolding, deriveYahooSymbol, needsConfirmation } from "../src/lib/holdings.js";
import { computeRegime, compareRegimes } from "../src/lib/calc/tax.js";
import { formatPaise } from "../src/lib/ingest/util.js";
import type { StatementParseResult, UpiEnrichmentRow } from "../src/lib/ingest/types.js";

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

// hard gates on the BHIM parse — the fixture is the spec
{
  const r0 = upi.rows[0];
  const bhimChecks: Array<[string, boolean]> = [
    [`rows = ${upi.rows.length} (expected 784)`, upi.rows.length === 784],
    [`skipped = ${upi.skipped} (expected 80)`, upi.skipped === 80],
    [`row[0] date = ${r0?.txnDate} (expected 2026-06-12)`, r0?.txnDate === "2026-06-12"],
    [`row[0] amount = ${r0?.amountPaise} (expected -4500, ₹45 DR → outflow)`, r0?.amountPaise === -4500],
    ["row[0] carries a counterpart name/VPA", !!(r0 && (r0.counterpartyName.trim() || r0.counterpartyVpa.trim()))],
  ];
  for (const [label, ok] of bhimChecks) { if (!ok) failures++; console.log(`BHIM ${ok ? "PASS" : "FAIL"}: ${label}`); }
}

// matcher: a unique (date,amount,sign) hit enriches; a same-date+amount pair is ambiguous, never guessed
{
  const mkRow = (over: Partial<UpiEnrichmentRow>): UpiEnrichmentRow => ({
    txnDate: "2026-03-05", amountPaise: -5000, bankName: "", accountMask: "",
    counterpartyVpa: "", counterpartyName: "", refNo: "", status: "SUCCESS", ...over,
  });
  const accounts = [{ id: "X", name: "IDFC", institution: "IDFC_BANK", kind: "bank" }];
  const uniq = matchEnrichment(
    [mkRow({ amountPaise: -5000, counterpartyName: "ZOMATO" })],
    [{ id: "A", accountId: "X", txnDate: "2026-03-05", amountPaise: -5000 }],
    accounts,
  );
  const okUnique = uniq.matched === 1 && uniq.ambiguous === 0 && uniq.unmatched === 0 &&
    uniq.updates.length === 1 && uniq.updates[0].id === "A" && uniq.updates[0].merchant === "ZOMATO";
  if (!okUnique) failures++;
  console.log(`ENRICH ${okUnique ? "PASS" : "FAIL"}: unique match sets counterparty (A → ZOMATO)`);

  // The write payload may carry ONLY {id, merchant} — never description_raw/clean (immutable narration).
  const keysOk = uniq.updates.length === 1 &&
    JSON.stringify(Object.keys(uniq.updates[0]).sort()) === JSON.stringify(["id", "merchant"]);
  if (!keysOk) failures++;
  console.log(`ENRICH ${keysOk ? "PASS" : "FAIL"}: update payload keys are exactly {id, merchant}`);

  const amb = matchEnrichment(
    [mkRow({ txnDate: "2026-03-06", amountPaise: -8000, counterpartyName: "SOMEVENDOR" })],
    [
      { id: "B", accountId: "X", txnDate: "2026-03-06", amountPaise: -8000 },
      { id: "C", accountId: "X", txnDate: "2026-03-06", amountPaise: -8000 },
    ],
    accounts,
  );
  const okAmb = amb.ambiguous === 1 && amb.matched === 0 && amb.updates.length === 0;
  if (!okAmb) failures++;
  console.log(`ENRICH ${okAmb ? "PASS" : "FAIL"}: same-date+amount pair reported ambiguous (not guessed)`);
}

// mergeMerchant: enrichment LAYERS context, never overwrites or blanks (BHIM then GPay must stack)
{
  const cases: Array<[string, string, string]> = [
    [mergeMerchant(null, "ZOMATO"), "ZOMATO", "null existing → incoming"],
    [mergeMerchant("ZOMATO", "Zomato"), "ZOMATO", "case-insensitive contains → unchanged"],
    [mergeMerchant("ZOMATO", "SWIGGY"), "ZOMATO · SWIGGY", "distinct → appended"],
    [mergeMerchant("ZOMATO", ""), "ZOMATO", "empty incoming → never blanked"],
  ];
  for (const [got, want, label] of cases) {
    const ok = got === want; if (!ok) failures++;
    console.log(`MERGE ${ok ? "PASS" : "FAIL"}: ${label} = "${got}" (expected "${want}")`);
  }
}

// ---- Google Pay enrichment parser (Pass 3) ----
{
  const gpayMd = F("google_pay_sample.md");
  const { rows: gp, warnings: gpw } = parseGooglePay(gpayMd, { currentYear: 2026 }); // fixed year → deterministic gate
  const startLines = (gpayMd.match(/^(Paid|Sent|Received) ₹/gm) ?? []).length;
  const named = gp.filter((r) => r.counterpartyName !== "").length;
  const masks = new Set(gp.map((r) => r.accountMask).filter(Boolean));
  const dates = gp.map((r) => r.txnDate).sort();
  const headerWarns = gpw.filter((w) => w.startsWith("unparseable date header")).length;
  const gpayChecks: Array<[string, boolean]> = [
    [`rows = ${gp.length} (expected 200)`, gp.length === 200],
    [`parse-completeness: rows == ${startLines} activity lines`, gp.length === startLines],
    [`named = ${named} (expected 143)`, named === 143],
    [`distinct masks = ${masks.size} (expected 3: ...7358, ...0498, 653018...61)`,
      masks.size === 3 && masks.has("XXXXXX7358") && masks.has("XXXXXXXXXX0498") && masks.has("653018XXXXXXXX61")],
    [`date range ${dates[0]} → ${dates[dates.length - 1]} (expected 2024-12-30 → 2026-06-07)`,
      dates[0] === "2024-12-30" && dates[dates.length - 1] === "2026-06-07"],
    [`unparseable date headers = ${headerWarns} (expected 0 — proves "Sept" handled)`, headerWarns === 0],
  ];
  for (const [label, ok] of gpayChecks) { if (!ok) failures++; console.log(`GPAY ${ok ? "PASS" : "FAIL"}: ${label}`); }
}

// ---- AI suggest prompt (Pass 3): bucket-grouped taxonomy + India few-shot, pure & gate-checkable ----
{
  const prompt = buildSuggestPrompt(
    ["UPI/DR/512282836511/LAZYPAY/AIRP · LazyPay"],
    [{ name: "Food Delivery", parent: "03 Spend-it Wants" }, { name: "Fuel", parent: "02 Spend-it Needs" }],
  );
  const promptChecks: Array<[string, boolean]> = [
    ["groups each leaf under its parent bucket", prompt.includes("03 Spend-it Wants:") && prompt.includes("- Food Delivery")],
    ["carries India-specific few-shot examples", prompt.includes("Examples:") && prompt.includes("BNPL Payment")],
    ["instructs bucket-first + Uncategorized Review fallback", prompt.includes("bucket-first") && prompt.includes("Uncategorized Review")],
  ];
  for (const [label, ok] of promptChecks) { if (!ok) failures++; console.log(`PROMPT ${ok ? "PASS" : "FAIL"}: ${label}`); }
}

// ---- Dashboard drill-down aggregation (Pass 1): breakdown-by-account + top-N, pure & gate-checkable ----
{
  const dmk = (over: Partial<DrillTxn>): DrillTxn => ({
    id: "x", txnDate: "2026-03-15", amountPaise: -10000, accountId: "A1", accountName: "SBI",
    descriptionRaw: "d", merchant: "", categoryId: "c", categoryName: "Groceries",
    parent: "02 Spend-it Needs", categorySource: "user", tags: [], ...over,
  });
  const dtxns: DrillTxn[] = [
    dmk({ id: "i1", txnDate: "2026-03-05", amountPaise: 18500000, parent: "01 Income", accountId: "A1", accountName: "SBI" }),
    dmk({ id: "i2", txnDate: "2026-03-20", amountPaise: 2000000, parent: "01 Income", accountId: "A2", accountName: "Federal" }),
    dmk({ id: "s1", txnDate: "2026-03-06", amountPaise: -120000, parent: "03 Spend-it Wants", accountId: "A1", accountName: "SBI" }),
    dmk({ id: "s2", txnDate: "2026-03-07", amountPaise: -450000, parent: "02 Spend-it Needs", accountId: "A2", accountName: "Federal" }),
    dmk({ id: "s3", txnDate: "2026-03-08", amountPaise: -90000, parent: "02 Spend-it Needs", accountId: "A1", accountName: "SBI" }),
    dmk({ id: "s4", txnDate: "2026-03-09", amountPaise: -300000, parent: "03 Spend-it Wants", accountId: "A1", accountName: "SBI" }),
    dmk({ id: "s5", txnDate: "2026-03-10", amountPaise: -50000, parent: "02 Spend-it Needs", accountId: "A2", accountName: "Federal" }),
    dmk({ id: "s6", txnDate: "2026-03-11", amountPaise: -200000, parent: "03 Spend-it Wants", accountId: "A1", accountName: "SBI" }),
    dmk({ id: "t1", txnDate: "2026-03-12", amountPaise: -2000000, parent: "10 Transfers & Adjustments", accountId: "A1", accountName: "SBI" }),
  ];
  const incBy = breakdownByAccount(dtxns, "income", "2026-03");
  const incSum = incBy.reduce((s, a) => s + a.subtotalPaise, 0);
  const spendBy = breakdownByAccount(dtxns, "spend", "2026-03");
  const spendSum = spendBy.reduce((s, a) => s + a.subtotalPaise, 0);
  const top = topNTransactions(dtxns, "spend", "2026-03", 5);
  const emptyBy = breakdownByAccount(dtxns, "income", "2099-01");
  const emptyTop = topNTransactions(dtxns, "income", "2099-01", 5);
  const drillChecks: Array<[string, boolean]> = [
    [`income breakdown sums to headline ₹2,05,000 over 2 accounts = ${incSum}`, incSum === 20500000 && incBy.length === 2],
    [`spend breakdown sums to headline, transfers excluded = ${spendSum}`, spendSum === 1210000],
    [`top-5 capped & ordered by |amount| desc = ${top.map((t) => t.id).join(",")}`, top.length === 5 && top.map((t) => t.id).join(",") === "s2,s4,s6,s1,s3"],
    [`empty month → empty breakdown + empty top-list`, emptyBy.length === 0 && emptyTop.length === 0],
  ];
  for (const [label, ok] of drillChecks) { if (!ok) failures++; console.log(`DRILL ${ok ? "PASS" : "FAIL"}: ${label}`); }
}

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
import { bucketTotals, monthlyCashFlow, leakageByParent, accountBalances, classifyParent, holdingsValue } from "../src/lib/halan.js";
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

// ---- Price layer: pure parse + source selection (no network, no yahoo-finance2 in the gate) ----
console.log("\n" + "-".repeat(78));
const NAVALL_SAMPLE = [
  "Scheme Code;ISIN Div Payout/ISIN Growth;ISIN Div Reinvestment;Scheme Name;Net Asset Value;Date",
  "",
  "Aditya Birla Sun Life Mutual Fund",
  "Open Ended Schemes(Equity Scheme - Large Cap)",
  "120503;INF209KB1ZH9;INF209KB1ZI7;Some Fund - Growth;123.4567;13-Jun-2026",
  "999999;-;-;Bad NAV Fund;N.A.;13-Jun-2026",
].join("\n");
const navMap = parseNavAll(NAVALL_SAMPLE);
assert("AMFI NAV parsed to paise (123.4567 → 12346)", navMap.get("120503")?.navPaise ?? -1, 12346);
assert("AMFI NAV date → ISO", navMap.get("120503")?.date === "2026-06-13" ? 1 : 0, 1);
assert("AMFI skips N.A. NAV rows", navMap.has("999999") ? 1 : 0, 0);
const isinMap = parseNavAllForIsinMap(NAVALL_SAMPLE);
assert("AMFI ISIN→scheme (growth ISIN)", isinMap.get("INF209KB1ZH9")?.schemeCode === "120503" ? 1 : 0, 1);
assert("AMFI ISIN→scheme (reinvestment ISIN)", isinMap.get("INF209KB1ZI7")?.schemeCode === "120503" ? 1 : 0, 1);
const mfapiQuote = parseMfapiNav({ status: "SUCCESS", data: [{ date: "13-06-2026", nav: "123.4567" }] });
assert("mfapi NAV → paise", mfapiQuote?.pricePaise ?? -1, 12346);
assert("mfapi date DD-MM-YYYY → ISO", mfapiQuote?.priceDate === "2026-06-13" ? 1 : 0, 1);
assert("mfapi null on empty payload", parseMfapiNav({ data: [] }) === null ? 1 : 0, 1);
assert("source select: mutual_fund", JSON.stringify(selectSourceIds("mutual_fund")) === JSON.stringify(["mfapi", "amfi", "mfdata"]) ? 1 : 0, 1);
assert("source select: equity → yahoo", JSON.stringify(selectSourceIds("equity")) === JSON.stringify(["yahoo"]) ? 1 : 0, 1);
assert("source select: gold → manual", JSON.stringify(selectSourceIds("gold")) === JSON.stringify(["manual_ibja"]) ? 1 : 0, 1);

// ---- Holdings auto-mapping (Pass D): MF ISIN→scheme, equity symbol→yahoo, unresolved → human ----
console.log("\n" + "-".repeat(78));
const navIsin = new Map([["INF209KB1ZH9", { schemeCode: "120503" }]]);
const mfMap = autoMapHolding({ isin: "INF209KB1ZH9", symbol: "SOMEFUND", assetClass: "mutual_fund" }, navIsin);
assert("MF auto-maps ISIN → AMFI scheme code", mfMap.amfiSchemeCode === "120503" ? 1 : 0, 1);
assert("MF mapped ⇒ no human needed", needsConfirmation("mutual_fund", mfMap) ? 1 : 0, 0);
const mfUnknown = autoMapHolding({ isin: "INF000UNKNOWN", symbol: "X", assetClass: "mutual_fund" }, navIsin);
assert("MF unknown ISIN ⇒ needs human", needsConfirmation("mutual_fund", mfUnknown) ? 1 : 0, 1);
assert("equity symbol → yahoo .NS", deriveYahooSymbol("RELIANCE") === "RELIANCE.NS" ? 1 : 0, 1);
assert("equity explicit .BO preserved", deriveYahooSymbol("500325.BO") === "500325.BO" ? 1 : 0, 1);
const eqMap = autoMapHolding({ isin: "INE002A01018", symbol: "RELIANCE", assetClass: "equity" }, navIsin);
assert("equity auto-maps ⇒ no human", needsConfirmation("equity", eqMap) ? 1 : 0, 0);

// ---- Holdings present value (Pass E): latest price wins, last-known fallback, never blanks ----
console.log("\n" + "-".repeat(78));
const val = holdingsValue(
  [
    { isin: "A", qty: 10, lastPricePaise: 10000, asOf: "2026-06-01" }, // priced below
    { isin: "B", qty: 5, lastPricePaise: 20000, asOf: "2026-06-01" },  // no price → fallback
  ],
  [
    { isin: "A", pricePaise: 11000, priceDate: "2026-06-05" },
    { isin: "A", pricePaise: 12000, priceDate: "2026-06-10" }, // latest for A wins
  ],
);
assert("present value (10×12000 + 5×20000)", val.valuePaise, 10 * 12000 + 5 * 20000);
assert("uses latest price date as as-of", val.asOfDate === "2026-06-10" ? 1 : 0, 1);
assert("priced count", val.pricedCount, 1);
assert("fallback to last-known count", val.fallbackCount, 1);

// ---- Tax regime calculator (Pass F): slabs verified by web search, asserted at build time ----
console.log("\n" + "-".repeat(78));
const P = 100; // paise per rupee
// New regime, ₹12,00,000 taxable → ₹0 (§87A rebate covers the ₹60,000 slab tax).
assert("new regime ₹12L taxable → ₹0", computeRegime(1_200_000 * P, "new").totalTaxPaise, 0);
// Salaried gross ₹12,75,000 → taxable ₹12,00,000 after ₹75k standard deduction → ₹0.
assert("new regime ₹12.75L gross salaried → ₹0", compareRegimes({ grossSalaryPaise: 1_275_000 * P }).new.totalTaxPaise, 0);
// New regime, ₹20,00,000 taxable: 20000+40000+60000+80000 = 200000 tax + 4% cess = 208000.
assert("new regime ₹20L taxable → ₹2,08,000", computeRegime(2_000_000 * P, "new").totalTaxPaise, 208_000 * P);
// Old regime, ₹10,00,000 taxable: 12500 + 100000 = 112500 tax + 4% cess = 117000.
assert("old regime ₹10L taxable → ₹1,17,000", computeRegime(1_000_000 * P, "old").totalTaxPaise, 117_000 * P);

console.log("\n" + "=".repeat(78));
console.log(failures === 0 ? "ALL GATES PASSED" : `${failures} GATE(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
