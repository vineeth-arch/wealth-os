import { readFileSync } from "node:fs";
import { parseSbi } from "../src/lib/ingest/parsers/sbi.js";
import { parseIdfcBank } from "../src/lib/ingest/parsers/idfc-bank.js";
import { parseFederal } from "../src/lib/ingest/parsers/federal.js";
import { parseIdfcCc } from "../src/lib/ingest/parsers/idfc-cc.js";
import { parseSuryodayCc } from "../src/lib/ingest/parsers/suryoday-cc.js";
import { parseHdfcBank } from "../src/lib/ingest/parsers/hdfc.js";
import { parseHdfcLoanSchedule } from "../src/lib/ingest/parsers/hdfc-loan.js";
import { parseBhimUpi, parseGooglePay, parseZerodhaHoldings } from "../src/lib/ingest/parsers/market.js";
import { parseUpstoxHoldings, parseUpstoxDividends, parseUpstoxTaxReport, excelSerialToISO } from "../src/lib/ingest/parsers/upstox.js";
import { matchEnrichment, mergeMerchant } from "../src/lib/ingest/enrich.js";
import { buildSuggestPrompt } from "../src/lib/llm/prompt.js";
import { buildOpenAiRequestBody, parseOpenAiSuggestions } from "../src/lib/llm/openai.js";
import { breakdownByAccount, topNTransactions, bucketDrill, accountPeriodFlow, type DrillTxn } from "../src/lib/drilldown.js";
import { buildUserCategoryUpdate, isKnownCategory, buildRuleDraft } from "../src/lib/recategorize.js";
import { formatAccountDetails } from "../src/lib/accounts/format.js";
import { loadTaxonomy, loadRules, categorize, FALLBACK_CATEGORY } from "../src/lib/ingest/rules.js";
import { deriveLlmStatus, isLlmProvider, DEFAULT_LLM_PROVIDER, resolveLlmDispatch } from "../src/lib/integrations.js";
import { suggestCategories as geminiSuggest } from "../src/lib/llm/gemini.js";
import { suggestCategories as openaiSuggest } from "../src/lib/llm/openai.js";
import { busyReducer, BUSY_INITIAL, isBusy as busyIsBusy, busyLabel } from "../src/lib/busy.js";
import { SEED_ACCOUNTS } from "../src/lib/seed-data.js";
import { isTxnInstitution } from "../src/lib/ingest/dispatch.js";
import { parseMfapiNav } from "../src/lib/prices/mfapi.js";
import { parseNavAll, parseNavAllForIsinMap } from "../src/lib/prices/amfi.js";
import { selectSourceIds } from "../src/lib/prices/types.js";
import { autoMapHolding, deriveYahooSymbol, needsConfirmation } from "../src/lib/holdings.js";
import { computeRegime, compareRegimes } from "../src/lib/calc/tax.js";
import { amortizationSchedule, emiPaise, totalInterestPaise, prepaymentImpact } from "../src/lib/calc/loan.js";
import { emergencyFund } from "../src/lib/calc/emergency.js";
import { fireCorpus, swpDrawdown } from "../src/lib/calc/retirement.js";
import { pvAnnuity, hlvIncomeReplacement, hlvExpenseLiability } from "../src/lib/calc/hlv.js";
import { sipFutureValue, goalCorpus, requiredMonthlySip } from "../src/lib/calc/sip.js";
import { computeCapitalGainsTax, projectCapitalGainsTax } from "../src/lib/calc/capital-gains.js";
import { formatPaise, normalizeDesc } from "../src/lib/ingest/util.js";
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

// ---- HDFC bank (fixed-width columnar) ----
const hdfc = parseHdfcBank(F("HDFC_statement.md"));
report(hdfc);

// ---- Expected-count gates: silence is failure ----
console.log("\n" + "-".repeat(78));
const expectCounts: Array<[string, number, number]> = [
  ["SBI txns", sbi.transactions.length, 183],
  ["IDFC bank txns", idfc.transactions.length, 34],
  ["Federal statements", fedAll.length, 12],
  ["IDFC CC statements", idfcCcAll.length, 10],
  ["Suryoday statements", suryAll.length, 6],
  ["HDFC txns", hdfc.transactions.length, 325],
];
for (const [label, got, want] of expectCounts) {
  const ok = got === want;
  if (!ok) failures++;
  console.log(`COUNT ${ok ? "PASS" : "FAIL"}: ${label} = ${got} (expected ${want})`);
}

// ---- Idempotency proof: re-parse + union by hash must add zero rows ----
console.log("\n" + "-".repeat(78));
const all = [sbi, idfc, ...fedAll, ...idfcCcAll, ...suryAll, hdfc];
const hashSet = new Set<string>();
let dupWithin = 0;
for (const r of all) for (const t of r.transactions) {
  if (hashSet.has(t.contentHash)) dupWithin++;
  hashSet.add(t.contentHash);
}
const second = [parseSbi(F("AccountStatement_27052026_133757.md")), parseIdfcBank(F("IDFC_BANK_STATEMENT-2026-05-27.md")), parseHdfcBank(F("HDFC_statement.md"))];
let reimportInserts = 0;
for (const r of second) for (const t of r.transactions) if (!hashSet.has(t.contentHash)) reimportInserts++;
console.log(`DEDUP: ${hashSet.size} unique txns; cross-statement hash collisions: ${dupWithin}; re-import inserts: ${reimportInserts} ${reimportInserts === 0 ? "(PASS — idempotent)" : "(FAIL)"}`);
if (reimportInserts > 0 || dupWithin > 0) failures++;

// ---- HDFC bank: hard gates on the fixed-width parse — the fixture is the spec ----
{
  const t0 = hdfc.transactions[0];
  const wrapped = "UPI-AVANI ASHISH MEHTA-AVANIMEHTA1966L@OKHDFCBANK-KKBK0001345-119313909063-CAR LOAN";
  const drCount = hdfc.transactions.filter((t) => t.amountPaise < 0).length;
  const crCount = hdfc.transactions.filter((t) => t.amountPaise > 0).length;
  const sumW = hdfc.transactions.reduce((s, t) => (t.amountPaise < 0 ? s - t.amountPaise : s), 0);
  const sumD = hdfc.transactions.reduce((s, t) => (t.amountPaise > 0 ? s + t.amountPaise : s), 0);
  const salary = hdfc.transactions.find((t) => t.txnDate === "2026-05-29" && t.descriptionRaw === "SALARY MAY 2026");
  const hdfcChecks: Array<[string, boolean]> = [
    [`reconciliation ok (${hdfc.reconciliation.detail})`, hdfc.reconciliation.ok],
    [`Dr count = ${drCount} (expected 283)`, drCount === 283],
    [`Cr count = ${crCount} (expected 42)`, crCount === 42],
    [`Σ withdrawals = ${sumW} (expected 31996148)`, sumW === 31996148],
    [`Σ deposits = ${sumD} (expected 27266816)`, sumD === 27266816],
    [`opening = ${hdfc.reconciliation.openingPaise} (expected 9722086)`, hdfc.reconciliation.openingPaise === 9722086],
    [`closing = ${hdfc.reconciliation.closingPaise} (expected 4992754)`, hdfc.reconciliation.closingPaise === 4992754],
    [`row[0] date = ${t0?.txnDate} (expected 2026-03-01)`, t0?.txnDate === "2026-03-01"],
    [`row[0] amount = ${t0?.amountPaise} (expected +1500000)`, t0?.amountPaise === 1500000],
    [`row[0] closing = ${t0?.balanceAfterPaise} (expected 11222086)`, t0?.balanceAfterPaise === 11222086],
    [`row[0] wrapped narration joined correctly`, t0?.descriptionRaw === wrapped],
    [`salary 29/05/26 SALARY MAY 2026 = +5462900`, salary?.amountPaise === 5462900],
    [`all amounts integer paise`, hdfc.transactions.every((t) => Number.isSafeInteger(t.amountPaise))],
  ];
  for (const [label, ok] of hdfcChecks) { if (!ok) failures++; console.log(`HDFC ${ok ? "PASS" : "FAIL"}: ${label}`); }
}

// ---- HDFC loan repayment schedule: imported actual schedule is the source of truth ----
{
  const sched = parseHdfcLoanSchedule(F("HDFC_loan_Repayment_Schedule.md"));
  const i1 = sched.rows.find((r) => r.instlNo === 1);
  const i48 = sched.rows.find((r) => r.instlNo === 48);
  const loanChecks: Array<[string, boolean]> = [
    [`reconciliation ok (${sched.reconciliation.detail})`, sched.reconciliation.ok],
    [`rows = ${sched.rows.length} (expected 48)`, sched.rows.length === 48],
    [`agreement no = ${sched.agreementNo} (expected 169007392)`, sched.agreementNo === "169007392"],
    [`loan type = ${sched.loanType} (expected PERSONAL LOAN)`, sched.loanType === "PERSONAL LOAN"],
    [`amount financed = ${sched.amountFinancedPaise} (expected 57000000)`, sched.amountFinancedPaise === 57000000],
    [`tenure = ${sched.tenureMonths} (expected 48)`, sched.tenureMonths === 48],
    [`first due = ${sched.firstDueDate} (expected 2026-04-07)`, sched.firstDueDate === "2026-04-07"],
    [`Σprincipal = ${sched.totals.principalPaise} (expected 57000000)`, sched.totals.principalPaise === 57000000],
    [`Σinterest = ${sched.totals.interestPaise} (expected 13835600)`, sched.totals.interestPaise === 13835600],
    [`Σinstl = ${sched.totals.instlPaise} (expected 70835600)`, sched.totals.instlPaise === 70835600],
    [`instl 1 = ${i1?.instlPaise} (expected 1595100 = 950700 + 644400)`, i1?.instlPaise === 1595100 && i1?.principalPaise === 950700 && i1?.interestPaise === 644400],
    [`instl 48 = ${i48?.instlPaise} (expected 1473300), o/s = ${i48?.osPrincipalPaise} (expected 0)`, i48?.instlPaise === 1473300 && i48?.osPrincipalPaise === 0],
  ];
  for (const [label, ok] of loanChecks) { if (!ok) failures++; console.log(`HDFC-LOAN ${ok ? "PASS" : "FAIL"}: ${label}`); }
}

// ---- AI-suggest panel: Description wraps, never truncates (Prompt 09 Pass 1) ----
{
  const panel = readFileSync("src/components/ai-suggest-panel.tsx", "utf8");
  const wraps = panel.includes("{s.sample}") && panel.includes("whitespace-normal break-words");
  const noTruncate = !panel.includes("truncate");
  const checks: Array<[string, boolean]> = [
    ["description cell wraps (whitespace-normal break-words around {s.sample})", wraps],
    ["no `truncate` class remains in the AI-suggest panel", noTruncate],
  ];
  for (const [label, ok] of checks) { if (!ok) failures++; console.log(`AI-SUGGEST ${ok ? "PASS" : "FAIL"}: ${label}`); }
}

// ---- Federal: regression guard — registry + wiring intact, every statement reconciles (Prompt 09 Pass 3) ----
{
  const totalFedTxns = fedAll.reduce((s, r) => s + r.transactions.length, 0);
  const checks: Array<[string, boolean]> = [
    ["12 monthly statements parsed", fedAll.length === 12],
    ["every Federal statement reconciles", fedAll.every((r) => r.reconciliation.ok)],
    [`aggregate parsed txns = ${totalFedTxns} (expected 230)`, totalFedTxns === 230],
  ];
  for (const [label, ok] of checks) { if (!ok) failures++; console.log(`FEDERAL ${ok ? "PASS" : "FAIL"}: ${label}`); }
}

// ---- LLM dispatch: active provider drives the adapter; missing key → clear error, never a silent fallback (Prompt 09 Pass 2) ----
{
  const ADAPTERS = new Set(["gemini", "openai"]);
  const hasAdapter = (p: string) => ADAPTERS.has(p);
  const yes = () => true;
  const no = () => false;
  const openaiActive = [{ provider: "openai", meta: { active: true, model: "gpt-4o" } }, { provider: "gemini", meta: { active: false } }];
  const geminiActive = [{ provider: "gemini", meta: { active: true } }, { provider: "openai", meta: { active: false } }];

  const dOpenaiKey = resolveLlmDispatch(openaiActive, hasAdapter, yes);
  const dOpenaiNoKey = resolveLlmDispatch(openaiActive, hasAdapter, no);
  const dGemini = resolveLlmDispatch(geminiActive, hasAdapter, yes);
  const dNone = resolveLlmDispatch([], hasAdapter, yes);
  const dAnthropic = resolveLlmDispatch([{ provider: "anthropic", meta: { active: true } }], hasAdapter, yes);

  const checks: Array<[string, boolean]> = [
    ["active openai + key → dispatch openai", dOpenaiKey.ok === true && dOpenaiKey.providerId === "openai"],
    ["active openai picks the chosen model gpt-4o", dOpenaiKey.ok === true && dOpenaiKey.model === "gpt-4o"],
    ["active openai + NO key → not ok, providerId stays openai (no gemini fallback)", dOpenaiNoKey.ok === false && dOpenaiNoKey.providerId === "openai"],
    ["openai missing-key reason names OPENAI_API_KEY", dOpenaiNoKey.ok === false && dOpenaiNoKey.reason.includes("OPENAI_API_KEY")],
    ["active gemini + key → dispatch gemini", dGemini.ok === true && dGemini.providerId === "gemini"],
    ["none active → default gemini", dNone.ok === true && dNone.providerId === "gemini"],
    ["active anthropic (no adapter) → not ok", dAnthropic.ok === false && dAnthropic.providerId === "anthropic"],
    ["gemini and openai adapters are distinct functions", (geminiSuggest as unknown) !== (openaiSuggest as unknown)],
  ];
  for (const [label, ok] of checks) { if (!ok) failures++; console.log(`LLM-DISPATCH ${ok ? "PASS" : "FAIL"}: ${label}`); }
}

// ---- Busy store: count-based, never negative (Prompt 10 Pass 1) ----
{
  const s1 = busyReducer(BUSY_INITIAL, { type: "begin", id: 1, label: "Import" });
  const s2 = busyReducer(s1, { type: "begin", id: 2, label: "AI-suggest" });
  const s2end1 = busyReducer(s2, { type: "end", id: 1 });          // two begins, one end → still busy
  const s1end1 = busyReducer(s1, { type: "end", id: 1 });          // back to idle
  const clamp = busyReducer(BUSY_INITIAL, { type: "end", id: 99 }); // end on empty → no-op, never negative
  const checks: Array<[string, boolean]> = [
    ["begin → busy, count 1, label set", busyIsBusy(s1) && s1.ops.length === 1 && busyLabel(s1) === "Import"],
    ["end → idle, count 0", !busyIsBusy(s1end1) && s1end1.ops.length === 0],
    ["two begins then one end → still busy, label = remaining op", busyIsBusy(s2end1) && s2end1.ops.length === 1 && busyLabel(s2end1) === "AI-suggest"],
    ["extra end clamps at 0 (never negative)", !busyIsBusy(clamp) && clamp.ops.length === 0],
    ["idle initial state is not busy", !busyIsBusy(BUSY_INITIAL) && busyLabel(BUSY_INITIAL) === null],
  ];
  for (const [label, ok] of checks) { if (!ok) failures++; console.log(`BUSY ${ok ? "PASS" : "FAIL"}: ${label}`); }
}

// ---- Seed accounts: institution must match what /api/import + holdings require (Prompt 11) ----
{
  const HOLDINGS_BROKERS = new Set(["ZERODHA", "UPSTOX"]);
  for (const a of SEED_ACCOUNTS) {
    let ok: boolean, why: string;
    if (a.kind === "bank" || a.kind === "credit_card") {
      ok = isTxnInstitution(a.institution); // must route through parseStatement()
      why = `${a.name} (${a.kind}) institution=${a.institution} → isTxnInstitution`;
    } else if (a.kind === "broker") {
      ok = HOLDINGS_BROKERS.has(a.institution); // holdings import/commit match on the uppercase enum
      why = `${a.name} (broker) institution=${a.institution} ∈ {ZERODHA,UPSTOX}`;
    } else {
      ok = false; why = `${a.name} has unexpected kind=${a.kind}`;
    }
    if (!ok) failures++;
    console.log(`SEED-ACCOUNTS ${ok ? "PASS" : "FAIL"}: ${why}`);
  }
}

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

// ---- OpenAI adapter (Prompt 05): request carries description-only, JSON parsed, invalid → fallback ----
{
  const desc = "UPI/DR/512282836511/LAZYPAY/AIRP · LazyPay";
  const cats = [{ name: "Food Delivery", parent: "03 Spend-it Wants" }, { name: "Fuel", parent: "02 Spend-it Needs" }];
  const oaPrompt = buildSuggestPrompt([desc], cats);
  const body = buildOpenAiRequestBody(oaPrompt, "gpt-4o-mini");
  const content = body.messages[0]?.content ?? "";
  const allowed = new Set(cats.map((c) => c.name));
  const parsedOk = parseOpenAiSuggestions('{"suggestions":[{"index":0,"category":"Fuel"}]}', allowed);
  const parsedBad = parseOpenAiSuggestions('{"suggestions":[{"index":0,"category":"Bogus Leaf"}]}', allowed);
  const openaiChecks: Array<[string, boolean]> = [
    ["request payload carries only the description prompt (no extra fields)",
      content === oaPrompt && content.includes(desc) && Object.keys(body).sort().join(",") === "messages,model,response_format,temperature"],
    ["payload omits money/date/account fields, temperature deterministic",
      body.temperature === 0 && !/amount|balance|"date"|account|ref_?no/i.test(JSON.stringify({ messages: body.messages }))],
    ["parses a well-formed JSON response into the suggestion shape",
      parsedOk.length === 1 && parsedOk[0].index === 0 && parsedOk[0].category === "Fuel"],
    ["coerces an unknown/invalid category to Uncategorized Review",
      parsedBad.length === 1 && parsedBad[0].category === "Uncategorized Review"],
  ];
  for (const [label, ok] of openaiChecks) { if (!ok) failures++; console.log(`OPENAI ${ok ? "PASS" : "FAIL"}: ${label}`); }
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
  // net = income − spend − invest (no invest rows here, transfers excluded): 20500000 − 1210000 = 19290000
  const netBy = breakdownByAccount(dtxns, "net", "2026-03");
  const netSum = netBy.reduce((s, a) => s + a.subtotalPaise, 0);
  // accountPeriodFlow: A1 in = 18500000 (i1); A1 out = 120000+90000+300000+200000+2000000 (s1,s3,s4,s6,t1) = 2710000
  const apf = accountPeriodFlow(dtxns, "2026-03");
  const a1 = apf.get("A1"); const a2 = apf.get("A2");
  const drillChecks: Array<[string, boolean]> = [
    [`income breakdown sums to headline ₹2,05,000 over 2 accounts = ${incSum}`, incSum === 20500000 && incBy.length === 2],
    [`spend breakdown sums to headline, transfers excluded = ${spendSum}`, spendSum === 1210000],
    [`top-5 capped & ordered by |amount| desc = ${top.map((t) => t.id).join(",")}`, top.length === 5 && top.map((t) => t.id).join(",") === "s2,s4,s6,s1,s3"],
    [`empty month → empty breakdown + empty top-list`, emptyBy.length === 0 && emptyTop.length === 0],
    [`net = income − spend − invest, transfers excluded = ${netSum}`, netSum === 19290000],
    [`accountPeriodFlow A1: in ${a1?.inflowPaise} out ${a1?.outflowPaise} (raw flow, transfers incl)`,
      !!a1 && a1.inflowPaise === 18500000 && a1.outflowPaise === 2710000],
    [`accountPeriodFlow A2: in ${a2?.inflowPaise} out ${a2?.outflowPaise}`,
      !!a2 && a2.inflowPaise === 2000000 && a2.outflowPaise === 500000],
  ];
  for (const [label, ok] of drillChecks) { if (!ok) failures++; console.log(`DRILL ${ok ? "PASS" : "FAIL"}: ${label}`); }
}

// ---- Dashboard bucket drill-down (Pass 2): parent → leaf grouping, pure & gate-checkable ----
{
  const bmk = (over: Partial<DrillTxn>): DrillTxn => ({
    id: "x", txnDate: "2026-03-15", amountPaise: -10000, accountId: "A1", accountName: "SBI",
    descriptionRaw: "d", merchant: "", categoryId: "c", categoryName: "Food Delivery",
    parent: "03 Spend-it Wants", categorySource: "user", tags: [], ...over,
  });
  const bt: DrillTxn[] = [
    bmk({ id: "a", parent: "03 Spend-it Wants", categoryName: "Food Delivery", amountPaise: -120000 }),
    bmk({ id: "b", parent: "03 Spend-it Wants", categoryName: "Food Delivery", amountPaise: -80000 }),
    bmk({ id: "c", parent: "03 Spend-it Wants", categoryName: "Eating Out", amountPaise: -300000 }),
    bmk({ id: "d", parent: "02 Spend-it Needs", categoryName: "Groceries", amountPaise: -450000 }),
    bmk({ id: "e", parent: "03 Spend-it Wants", categoryName: "Food Delivery", amountPaise: 50000 }), // refund inflow: listed, not in outflow
  ];
  const bd = bucketDrill(bt, "03 Spend-it Wants");
  const ids = bd.leaves.flatMap((lf) => lf.txns.map((t) => t.id)).sort().join(",");
  const leafSum = bd.leaves.reduce((s, lf) => s + lf.outflowPaise, 0);
  const leafNetSum = bd.leaves.reduce((s, lf) => s + lf.netPaise, 0);
  const fd = bd.leaves.find((lf) => lf.categoryName === "Food Delivery");
  const bucketChecks: Array<[string, boolean]> = [
    [`returns exactly the parent's txns (a,b,c,e — not d) = ${ids}`, ids === "a,b,c,e"],
    [`leaf subtotals sum to the bucket total = ${leafSum}`, leafSum === bd.totalPaise && bd.totalPaise === 500000],
    [`leaf groups by category; inflow excluded from outflow (Food Delivery = ₹2,000 over 3 rows)`, !!fd && fd.outflowPaise === 200000 && fd.count === 3],
    [`inflow tracked + net = inflow − outflow (in ${bd.inflowPaise}, out ${bd.outflowPaise}, net ${bd.netPaise})`,
      bd.inflowPaise === 50000 && bd.netPaise === -450000 && leafNetSum === bd.netPaise],
    [`Food Delivery net folds the refund (in 50000 − out 200000 = ${fd?.netPaise})`, !!fd && fd.inflowPaise === 50000 && fd.netPaise === -150000],
  ];
  for (const [label, ok] of bucketChecks) { if (!ok) failures++; console.log(`BUCKET ${ok ? "PASS" : "FAIL"}: ${label}`); }
}

// ---- Inline re-categorize + add-as-rule (Pass 3): pure payload/guard shapes, gate-checkable ----
{
  const upd = buildUserCategoryUpdate("cat-123");
  const validIds = new Set(["cat-123", "cat-456"]);
  const draft = buildRuleDraft(normalizeDesc("UPI/DR/512282836511/ZOMATO  Zomato"), "cat-123"); // collapse + uppercase
  const recatChecks: Array<[string, boolean]> = [
    [`re-categorize writes category_source='user'`, upd.category_source === "user" && upd.category_id === "cat-123"],
    [`known category accepted; non-taxonomy + empty rejected`,
      isKnownCategory("cat-123", validIds) && !isKnownCategory("cat-999", validIds) && !isKnownCategory("", validIds)],
    [`add-as-rule row shape {match_text(normalized), category_id, active} = "${draft.match_text}"`,
      draft.match_text === "UPI/DR/512282836511/ZOMATO ZOMATO" && draft.category_id === "cat-123" && draft.active === true],
  ];
  for (const [label, ok] of recatChecks) { if (!ok) failures++; console.log(`RECAT ${ok ? "PASS" : "FAIL"}: ${label}`); }
}

// ---- Account details: migration columns + copy-block formatter (Pass 1), pure & gate-checkable ----
{
  const mig = readFileSync("supabase/migrations/0002_account_details.sql", "utf8");
  const cols = ["account_holder_name", "account_number", "ifsc", "branch", "account_type", "upi_id"];

  const full = formatAccountDetails({
    accountHolderName: "Vineeth Nair", institution: "SBI", accountType: "Savings",
    accountNumber: "1234567890", ifsc: "SBIN0001234", branch: "MG Road", upiId: "vineeth@oksbi",
  });
  const fullExpected = ["Vineeth Nair", "State Bank of India · Savings", "A/c No: 1234567890", "IFSC: SBIN0001234", "Branch: MG Road", "UPI: vineeth@oksbi"].join("\n");

  const partial = formatAccountDetails({ accountHolderName: "Vineeth Nair", accountNumber: "1234567890", ifsc: "SBIN0001234" });
  const partialLines = partial.split("\n");
  const partialOk = partial === "Vineeth Nair\nA/c No: 1234567890\nIFSC: SBIN0001234"
    && partialLines.length === 3 && !partial.includes("·") && !partialLines.some((l) => l.trim() === "");

  const acctChecks: Array<[string, boolean]> = [
    [`migration 0002 declares all 6 columns`, cols.every((c) => mig.includes(c))],
    [`fully-populated account → expected lines in order`, full === fullExpected],
    [`{holder, number, ifsc} only → exactly 3 lines, no blanks, no "·"`, partialOk],
    [`empty account → ""`, formatAccountDetails({}) === ""],
  ];
  for (const [label, ok] of acctChecks) { if (!ok) failures++; console.log(`ACCT ${ok ? "PASS" : "FAIL"}: ${label}`); }
}

// ---- Zerodha ----
const z = parseZerodhaHoldings(readFileSync("fixtures/holdingsVUZ281.xlsx"));
console.log(`\nZERODHA: ${z.rows.length} holdings (as of ${z.asOf ?? "unknown"})  invested ${z.investedPaise !== null ? formatPaise(z.investedPaise) : "?"}  present ${z.presentPaise !== null ? formatPaise(z.presentPaise) : "?"}  reconcile: ${z.reconciliationOk ? "PASS" : "FAIL"}`);
if (!z.reconciliationOk) { failures++; for (const w of z.warnings) console.log(`  warn: ${w}`); }
for (const r of z.rows) console.log(`  ${r.assetClass.padEnd(12)} ${r.symbol.padEnd(28).slice(0, 28)} ${r.isin}  qty ${r.qty}`);

// ---- Upstox holdings ----
{
  const u = parseUpstoxHoldings(readFileSync("fixtures/holdings_13062026_GE6088.xlsx"));
  console.log(`\nUPSTOX HOLDINGS: ${u.rows.length} holdings (as of ${u.asOf ?? "unknown"})  present ${u.presentPaise !== null ? formatPaise(u.presentPaise) : "?"}  reconcile: ${u.reconciliationOk ? "PASS" : "FAIL"}`);
  const eternal = u.rows.find((r) => r.isin === "INE758T01015");
  const allInt = u.rows.every((r) => Number.isInteger(r.lastPricePaise) && (r.avgPricePaise === null || Number.isInteger(r.avgPricePaise)));
  const checks: Array<[string, boolean]> = [
    [`rows = ${u.rows.length} (expected 16)`, u.rows.length === 16],
    [`reconciles (Σ valuation = Σ qty×rate)`, u.reconciliationOk],
    [`asOf = ${u.asOf} (expected 2026-06-12)`, u.asOf === "2026-06-12"],
    [`ETERNAL qty = ${eternal?.qty} (expected 85)`, eternal?.qty === 85],
    [`ETERNAL value = ${eternal ? eternal.qty * eternal.lastPricePaise : "?"} paise (expected 2072300)`, !!eternal && eternal.qty * eternal.lastPricePaise === 2072300],
    [`cost basis null for all (Upstox file has none)`, u.rows.every((r) => r.avgPricePaise === null)],
    [`money is integer paise`, allInt],
    [`no preamble/footer/TOTAL leaked (every row a valid ISIN)`, u.rows.every((r) => /^IN[A-Z0-9]{10}$/.test(r.isin))],
  ];
  for (const [label, ok] of checks) { if (!ok) failures++; console.log(`UPSTOX-HOLD ${ok ? "PASS" : "FAIL"}: ${label}`); }
}

// ---- Taxonomy + rule engine ----
const taxonomy = loadTaxonomy(readFileSync("supabase/seed/taxonomy_master_from_sure.csv", "utf8"));
const parents = [...taxonomy.values()].filter((c) => !c.parent).length;
console.log(`\nTAXONOMY: ${taxonomy.size} names (${parents} parents, ${taxonomy.size - parents} leaves)`);
const rules = loadRules(readFileSync("supabase/seed/vendor_to_category_starter.yaml", "utf8"), taxonomy);
console.log(`RULES: ${rules.length} loaded — all categories validated, Leakage/Review guards enforced at load`);

// ---- Upstox dividends (category resolved from taxonomy, not hardcoded) ----
{
  const d = parseUpstoxDividends(readFileSync("fixtures/Dividend_20250401_To_20260331_GE6088.xlsx"));
  const sum = d.rows.reduce((s, t) => s + t.amountPaise, 0);
  const r0 = d.rows[0];
  const divCat = taxonomy.get("Dividend Income");
  const allInflow = d.rows.every((t) => t.amountPaise > 0 && Number.isInteger(t.amountPaise));
  console.log(`\nUPSTOX DIVIDENDS: ${d.rows.length} events  Σ ${formatPaise(sum)}  stated ${formatPaise(d.totalDividendPaise)}  reconcile: ${d.reconciliationOk ? "PASS" : "FAIL"}  → ${divCat?.name} (parent ${divCat?.parent})`);
  const checks: Array<[string, boolean]> = [
    [`rows = ${d.rows.length} (expected 17)`, d.rows.length === 17],
    [`Σ = ${sum} = stated total ${d.totalDividendPaise} (expected 22295)`, d.reconciliationOk && sum === 22295],
    [`all rows +inflow integer paise`, allInflow],
    [`row[0] date = ${r0?.txnDate} (expected ${excelSerialToISO(45793)})`, r0?.txnDate === excelSerialToISO(45793)],
    [`row[0] amount = ${r0?.amountPaise} (expected 600)`, r0?.amountPaise === 600],
    [`row[0] desc = ${r0?.descriptionRaw}`, r0?.descriptionRaw === "Dividend · IEX · Final"],
    [`category "Dividend Income" exists in taxonomy with parent "01 Income"`, divCat?.parent === "01 Income"],
  ];
  for (const [label, ok] of checks) { if (!ok) failures++; console.log(`UPSTOX-DIV ${ok ? "PASS" : "FAIL"}: ${label}`); }
}

// ---- Upstox tax report (realized capital gains) ----
{
  const t = parseUpstoxTaxReport(readFileSync("fixtures/tax_report_.xlsx"));
  const eq = t.segments.find((s) => s.segment === "equities");
  const empty = t.segments.filter((s) => s.segment !== "equities");
  const allInt = t.segments.every((s) =>
    [s.grossPlPaise, s.netPlPaise, s.chargesPaise, s.shortTermPaise, s.longTermPaise].every(Number.isInteger) &&
    s.lots.every((l) => Number.isInteger(l.totalPlPaise) && Number.isInteger(l.buyAmtPaise) && Number.isInteger(l.sellAmtPaise)));
  console.log(`\nUPSTOX TAX (FY ${t.financialYear}): equities ${eq?.lots.length} lots  gross ${eq ? formatPaise(eq.grossPlPaise) : "?"}  net ${eq ? formatPaise(eq.netPlPaise) : "?"}  charges ${eq ? formatPaise(eq.chargesPaise) : "?"}  reconcile: ${t.reconciliationOk ? "PASS" : "FAIL"}`);
  const checks: Array<[string, boolean]> = [
    [`reconciles (Σ lotPL = gross, net = gross−charges, = Summary)`, t.reconciliationOk],
    [`financial year = ${t.financialYear} (expected 2526)`, t.financialYear === "2526"],
    [`equities closed lots = ${eq?.lots.length} (expected 2)`, eq?.lots.length === 2],
    [`equities gross = ${eq?.grossPlPaise} (expected 5565)`, eq?.grossPlPaise === 5565],
    [`equities short-term = ${eq?.shortTermPaise} (expected 0)`, eq?.shortTermPaise === 0],
    [`equities long-term = ${eq?.longTermPaise} (expected 5565)`, eq?.longTermPaise === 5565],
    [`equities charges = ${eq?.chargesPaise} (expected 3391)`, eq?.chargesPaise === 3391],
    [`equities net = ${eq?.netPlPaise} (expected 2174 = 5565−3391)`, eq?.netPlPaise === 2174],
    [`Σ lot PL = ${eq?.lots.reduce((s, l) => s + l.totalPlPaise, 0)} (expected 5565)`, (eq?.lots.reduce((s, l) => s + l.totalPlPaise, 0) ?? -1) === 5565],
    [`lot[0] buy/sell dates ISO`, !!eq && eq.lots[0].buyDate === excelSerialToISO(44631) && eq.lots[0].sellDate === excelSerialToISO(46007)],
    [`F&O/Commodities/Currencies empty (0 lots each)`, empty.every((s) => s.lots.length === 0)],
    [`all money integer paise`, allInt],
  ];
  for (const [label, ok] of checks) { if (!ok) failures++; console.log(`UPSTOX-TAX ${ok ? "PASS" : "FAIL"}: ${label}`); }
}

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

// ---- Loan amortization + prepayment (Pass 1): reducing-balance EMI, paise-exact closure ----
console.log("\n" + "-".repeat(78));
// ₹10,00,000 @ 9% p.a. over 120 months. EMI = P·r·(1+r)^n/((1+r)^n−1), r=0.0075 → ₹12,667.58.
const loan10L = { principalPaise: 1_000_000 * P, annualRatePct: 9, tenureMonths: 120 };
assert("EMI ₹10L @ 9% / 120mo = ₹12,667.58", emiPaise(loan10L), 1_266_758);
const sched = amortizationSchedule(loan10L);
assert("schedule length = tenure", sched.length, 120);
assert("closing balance ends exactly 0", sched[sched.length - 1].closingBalancePaise, 0);
assert("Σ principal = principal", sched.reduce((s, x) => s + x.principalPaise, 0), 1_000_000 * P);
// Zero-rate loan amortizes linearly and still closes to 0.
const zero = amortizationSchedule({ principalPaise: 1_200_000 * P, annualRatePct: 0, tenureMonths: 12 });
assert("zero-rate EMI = P/n", zero[0].emiPaise, 100_000 * P);
assert("zero-rate closes to 0", zero[zero.length - 1].closingBalancePaise, 0);
assert("zero-rate has no interest", totalInterestPaise(zero), 0);

const baseInterest = totalInterestPaise(sched);
// ₹2,00,000 prepayment after month 24, reduce-tenure: keeps EMI, shortens loan, saves interest.
const rt = prepaymentImpact({ ...loan10L, prepaymentPaise: 200_000 * P, atMonth: 24, mode: "reduce_tenure" });
assert("reduce_tenure saves interest (>0)", rt.interestSavedPaise > 0 && rt.interestSavedPaise < baseInterest ? 1 : 0, 1);
assert("reduce_tenure shortens loan (monthsSaved>0)", rt.monthsSaved > 0 ? 1 : 0, 1);
assert("reduce_tenure reports newTenure < 120", (rt.newTenureMonths ?? 120) < 120 ? 1 : 0, 1);
// Same prepayment, reduce-EMI: keeps tenure, lowers EMI, monthsSaved = 0.
const re = prepaymentImpact({ ...loan10L, prepaymentPaise: 200_000 * P, atMonth: 24, mode: "reduce_emi" });
assert("reduce_emi keeps tenure (monthsSaved=0)", re.monthsSaved, 0);
assert("reduce_emi lowers EMI below base", (re.newEmiPaise ?? Infinity) < 1_266_758 ? 1 : 0, 1);
assert("reduce_emi also saves interest (>0)", re.interestSavedPaise > 0 ? 1 : 0, 1);
// The two modes differ: reduce_tenure saves more interest than reduce_emi for the same lump sum.
assert("reduce_tenure saves more than reduce_emi", rt.interestSavedPaise > re.interestSavedPaise ? 1 : 0, 1);

// ---- Emergency-fund sizing (Pass 2): months × needs, gap vs current liquid ----
console.log("\n" + "-".repeat(78));
// ₹60,000/mo needs, ₹3,00,000 liquid → 6mo target ₹3.6L (gap ₹60k), 9mo ₹5.4L, 12mo ₹7.2L.
const ef = emergencyFund({ monthlyNeedsPaise: 60_000 * P, currentLiquidPaise: 300_000 * P });
assert("EF 6-month target", ef.targets[0].targetPaise, 360_000 * P);
assert("EF 6-month gap (target − liquid)", ef.targets[0].gapPaise, 60_000 * P);
assert("EF 12-month target", ef.targets[2].targetPaise, 720_000 * P);
// Over-funded clamps the gap at 0.
const efFull = emergencyFund({ monthlyNeedsPaise: 50_000 * P, currentLiquidPaise: 900_000 * P });
assert("EF gap clamps at 0 when over-funded", efFull.targets[0].gapPaise, 0);

// ---- Retirement / FIRE corpus + SWP drawdown (Pass 3) ----
console.log("\n" + "-".repeat(78));
// ₹6,00,000/yr today, 6% inflation, 20 yrs, 4% SWR → future expense ₹19,24,281.28 → corpus ₹4,81,07,032.
const fire = fireCorpus({ annualExpensePaise: 600_000 * P, inflationPct: 6, yearsToRetire: 20, swrPct: 4, currentCorpusPaise: 4_810_703_200 });
assert("FIRE future annual expense", fire.futureAnnualExpensePaise, 192_428_128);
assert("FIRE target corpus (expense / SWR)", fire.targetCorpusPaise, 4_810_703_200);
assert("FIRE freedom ratio = 1 when current = target", Math.round(fire.freedomRatio * 1000), 1000);
// Flat SWP: ₹10L corpus, ₹1L/yr, 0% return, 0% inflation → lasts exactly 10 years, depletes in year 10.
const swpFlat = swpDrawdown({ corpusPaise: 1_000_000 * P, annualWithdrawalPaise: 100_000 * P, nominalReturnPct: 0, inflationPct: 0, years: 30 });
assert("SWP flat depletes in year 10", swpFlat.depletedYear ?? 0, 10);
assert("SWP flat years lasted = 10", swpFlat.yearsLasted, 10);
// Return above withdrawal rate → corpus survives the horizon (no depletion).
const swpLasts = swpDrawdown({ corpusPaise: 5_000_000 * P, annualWithdrawalPaise: 100_000 * P, nominalReturnPct: 8, inflationPct: 5, years: 30 });
assert("SWP with growth survives 30 yrs", swpLasts.depletedYear === null ? 1 : 0, 1);

// ---- Human Life Value (Pass 4): income-replacement + expense/liabilities ----
console.log("\n" + "-".repeat(78));
// Zero-discount annuity is just amount × years.
assert("pvAnnuity 0% = amount × years", pvAnnuity(700_000 * P, 0, 20), 1_400_000_000);
// Income-replacement: ₹10L income, 30% own consumption (net ₹7L), 20 yrs.
const irFlat = hlvIncomeReplacement({ annualIncomePaise: 1_000_000 * P, ownConsumptionPct: 30, workingYears: 20, discountRatePct: 0 });
assert("HLV income-replacement (0% discount) = ₹14Cr", irFlat.needPaise, 1_400_000_000);
const ir8 = hlvIncomeReplacement({ annualIncomePaise: 1_000_000 * P, ownConsumptionPct: 30, workingYears: 20, discountRatePct: 8, existingCoverPaise: 200_000_000 });
assert("HLV income-replacement (8% discount)", ir8.needPaise, 687_270_319);
assert("HLV gap = need − existing cover", ir8.gapPaise, 687_270_319 - 200_000_000);
// Expense + liabilities: PV(₹6L × 25yr @0%) ₹1.5Cr + ₹50L liabilities − ₹30L assets = ₹1.7Cr.
const el = hlvExpenseLiability({ annualExpensePaise: 600_000 * P, yearsToCover: 25, discountRatePct: 0, outstandingLiabilitiesPaise: 5_000_000 * P, existingAssetsPaise: 3_000_000 * P, existingCoverPaise: 5_000_000 * P });
assert("HLV expense+liabilities need", el.needPaise, 1_700_000_000);
assert("HLV expense+liabilities gap", el.gapPaise, 1_700_000_000 - 500_000_000);

// ---- SIP / step-up + goal corpus (Pass 5) ----
console.log("\n" + "-".repeat(78));
// ₹10,000/mo, 12% p.a., 120 months, annuity-due closed form → FV ₹23,23,390.76.
assert("SIP plain FV (₹10k, 12%, 120mo)", sipFutureValue({ monthlyPaise: 10_000 * P, annualReturnPct: 12, months: 120, stepUpPct: 0 }), 232_339_076);
// 10% annual step-up grows the same starting SIP to a larger FV.
const stepFv = sipFutureValue({ monthlyPaise: 10_000 * P, annualReturnPct: 12, months: 120, stepUpPct: 10 });
assert("SIP step-up FV (10%) exceeds plain", stepFv > 232_339_076 ? 1 : 0, 1);
assert("SIP step-up FV value", stepFv, 337_432_626);
// Zero-return SIP is just the sum of contributions.
assert("SIP 0% return = months × monthly", sipFutureValue({ monthlyPaise: 5_000 * P, annualReturnPct: 0, months: 24, stepUpPct: 0 }), 5_000 * P * 24);
// Goal corpus: ₹25L today, 8% inflation, 15 yrs → ₹79,30,422.79.
assert("goal corpus (₹25L, 8%, 15yr)", goalCorpus({ targetTodayPaise: 2_500_000 * P, inflationPct: 8, years: 15 }), 793_042_279);
// requiredMonthlySip inverts sipFutureValue: investing it reaches (and just covers) the target.
const target = 793_042_279;
const req = requiredMonthlySip({ targetPaise: target, annualReturnPct: 11, months: 180, stepUpPct: 10 });
const reached = sipFutureValue({ monthlyPaise: req, annualReturnPct: 11, months: 180, stepUpPct: 10 });
assert("required SIP reaches the target", reached >= target ? 1 : 0, 1);
assert("required SIP not wildly over (within one month's SIP)", reached - target < req ? 1 : 0, 1);

// ---- Capital-gains tax (Pass 6): reads the parsed realized-gains segments, equity ST/LT split ----
console.log("\n" + "-".repeat(78));
// Equity: ST ₹2,00,000 @20% = ₹40,000; LT ₹3,00,000 − ₹1.25L exemption = ₹1,75,000 @12.5% = ₹21,875.
const cgSegs = [
  { segment: "equities", shortTermPaise: 200_000 * P, longTermPaise: 300_000 * P },
  { segment: "fo", shortTermPaise: 50_000 * P, longTermPaise: 0 }, // business income — not taxed here
];
const cg = computeCapitalGainsTax(cgSegs);
assert("equity STCG tax (20%)", cg.stcgTaxPaise, 40_000 * P);
assert("LTCG exemption used (₹1.25L)", cg.ltcgExemptionUsedPaise, 125_000 * P);
assert("LTCG taxable after exemption", cg.ltcgTaxablePaise, 175_000 * P);
assert("equity LTCG tax (12.5%)", cg.ltcgTaxPaise, 2_187_500);
assert("total CG tax", cg.totalTaxPaise, 40_000 * P + 2_187_500);
assert("non-equity ST surfaced separately, untaxed here", cg.otherStcgPaise, 50_000 * P);
// LT below the exemption → no LTCG tax, whole amount sheltered.
const cgSmall = computeCapitalGainsTax([{ segment: "equities", shortTermPaise: 0, longTermPaise: 100_000 * P }]);
assert("LT below exemption → ₹0 tax", cgSmall.ltcgTaxPaise, 0);
assert("LT below exemption → exemption used = LT", cgSmall.ltcgExemptionUsedPaise, 100_000 * P);
// Net loss in a bucket → ₹0 tax there.
assert("net STCG loss → ₹0 tax", computeCapitalGainsTax([{ segment: "equities", shortTermPaise: -50_000 * P, longTermPaise: 0 }]).stcgTaxPaise, 0);
// Projection: 10% growth raises taxable gains, so the projected tax exceeds the current year's.
assert("projection grows tax with positive growth", projectCapitalGainsTax(cgSegs, 10).totalTaxPaise > cg.totalTaxPaise ? 1 : 0, 1);

console.log("\n" + "=".repeat(78));
console.log(failures === 0 ? "ALL GATES PASSED" : `${failures} GATE(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
