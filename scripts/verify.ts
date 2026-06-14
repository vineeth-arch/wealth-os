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
import { parseMoneyManager, stripEmojiPrefix } from "../src/lib/ingest/parsers/money-manager.js";
import { parseGooglePayStatement, matchGooglePayStatement, planGooglePayWrites, gpayNoteLine, GPAY_NOTE_PREFIX, type GpayMatch, type GpayTxnState } from "../src/lib/ingest/parsers/google-pay-statement.js";
import { mergeSourceNote } from "../src/lib/ingest/money-manager.js";
import { resolveGpayCategory, gpayTargetCategoryNames, isGpayTransfer } from "../src/lib/ingest/google-pay-category-map.js";
import { matchMoneyManager, DEFAULT_WINDOW_DAYS, planMoneyManagerWrites, mergeMmNote, mmNoteLine, MM_NOTE_PREFIX, type MmMatch, type MmTxnState } from "../src/lib/ingest/money-manager.js";
import { resolveMmCategory, mmTargetCategoryNames, isSpouseTransfer, SPOUSE_TRANSFER_CATEGORY } from "../src/lib/ingest/money-manager-category-map.js";
import { matchEnrichment, mergeMerchant } from "../src/lib/ingest/enrich.js";
import { buildSuggestPrompt } from "../src/lib/llm/prompt.js";
import { buildOpenAiRequestBody, parseOpenAiSuggestions } from "../src/lib/llm/openai.js";
import { breakdownByAccount, topNTransactions, bucketDrill, accountPeriodFlow, type DrillTxn } from "../src/lib/drilldown.js";
import { buildUserCategoryUpdate, isKnownCategory, buildRuleDraft } from "../src/lib/recategorize.js";
import { formatAccountDetails } from "../src/lib/accounts/format.js";
import { loadTaxonomy, loadRules, categorize, FALLBACK_CATEGORY, isForbiddenAutoParent } from "../src/lib/ingest/rules.js";
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
import type { StatementParseResult, UpiEnrichmentRow, MoneyManagerEntry } from "../src/lib/ingest/types.js";

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

// ---- Money Box Compass — proprietor lens engine (Pass 1): one pool, two lenses, category-driven ----
console.log("\n" + "-".repeat(78));
import { lensTotals, computeWindow, reconcile, type CompassTxn, BUSINESS_INCOME_LEAVES, machineH1, machineH2, machineH3, machineH4, machineH5, machineH6Leakage, netWorthSeries, freedomRatio, lifestyleCreep, enjoymentFloor, REFLECTIONS, emptyProfile, worstBand, machineSummary, bandHigher, bandLower } from "../src/lib/compass.js";
{
  const cmk = (over: Partial<CompassTxn>): CompassTxn => ({
    txnDate: "2026-03-15", amountPaise: -10000, parent: "02 Spend-it Needs", categoryName: "Groceries", tags: [], ...over,
  });
  // A proprietor month: design revenue, a work cost, a personal food-delivery spend that happens to sit
  // on a credit card (lens must follow the CATEGORY, not the account), a dividend, a parent-10 transfer.
  const ct: CompassTxn[] = [
    cmk({ txnDate: "2026-03-02", amountPaise: 20000000, parent: "01 Income", categoryName: "Design Project Income" }), // ₹2,00,000 business revenue
    cmk({ txnDate: "2026-03-03", amountPaise: 500000, parent: "01 Income", categoryName: "Dividend Income" }),         // ₹5,000 dividend (other income)
    cmk({ txnDate: "2026-03-05", amountPaise: -1500000, parent: "11 Work & Business", categoryName: "Cloud Hosting" }),// ₹15,000 business cost
    cmk({ txnDate: "2026-03-06", amountPaise: -2000000, parent: "12 Taxes & Compliance", categoryName: "Advance Tax" }),// ₹20,000 tax
    cmk({ txnDate: "2026-03-08", amountPaise: -80000, parent: "03 Spend-it Wants", categoryName: "Food Delivery" }),   // ₹800 personal spend (on a CC — category-driven)
    cmk({ txnDate: "2026-03-09", amountPaise: -450000, parent: "02 Spend-it Needs", categoryName: "Groceries" }),      // ₹4,500 personal spend
    cmk({ txnDate: "2026-03-10", amountPaise: -1200000, parent: "05 Debt & Credit", categoryName: "Home Loan EMI" }),  // ₹12,000 EMI (personal spend + emi ratio)
    cmk({ txnDate: "2026-03-12", amountPaise: -5000000, parent: "08 Invest-it", categoryName: "SIP Mutual Fund" }),    // ₹50,000 invest (savings)
    cmk({ txnDate: "2026-03-13", amountPaise: -300000, parent: "04 Protect", categoryName: "Term Insurance Premium" }),// ₹3,000 protect (savings)
    cmk({ txnDate: "2026-03-15", amountPaise: -8000000, parent: "10 Transfers & Adjustments", categoryName: "Credit Card Bill Payment Transfer" }), // drawing/transfer — neither lens
  ];
  const t = lensTotals(ct);
  const rec = reconcile(t);
  // businessRevenue 200000; businessCosts 15000; profit 185000; tax 20000; profitAfterTax 165000
  // otherIncome = 205000 − 200000 = 5000; personalIncome = 205000 − 15000 − 20000 = 170000
  // personalSpend = 800 + 4500 + 12000 = 17300 (rupees) → paise 1730000; savings = 50000 + 3000 = 53000 → 5300000
  const compassChecks: Array<[string, boolean]> = [
    [`business revenue = ${t.businessRevenue} (expected 20000000)`, t.businessRevenue === 20000000],
    [`dividend is otherIncome, NOT businessRevenue (other ${t.otherIncome})`, t.otherIncome === 500000 && t.businessRevenue === 20000000],
    [`business costs (parent 11) = ${t.businessCosts} (expected 1500000)`, t.businessCosts === 1500000],
    [`tax (parent 12) = ${t.tax} (expected 2000000)`, t.tax === 2000000],
    [`businessProfitAfterTax = ${t.businessProfitAfterTax} (expected 16500000)`, t.businessProfitAfterTax === 16500000],
    [`personalIncome = ${t.personalIncome} (expected 17000000)`, t.personalIncome === 17000000],
    [`personalSpend follows category not account = ${t.personalSpend} (expected 1730000)`, t.personalSpend === 1730000],
    [`EMI (parent 05) tracked for the ratio = ${t.emiOutflow} (expected 1200000)`, t.emiOutflow === 1200000],
    [`personalSavings = invest 08 + protect 04 = ${t.personalSavings} (expected 5300000)`, t.personalSavings === 5300000],
    [`parent-10 transfer touches NEITHER lens (out ${t.transferOutflow}, not in income/spend/savings)`,
      t.transferOutflow === 8000000 && t.personalIncome === 17000000 && t.personalSpend === 1730000 && t.personalSavings === 5300000],
    [`identity personalIncome == businessProfitAfterTax + otherIncome`, rec.identityHolds],
    [`reconciliation closes (no double-count): leftover ${rec.leftoverPaise} == recomputed ${rec.recomputedLeftoverPaise}`, rec.closes],
    [`leftover = personalIncome − spend − savings = ${rec.leftoverPaise} (expected 9970000)`, rec.leftoverPaise === 17000000 - 1730000 - 5300000],
    [`Protect counted ONCE (savings only, not in spend): spend excludes the ₹3,000 premium`, t.personalSpend === 1730000],
    [`all 5 business-income leaves are recognized`, BUSINESS_INCOME_LEAVES.size === 5 && BUSINESS_INCOME_LEAVES.has("Retainer Income")],
  ];
  for (const [label, ok] of compassChecks) { if (!ok) failures++; console.log(`COMPASS ${ok ? "PASS" : "FAIL"}: ${label}`); }

  // Trailing window: spread the same kind of data across 3 months → monthsCovered + averaging.
  const multi: CompassTxn[] = [
    cmk({ txnDate: "2026-01-10", amountPaise: 10000000, parent: "01 Income", categoryName: "Retainer Income" }),
    cmk({ txnDate: "2026-02-10", amountPaise: 10000000, parent: "01 Income", categoryName: "Retainer Income" }),
    cmk({ txnDate: "2026-03-10", amountPaise: 10000000, parent: "01 Income", categoryName: "Retainer Income" }),
    cmk({ txnDate: "2026-03-11", amountPaise: -600000, parent: "02 Spend-it Needs", categoryName: "Groceries" }),
  ];
  const w = computeWindow(multi, 6);
  const winChecks: Array<[string, boolean]> = [
    [`window covers the 3 months present (<6 handled) = ${w.monthsCovered}`, w.monthsCovered === 3 && w.months.join(",") === "2026-01,2026-02,2026-03"],
    [`window totals income = ${w.totals.allIncome} (expected 30000000)`, w.totals.allIncome === 30000000],
    [`per-month average income = ${w.avg.allIncome} (expected 10000000)`, w.avg.allIncome === 10000000],
    [`perMonth series length = months covered`, w.perMonth.length === 3 && w.perMonth[2].personalSpend === 600000],
  ];
  for (const [label, ok] of winChecks) { if (!ok) failures++; console.log(`COMPASS-WINDOW ${ok ? "PASS" : "FAIL"}: ${label}`); }
}

// ---- Compass Machine H1–H3 (Pass 2): R/A/G bands on the proprietor ratios ----
{
  // band helper semantics
  const bandChecks: Array<[string, boolean]> = [
    ["bandHigher: ≥green→green, ≥amber→amber, else red", bandHigher(20, 20, 15) === "green" && bandHigher(15, 20, 15) === "amber" && bandHigher(14, 20, 15) === "red"],
    ["bandLower: ≤green→green, ≤amber→amber, else red", bandLower(25, 25, 30) === "green" && bandLower(30, 25, 30) === "amber" && bandLower(31, 25, 30) === "red"],
  ];
  for (const [label, ok] of bandChecks) { if (!ok) failures++; console.log(`COMPASS-BAND ${ok ? "PASS" : "FAIL"}: ${label}`); }

  // avg per-month proprietor figures: income 1,00,000; savings 25,000 (25%); EMI 20,000 (20%); spend 45,000 (45%)
  const avg = { ...lensTotals([]),
    personalIncome: 10000000, personalSavings: 2500000, investOutflow: 2000000, protectOutflow: 500000,
    emiOutflow: 2000000, personalSpend: 4500000, wantsOutflow: 1000000 };
  const h1 = machineH1(avg);
  // H2: ₹3,00,000 liquid ÷ ₹45,000/mo = 6.67 months → green; target gap to 6mo already met (0)
  const h2 = machineH2(avg, 30000000);
  // H2 red case: only ₹90,000 liquid → 2 months
  const h2red = machineH2(avg, 9000000);
  const machineChecks: Array<[string, boolean]> = [
    [`H1 save rate 25% → green (pct ${h1.saveRate.pct?.toFixed(1)})`, h1.saveRate.band === "green" && Math.round(h1.saveRate.pct ?? 0) === 25],
    [`H1 EMI 20% → green`, h1.emiLoad.band === "green" && Math.round(h1.emiLoad.pct ?? 0) === 20],
    [`H1 living cost 45% → green`, h1.livingCost.band === "green" && Math.round(h1.livingCost.pct ?? 0) === 45],
    [`H1 zero income → null band (categorize first)`, machineH1(lensTotals([])).saveRate.band === null],
    [`H2 6.67 months → green, gap 0`, h2.band === "green" && Math.round((h2.months ?? 0) * 100) === 667 && h2.gapToTargetPaise === 0],
    [`H2 2 months → red, gap = 6×spend − liquid = ${h2red.gapToTargetPaise}`, h2red.band === "red" && h2red.gapToTargetPaise === 6 * 4500000 - 9000000],
    [`H2 no spend → null band`, machineH2(lensTotals([]), 1000000).band === null],
  ];
  for (const [label, ok] of machineChecks) { if (!ok) failures++; console.log(`COMPASS-MACHINE ${ok ? "PASS" : "FAIL"}: ${label}`); }

  // H3 protection presence (parent 04 term/health leaves) → green; none → red
  const pmk = (cat: string): CompassTxn => ({ txnDate: "2026-03-01", amountPaise: -300000, parent: "04 Protect", categoryName: cat, tags: [] });
  const withTerm = machineH3([pmk("Term Insurance Premium")]);
  const withHealth = machineH3([pmk("Health Insurance Premium")]);
  const none = machineH3([{ txnDate: "2026-03-01", amountPaise: -450000, parent: "02 Spend-it Needs", categoryName: "Groceries", tags: [] }]);
  const h3Checks: Array<[string, boolean]> = [
    [`H3 term premium → present + green`, withTerm.termPresent && withTerm.anyPresent && withTerm.band === "green"],
    [`H3 health premium → present + green`, withHealth.healthPresent && withHealth.band === "green"],
    [`H3 no protection outflow → red`, !none.anyPresent && none.band === "red"],
  ];
  for (const [label, ok] of h3Checks) { if (!ok) failures++; console.log(`COMPASS-H3 ${ok ? "PASS" : "FAIL"}: ${label}`); }
}

// ---- Compass Machine H4–H6 (Pass 3): consistency, concentration, leakage + net-worth trend ----
{
  const imk = (month: string, invest: number): CompassTxn[] => ([
    { txnDate: `${month}-05`, amountPaise: 10000000, parent: "01 Income", categoryName: "Retainer Income", tags: [] },
    ...(invest > 0 ? [{ txnDate: `${month}-10`, amountPaise: -invest, parent: "08 Invest-it", categoryName: "SIP Mutual Fund", tags: [] as string[] }] : []),
    { txnDate: `${month}-12`, amountPaise: -100000, parent: "02 Spend-it Needs", categoryName: "Groceries", tags: [] },
  ]);
  // 3 months, invested every month → with green save-rate → green; skipped a month → amber
  const everyMonth = computeWindow([...imk("2026-01", 5000000), ...imk("2026-02", 5000000), ...imk("2026-03", 5000000)], 6);
  const skipped = computeWindow([...imk("2026-01", 5000000), ...imk("2026-02", 0), ...imk("2026-03", 5000000)], 6);
  const never = computeWindow([...imk("2026-01", 0), ...imk("2026-02", 0)], 6);
  const h4green = machineH4(everyMonth, "green");
  const h4amberRegular = machineH4(everyMonth, "amber"); // every month but save-rate not green → amber
  const h4amberSkip = machineH4(skipped, "green");
  const h4red = machineH4(never, "red");
  const h4Checks: Array<[string, boolean]> = [
    [`H4 every month + green save-rate → green (invested ${h4green.monthsInvested}/${h4green.monthsCovered})`, h4green.band === "green" && h4green.skipped === 0],
    [`H4 every month but save-rate amber → amber`, h4amberRegular.band === "amber"],
    [`H4 skipped a month → amber, skipped=1`, h4amberSkip.band === "amber" && h4amberSkip.skipped === 1],
    [`H4 never invested → red`, h4red.band === "red" && h4red.monthsInvested === 0],
  ];
  for (const [label, ok] of h4Checks) { if (!ok) failures++; console.log(`COMPASS-H4 ${ok ? "PASS" : "FAIL"}: ${label}`); }

  // H5 concentration: one holding 60% → red; balanced → green; asset-class split is honest
  const conc = machineH5([
    { name: "BigCo", assetClass: "equity", valuePaise: 6000000 },
    { name: "FundA", assetClass: "mutual_fund", valuePaise: 2000000 },
    { name: "GoldB", assetClass: "gold", valuePaise: 2000000 },
  ]);
  const spread = machineH5([
    { name: "A", assetClass: "equity", valuePaise: 1500000 },
    { name: "B", assetClass: "mutual_fund", valuePaise: 1500000 },
    { name: "C", assetClass: "mutual_fund", valuePaise: 1500000 },
    { name: "D", assetClass: "bond", valuePaise: 1500000 },
    { name: "E", assetClass: "gold", valuePaise: 1500000 },
    { name: "F", assetClass: "cash", valuePaise: 1500000 },
  ]);
  const h5Checks: Array<[string, boolean]> = [
    [`H5 largest 60% → red (top ${conc.top?.name} ${conc.top?.pct.toFixed(0)}%)`, conc.band === "red" && Math.round(conc.top?.pct ?? 0) === 60],
    [`H5 byClass split is honest & sums to 100%`, Math.round(conc.byClass.reduce((s, c) => s + c.pct, 0)) === 100 && conc.byClass.length === 3],
    [`H5 evenly spread (16.7% each) → green`, spread.band === "green" && Math.round(spread.top?.pct ?? 0) === 17],
    [`H5 no holdings → null band`, machineH5([]).band === null],
  ];
  for (const [label, ok] of h5Checks) { if (!ok) failures++; console.log(`COMPASS-H5 ${ok ? "PASS" : "FAIL"}: ${label}`); }

  // H6 leakage: ₹2,000 leaked of ₹40,000 spend = 5% → amber; net-worth trend up → green
  const lk: CompassTxn[] = [
    { txnDate: "2026-03-02", amountPaise: -200000, parent: "03 Spend-it Wants", categoryName: "Food Delivery", tags: ["leakage"] },
    { txnDate: "2026-03-03", amountPaise: -3800000, parent: "02 Spend-it Needs", categoryName: "Groceries", tags: [] },
  ];
  const leak = machineH6Leakage(lk, lensTotals(lk));
  const trendUp = netWorthSeries(
    [{ id: "a", name: "SBI", kind: "bank", anchorBalancePaise: 1000000, anchorDate: "2026-01-01" }],
    [
      { accountId: "a", txnDate: "2026-01-15", amountPaise: 500000 },
      { accountId: "a", txnDate: "2026-02-15", amountPaise: 500000 },
      { accountId: "a", txnDate: "2026-03-15", amountPaise: 500000 },
    ],
    ["2026-01", "2026-02", "2026-03"],
  );
  const trendOne = netWorthSeries([{ id: "a", name: "SBI", kind: "bank", anchorBalancePaise: 1000000, anchorDate: "2026-01-01" }], [], ["2026-03"]);
  const h6Checks: Array<[string, boolean]> = [
    [`H6 leakage 5% → amber (pct ${leak.pct?.toFixed(1)}, total ${leak.totalLeakagePaise})`, leak.band === "amber" && leak.totalLeakagePaise === 200000],
    [`H6 leakage byParent surfaces the wants leak`, leak.byParent.length === 1 && leak.byParent[0].parent === "03 Spend-it Wants"],
    [`H6 net-worth rising across 3 months → green, +₹10,000 (Jan-end ₹15k → Mar-end ₹25k)`, trendUp.band === "green" && trendUp.direction === "up" && trendUp.changePaise === 1000000],
    [`H6 month-end accumulates (Jan 15,000 → Mar 25,000)`, trendUp.series[0].netWorthPaise === 1500000 && trendUp.series[2].netWorthPaise === 2500000],
    [`H6 <2 months → null band (needs more history)`, trendOne.band === null],
  ];
  for (const [label, ok] of h6Checks) { if (!ok) failures++; console.log(`COMPASS-H6 ${ok ? "PASS" : "FAIL"}: ${label}`); }
}

// ---- Compass Mirror (Pass 4): freedom ratio, lifestyle creep, enjoyment floor ----
{
  // avg per-month spend ₹40,000; cash net worth ₹6,00,000 + investments ₹18,00,000 = ₹24,00,000 → 60 months
  const avg = { ...lensTotals([]), personalIncome: 10000000, personalSavings: 5000000, investOutflow: 5000000, personalSpend: 4000000, wantsOutflow: 200000 };
  const fr = freedomRatio(avg, 60000000, 180000000);
  // window where spend grows faster than income → creep red
  const cmk = (month: string, inc: number, spend: number): CompassTxn[] => ([
    { txnDate: `${month}-05`, amountPaise: inc, parent: "01 Income", categoryName: "Retainer Income", tags: [] },
    { txnDate: `${month}-12`, amountPaise: -spend, parent: "02 Spend-it Needs", categoryName: "Groceries", tags: [] },
  ]);
  const creepWin = computeWindow([
    ...cmk("2026-01", 10000000, 3000000), ...cmk("2026-02", 10000000, 3000000),
    ...cmk("2026-03", 10000000, 6000000), ...cmk("2026-04", 10000000, 6000000),
  ], 6);
  const creep = lifestyleCreep(creepWin); // spend +100%, income 0% → creep +100 → red
  const calmWin = computeWindow([...cmk("2026-01", 10000000, 4000000), ...cmk("2026-02", 12000000, 4000000)], 6);
  const calm = lifestyleCreep(calmWin); // income up, spend flat → creep negative → green
  // enjoyment floor: save 50%, wants 2% of income → triggered
  const enjoy = enjoymentFloor({ ...lensTotals([]), personalIncome: 10000000, personalSavings: 5000000, wantsOutflow: 200000 });
  const enjoyBalanced = enjoymentFloor({ ...lensTotals([]), personalIncome: 10000000, personalSavings: 2500000, wantsOutflow: 1500000 });
  const mirrorChecks: Array<[string, boolean]> = [
    [`Freedom ratio includes investments = ${fr.months?.toFixed(0)} months (expected 60)`, Math.round(fr.months ?? 0) === 60 && fr.liquidNetWorthPaise === 240000000],
    [`Freedom ratio null when no spend`, freedomRatio(lensTotals([]), 100, 100).months === null],
    [`Lifestyle creep: spend +100% vs income 0% → red (creep ${creep.creepPct?.toFixed(0)}%)`, creep.band === "red" && Math.round(creep.creepPct ?? 0) === 100],
    [`Lifestyle creep: income up, spend flat → green`, calm.band === "green" && (calm.creepPct ?? 1) <= 0],
    [`Lifestyle creep null with <2 months`, lifestyleCreep(computeWindow(cmk("2026-01", 100, 100), 6)).band === null],
    [`Enjoyment floor: save 50% + wants 2% → triggered`, enjoy.triggered && Math.round(enjoy.saveRatePct ?? 0) === 50],
    [`Enjoyment floor: balanced saver → not triggered`, !enjoyBalanced.triggered],
  ];
  for (const [label, ok] of mirrorChecks) { if (!ok) failures++; console.log(`COMPASS-MIRROR ${ok ? "PASS" : "FAIL"}: ${label}`); }

  // Profile / reflection checklist (Pass 5) — pure shape + migration presence
  const profileMig = readFileSync("supabase/migrations/0006_profile.sql", "utf8");
  const ep = emptyProfile();
  const profChecks: Array<[string, boolean]> = [
    ["exactly 7 reflections with stable unique keys", REFLECTIONS.length === 7 && new Set(REFLECTIONS.map((r) => r.key)).size === 7],
    ["emptyProfile has empty checklist + default goal-return", Object.keys(ep.checklist).length === 0 && ep.goalReturnAssumption === 8],
    ["migration 0006 creates profile with RLS owner policy + jsonb data + unique user_id",
      profileMig.includes("create table public.profile") && profileMig.includes("data jsonb") &&
      profileMig.includes("enable row level security") && profileMig.includes("profile_owner") && profileMig.includes("unique (user_id)")],
  ];
  for (const [label, ok] of profChecks) { if (!ok) failures++; console.log(`COMPASS-PROFILE ${ok ? "PASS" : "FAIL"}: ${label}`); }
}

// ---- Compass summary header (Pass 6): R/A/G count + highest-priority action (Red before Amber) ----
{
  const sum = machineSummary([
    { id: "H1", band: "amber", action: "trim spend" },
    { id: "H2", band: "red", action: "build the buffer" },
    { id: "H3", band: "green", action: "ok" },
    { id: "H4", band: "green", action: "ok" },
    { id: "H5", band: null, action: "import holdings" },
    { id: "H6", band: "amber", action: "watch leakage" },
  ]);
  const allGreen = machineSummary([{ id: "H1", band: "green", action: "ok" }, { id: "H2", band: "green", action: "ok" }]);
  const sumChecks: Array<[string, boolean]> = [
    [`counts: 1 red, 2 amber, 2 green, 1 na`, sum.counts.red === 1 && sum.counts.amber === 2 && sum.counts.green === 2 && sum.counts.na === 1],
    [`top action is the RED check (before amber)`, sum.topAction?.band === "red" && sum.topAction?.action === "build the buffer"],
    [`worstBand prefers red > amber > green, ignores null`, worstBand(["green", "amber", null, "red"]) === "red" && worstBand([null, "green"]) === "green" && worstBand([null]) === null],
    [`all green → no top action (steady)`, allGreen.topAction === null && allGreen.counts.green === 2],
  ];
  for (const [label, ok] of sumChecks) { if (!ok) failures++; console.log(`COMPASS-SUMMARY ${ok ? "PASS" : "FAIL"}: ${label}`); }
}

// ---- Money Manager enrichment parser (Pass 1): redacted synthetic fixture, structure not content ----
console.log("\n" + "-".repeat(78));
{
  const { entries: mm, warnings: mmw } = parseMoneyManager(readFileSync("fixtures/money_manager_sample.xlsx"));
  const salary = mm.find((e) => e.categoryRaw === "Salary");
  const transport = mm.find((e) => e.categoryRaw === "Transport");
  const personal = mm.find((e) => e.categoryRaw === "Personal");
  const health = mm.find((e) => e.categoryRaw === "Health");
  console.log(`\nMONEY MANAGER: ${mm.length} entries parsed from the redacted fixture (${mmw.length} warnings)`);
  const mmChecks: Array<[string, boolean]> = [
    [`rows = ${mm.length} (expected 8)`, mm.length === 8],
    [`Income row → positive paise (Salary ${salary?.amountPaise}, expected +5000000)`, salary?.amountPaise === 5000000 && salary?.direction === "inflow"],
    [`Exp. row → negative paise (Transport ${transport?.amountPaise}, expected -12000)`, transport?.amountPaise === -12000 && transport?.direction === "outflow"],
    [`emoji stripped from category ("🚖 Transport" → "Transport", "🧘🏼 Health" → "Health")`,
      transport?.categoryRaw === "Transport" && health?.categoryRaw === "Health"],
    [`stripEmojiPrefix leaves a plain category untouched ("Other")`, stripEmojiPrefix("Other") === "Other"],
    [`merchantText falls back to note when description empty (Transport → "To office")`, transport?.merchantText === "To office"],
    [`merchantText prefers description when present (Personal → "Cafe Coffee Day")`, personal?.merchantText === "Cafe Coffee Day"],
    [`redundant Amount col (99999) ignored — uses INR (Personal = -25000)`, personal?.amountPaise === -25000],
    [`rowRef is a stable 64-hex sha256`, !!salary && /^[0-9a-f]{64}$/.test(salary.rowRef)],
  ];
  for (const [label, ok] of mmChecks) { if (!ok) failures++; console.log(`MM ${ok ? "PASS" : "FAIL"}: ${label}`); }
}

// ---- Money Manager category map (Pass 2): targets resolved from the taxonomy, never 14/15 ----
{
  const mmk = (over: Partial<MoneyManagerEntry>): MoneyManagerEntry => ({
    loggedAt: "2026-03-05", amountPaise: -10000, direction: "outflow", categoryRaw: "Personal",
    note: null, description: null, merchantText: "", rowRef: "r", ...over,
  });
  // every map target must EXIST in the taxonomy and must NOT be a Leakage(14)/Review(15) leaf
  const targets = mmTargetCategoryNames();
  const allExist = targets.every((n) => taxonomy.has(n));
  const noneForbidden = targets.every((n) => { const c = taxonomy.get(n); return c && !isForbiddenAutoParent(c.parent || c.name); });
  const mapChecks: Array<[string, boolean]> = [
    [`all ${targets.length} map targets exist in the taxonomy`, allExist],
    [`no map target is a Leakage(14)/Review(15) leaf`, noneForbidden],
    [`CC → "Credit Card Bill Payment Transfer" (Transfer, parent 10)`,
      resolveMmCategory(mmk({ categoryRaw: "CC" })).categoryName === "Credit Card Bill Payment Transfer" && taxonomy.get("Credit Card Bill Payment Transfer")?.parent === "10 Transfers & Adjustments"],
    [`SIP → "SIP Mutual Fund" (Invest, parent 08)`,
      resolveMmCategory(mmk({ categoryRaw: "SIP" })).categoryName === "SIP Mutual Fund" && taxonomy.get("SIP Mutual Fund")?.parent === "08 Invest-it"],
    [`Transport → "Taxi / Cab / Auto" (parent 02)`,
      resolveMmCategory(mmk({ categoryRaw: "Transport" })).categoryName === "Taxi / Cab / Auto"],
    [`Salary → "Salary" (parent 01), is an override`,
      resolveMmCategory(mmk({ categoryRaw: "Salary", direction: "inflow", amountPaise: 100 })).categoryName === "Salary" && resolveMmCategory(mmk({ categoryRaw: "Salary" })).isOverride],
    [`Personal / Other → null (not forced — left for rules + AI)`,
      resolveMmCategory(mmk({ categoryRaw: "Personal" })).categoryName === null && resolveMmCategory(mmk({ categoryRaw: "Other" })).categoryName === null],
    [`note "Vinnie" → family-account transfer override "${SPOUSE_TRANSFER_CATEGORY}" (parent 10), regardless of category`,
      isSpouseTransfer(mmk({ note: "Vinnie", categoryRaw: "Other", direction: "inflow", amountPaise: 50000 })) &&
      resolveMmCategory(mmk({ note: "Vinnie", categoryRaw: "Other" })).categoryName === SPOUSE_TRANSFER_CATEGORY &&
      taxonomy.get(SPOUSE_TRANSFER_CATEGORY)?.parent === "10 Transfers & Adjustments"],
  ];
  for (const [label, ok] of mapChecks) { if (!ok) failures++; console.log(`MM-MAP ${ok ? "PASS" : "FAIL"}: ${label}`); }
}

// ---- Money Manager matcher (Pass 2): direction + exact amount within ±window, 1:1 unambiguous ----
{
  const mmk = (over: Partial<MoneyManagerEntry>): MoneyManagerEntry => ({
    loggedAt: "2026-03-05", amountPaise: -5000, direction: "outflow", categoryRaw: "Personal",
    note: "x", description: null, merchantText: "x", rowRef: Math.random().toString(36).slice(2), ...over,
  });
  const T = (id: string, txnDate: string, amountPaise: number) => ({ id, accountId: "A", txnDate, amountPaise });

  const exact = matchMoneyManager([T("t1", "2026-03-05", -5000)], [mmk({ rowRef: "e1" })]);
  const within = matchMoneyManager([T("t1", "2026-03-07", -5000)], [mmk({ loggedAt: "2026-03-05", rowRef: "e1" })]);
  const offByOne = matchMoneyManager([T("t1", "2026-03-05", -5001)], [mmk({ rowRef: "e1" })]);
  const wrongDir = matchMoneyManager([T("t1", "2026-03-05", -5000)], [mmk({ amountPaise: 5000, direction: "inflow", rowRef: "e1" })]);
  const outside = matchMoneyManager([T("t1", "2026-03-09", -5000)], [mmk({ loggedAt: "2026-03-05", rowRef: "e1" })]);
  const tie = matchMoneyManager([T("a", "2026-03-06", -8000), T("b", "2026-03-06", -8000)], [mmk({ loggedAt: "2026-03-06", amountPaise: -8000, rowRef: "e1" })]);
  const greedy = matchMoneyManager(
    [T("far", "2026-03-08", -8000), T("near", "2026-03-05", -8000)],
    [mmk({ loggedAt: "2026-03-06", amountPaise: -8000, rowRef: "e1" })],
  );

  const matchChecks: Array<[string, boolean]> = [
    [`exact same-day match enriches (t1, exact-day)`, exact.matched.length === 1 && exact.matched[0].txnId === "t1" && exact.matched[0].confidence === "exact-day" && exact.ambiguous.length === 0],
    [`match within window (gap 2 ≤ ${DEFAULT_WINDOW_DAYS}) → within-window`, within.matched.length === 1 && within.matched[0].confidence === "within-window"],
    [`amount off by 1 paise → no match (unmatched)`, offByOne.matched.length === 0 && offByOne.unmatchedMM.length === 1],
    [`direction differs (same magnitude) → no match`, wrongDir.matched.length === 0 && wrongDir.unmatchedMM.length === 1],
    [`outside window (gap 4 > ${DEFAULT_WINDOW_DAYS}) → no match`, outside.matched.length === 0 && outside.unmatchedMM.length === 1],
    [`same-amount same-day pair → ambiguous, neither matched`, tie.matched.length === 0 && tie.ambiguous.length === 1],
    [`greedy picks the closest date (→ "near", not "far")`, greedy.matched.length === 1 && greedy.matched[0].txnId === "near"],
    [`match payload carries {txnId, mmRowRef} for provenance`, exact.matched[0].mmRowRef === "e1"],
  ];
  for (const [label, ok] of matchChecks) { if (!ok) failures++; console.log(`MM-MATCH ${ok ? "PASS" : "FAIL"}: ${label}`); }
}

// ---- Money Manager apply plan (Pass 3): improve-not-overwrite, never raw, idempotent, provenance ----
{
  const mmk = (over: Partial<MoneyManagerEntry>): MoneyManagerEntry => ({
    loggedAt: "2026-03-05", amountPaise: -12000, direction: "outflow", categoryRaw: "Personal",
    note: "x", description: null, merchantText: "x", rowRef: "e1", ...over,
  });
  const st = (over: Partial<MmTxnState>): MmTxnState => ({ id: "t1", merchant: null, notes: null, categorySource: "default", mmRowRef: null, ...over });
  const match = (txnId: string, mmRowRef: string): MmMatch => ({ txnId, mmRowRef, dayGap: 0, confidence: "exact-day" });
  const okCat = (_name: string) => ({ id: "cat-x" });   // resolves any name (guard passes)
  const refuseCat = (_name: string) => null;            // simulates the Leakage 14 / Review 15 guard rejection

  // (a) merchant IMPROVES on a raw UPI string; description_raw never appears in the payload.
  const eMerch = mmk({ rowRef: "e1", categoryRaw: "Personal", merchantText: "Zomato Booking" });
  const wMerch = planMoneyManagerWrites([match("t1", "e1")], new Map([["e1", eMerch]]),
    new Map([["t1", st({ merchant: "UPI/DR/512282836511/ZOMATO" })]]), okCat)[0];

  // (b) category applied to an Uncategorized-Review row, only suggested for an already-categorized one.
  const eSal = mmk({ rowRef: "es", categoryRaw: "Salary", direction: "inflow", amountPaise: 100, merchantText: "Salary" });
  const ebr = new Map([["es", eSal]]);
  const wDefault = planMoneyManagerWrites([match("t1", "es")], ebr, new Map([["t1", st({ categorySource: "default" })]]), okCat)[0];
  const wUser = planMoneyManagerWrites([match("t1", "es")], ebr, new Map([["t1", st({ categorySource: "user" })]]), okCat)[0];

  // (c) a refused (14/15) mapping is neither applied nor suggested.
  const eCC = mmk({ rowRef: "ec", categoryRaw: "CC", merchantText: "CC" });
  const wRefused = planMoneyManagerWrites([match("t1", "ec")], new Map([["ec", eCC]]), new Map([["t1", st({})]]), refuseCat)[0];

  // (d) idempotent re-run: applying onto the already-enriched state produces a no-op.
  const eTr = mmk({ rowRef: "et", categoryRaw: "Transport", note: "To office", merchantText: "To office" });
  const first = planMoneyManagerWrites([match("t1", "et")], new Map([["et", eTr]]), new Map([["t1", st({})]]),
    () => ({ id: "cat-taxi" }))[0];
  const afterState = st({ merchant: first.merchant ?? null, notes: first.notes, categorySource: "money_manager", mmRowRef: "et" });
  const second = planMoneyManagerWrites([match("t1", "et")], new Map([["et", eTr]]), new Map([["t1", afterState]]),
    () => ({ id: "cat-taxi" }))[0];

  const planChecks: Array<[string, boolean]> = [
    [`merchant improves, not overwrites ("UPI/DR/…/ZOMATO · Zomato Booking")`, wMerch.merchant === "UPI/DR/512282836511/ZOMATO · Zomato Booking"],
    [`payload never carries description_raw / description_clean`, !("description_raw" in wMerch) && !("description_clean" in wMerch)],
    [`notes append one "MM: …" line`, wMerch.notes.startsWith(MM_NOTE_PREFIX) && wMerch.notes.split("\n").filter((l) => l.startsWith(MM_NOTE_PREFIX)).length === 1],
    [`category APPLIED over Uncategorized Review (categoryId set, source money_manager)`, wDefault.categoryId === "cat-x" && wDefault.categorySource === "money_manager"],
    [`category NOT applied over an already-categorized row → suggestion only`, wUser.categoryId === undefined && wUser.suggestedCategoryName === "Salary"],
    [`refused (14/15) mapping is neither applied nor suggested`, wRefused.categoryId === undefined && wRefused.suggestedCategoryName === undefined],
    [`first run changes the row`, first.changed === true && first.merchant === "To office"],
    [`re-run is a no-op (changed=false) — no duplicate write`, second.changed === false],
    [`re-run keeps exactly one MM note line (no duplication)`, second.notes.split("\n").filter((l) => l.startsWith(MM_NOTE_PREFIX)).length === 1],
  ];
  for (const [label, ok] of planChecks) { if (!ok) failures++; console.log(`MM-PLAN ${ok ? "PASS" : "FAIL"}: ${label}`); }

  // mergeMmNote: append, replace-in-place, preserve foreign lines, idempotent.
  const noteChecks: Array<[string, boolean]> = [
    [`null + "MM: a" → "MM: a"`, mergeMmNote(null, "MM: a") === "MM: a"],
    [`replaces a prior MM line ("MM: a" + "MM: b" → "MM: b")`, mergeMmNote("MM: a", "MM: b") === "MM: b"],
    [`preserves a foreign note ("hi" + "MM: a" → "hi\\nMM: a")`, mergeMmNote("hi", "MM: a") === "hi\nMM: a"],
    [`idempotent ("hi\\nMM: a" + "MM: a" → unchanged)`, mergeMmNote("hi\nMM: a", "MM: a") === "hi\nMM: a"],
    [`mmNoteLine builds "MM: <cat> / <note> · <desc>"`,
      mmNoteLine({ ...mmk({}), categoryRaw: "Transport", note: "To office", description: "Auto" }) === "MM: Transport / To office · Auto"],
  ];
  for (const [label, ok] of noteChecks) { if (!ok) failures++; console.log(`MM-NOTE ${ok ? "PASS" : "FAIL"}: ${label}`); }
}

// ---- Money Manager UI (Pass 4): confirm-before-write, busy guard, unmatched read-only (no insert) ----
{
  const panel = readFileSync("src/components/money-manager-panel.tsx", "utf8");
  const route = readFileSync("src/app/api/enrich/money-manager/route.ts", "utf8");
  const page = readFileSync("src/app/(app)/transactions/page.tsx", "utf8");
  const uiChecks: Array<[string, boolean]> = [
    [`panel previews before writing (Scan & preview → mode=preview)`, panel.includes('run("preview")') && panel.includes('mode === "preview"')],
    [`panel has a separate confirm step that applies (mode=apply)`, panel.includes('run("apply")') && panel.includes("Apply enrichment")],
    [`panel honors the busy/nav-guard pattern (useBusy + begin/end)`, panel.includes("useBusy()") && panel.includes("begin(") && panel.includes("end(id)")],
    [`unmatched shown read-only with the deferred-cash note, NO insert offered`,
      panel.includes("Importing these as cash is not supported yet") && !/insert/i.test(panel)],
    [`route is enrichment-only: never inserts into transactions`, !route.includes(".insert(") && route.includes(".update(")],
    [`route guards categories via guardCategory (no 14/15 auto-assign)`, route.includes("guardCategory")],
    [`panel is mounted in the transactions Review section`, page.includes("<MoneyManagerPanel />")],
  ];
  for (const [label, ok] of uiChecks) { if (!ok) failures++; console.log(`MM-UI ${ok ? "PASS" : "FAIL"}: ${label}`); }
}

// ---- Google Pay statement parser (Pass 1): redacted synthetic fixture, structure not content ----
console.log("\n" + "-".repeat(78));
{
  const { entries: gp, reconciliation: gr, warnings: gw } = parseGooglePayStatement(F("google_pay_statement_sample.md"));
  const acme = gp.find((e) => e.party === "ACMEGROCERS");
  const jio = gp.find((e) => e.party === "JioPrepaid");
  const client = gp.find((e) => e.party === "CLIENTACME");
  const self = gp.find((e) => e.kind === "self_transfer");
  const canara = gp.find((e) => e.party === "CanaraTestMerchant");
  console.log(`\nGOOGLE PAY STATEMENT: ${gp.length} entries (paid ${gp.filter((e) => e.kind === "paid").length} / received ${gp.filter((e) => e.kind === "received").length} / self ${gp.filter((e) => e.kind === "self_transfer").length}); ${gw.length} warnings; reconcile ${gr.ok ? "PASS" : "FAIL"}`);
  const gpChecks: Array<[string, boolean]> = [
    [`entries = ${gp.length} (expected 10)`, gp.length === 10],
    [`Paid to → negative paise (ACME ${acme?.amountPaise}, expected -125000)`, acme?.amountPaise === -125000 && acme?.direction === "outflow"],
    [`Received from → positive paise (CLIENTACME ${client?.amountPaise}, expected +200000)`, client?.amountPaise === 200000 && client?.direction === "inflow"],
    [`Self transfer flagged kind=self_transfer`, !!self && self.kind === "self_transfer"],
    [`verb prefix stripped from party ("PaidtoACMEGROCERS" → "ACMEGROCERS")`, acme?.party === "ACMEGROCERS" && acme?.merchantText === "ACMEGROCERS"],
    [`funding bank name + last-4 parsed (ACME → HDFC Bank / 0789)`, acme?.fundingBankName === "HDFC Bank" && acme?.fundingBankLast4 === "0789"],
    [`Canara routed to last-4 8593`, canara?.fundingBankLast4 === "8593" && canara?.fundingBankName === "Canara Bank"],
    [`upiTxnId captured (ACME = 111111111111, = rowRef)`, acme?.upiTxnId === "111111111111" && acme?.rowRef === "111111111111"],
    [`paise amount parsed exactly (₹300.90 → -30090)`, jio?.amountPaise === -30090],
    [`date ISO from "02Dec,2025"`, acme?.txnDate === "2025-12-02"],
    [`header/footer/summary excluded (no entry party starts with "Transaction"/"Note"/"Page")`,
      gp.every((e) => !/^(Transaction|Note|Page)/.test(e.party))],
    [`reconcile-or-show: Σpaid == Sent ${gr.sentTotalPaise} (Δ ${gr.sentDeltaPaise}), Σreceived == Received ${gr.receivedTotalPaise} (Δ ${gr.receivedDeltaPaise})`,
      gr.sentDeltaPaise === 0 && gr.receivedDeltaPaise === 0 && gr.sentTotalPaise === 875590 && gr.receivedTotalPaise === 200200],
  ];
  for (const [label, ok] of gpChecks) { if (!ok) failures++; console.log(`GPAY-STMT ${ok ? "PASS" : "FAIL"}: ${label}`); }
}

// ---- Google Pay statement category hints + matcher (Pass 2) ----
{
  const gpe = (over: Partial<import("../src/lib/ingest/types.js").GooglePayStatementEntry>): import("../src/lib/ingest/types.js").GooglePayStatementEntry => ({
    txnDate: "2025-12-02", time: "08:30PM", amountPaise: -125000, direction: "outflow", kind: "paid",
    party: "ACME", upiTxnId: "111", fundingBankName: "HDFC Bank", fundingBankLast4: "0789",
    merchantText: "ACME", rowRef: "111", ...over,
  });
  // map targets exist + not 14/15; intents
  const targets = gpayTargetCategoryNames();
  const allExist = targets.every((n) => taxonomy.has(n));
  const noneForbidden = targets.every((n) => { const c = taxonomy.get(n); return c && !isForbiddenAutoParent(c.parent || c.name); });
  const mapChecks: Array<[string, boolean]> = [
    [`all ${targets.length} hint targets exist in the taxonomy, none Leakage/Review`, allExist && noneForbidden],
    [`self-transfer → "Own Account Transfer" (override)`, resolveGpayCategory(gpe({ kind: "self_transfer", party: "StateBankofIndia4358" })).categoryName === "Own Account Transfer"],
    [`family name "VINEETHVINODNAIR" → "Own Account Transfer" (override, space-insensitive)`,
      isGpayTransfer(gpe({ party: "VINEETHVINODNAIR" })) && resolveGpayCategory(gpe({ party: "VINEETHVINODNAIR" })).categoryName === "Own Account Transfer"],
    [`JioPrepaid → "Mobile Phone"`, resolveGpayCategory(gpe({ party: "JioPrepaid" })).categoryName === "Mobile Phone"],
    [`Netflix → "OTT / Entertainment"`, resolveGpayCategory(gpe({ party: "NetflixEntertainmentServicesIndiaLLP" })).categoryName === "OTT / Entertainment"],
    [`GooglePlay → "Apps & Digital Subscriptions"`, resolveGpayCategory(gpe({ party: "GooglePlay" })).categoryName === "Apps & Digital Subscriptions"],
    [`unknown merchant → null (left for rules + AI)`, resolveGpayCategory(gpe({ party: "SomeRandomKirana" })).categoryName === null],
  ];
  for (const [label, ok] of mapChecks) { if (!ok) failures++; console.log(`GPAY-MAP ${ok ? "PASS" : "FAIL"}: ${label}`); }

  const T = (id: string, accountId: string, txnDate: string, amountPaise: number, refText: string) => ({ id, accountId, txnDate, amountPaise, refText });
  const A = (id: string, last4: string) => ({ id, kind: "bank", last4 });
  const accts = [A("hdfc", "0789"), A("sbi", "4358")];

  // routing: funding 0789 restricts to the HDFC account even though SBI has the same amount/date
  const routed = matchGooglePayStatement([gpe({})], [T("t1", "hdfc", "2025-12-02", -125000, "x"), T("t2", "sbi", "2025-12-02", -125000, "x")], accts);
  // ID primary: refText carries the upiTxnId → match even when the date is outside the window
  const idHit = matchGooglePayStatement([gpe({ upiTxnId: "999", amountPaise: -50000, txnDate: "2025-12-09" })],
    [T("t1", "hdfc", "2025-12-25", -50000, "UPI/DR/999/MERCHANT")], accts);
  // fallback amount/window when no id; off-amount → no match
  const noMatch = matchGooglePayStatement([gpe({ amountPaise: -777 })], [T("t1", "hdfc", "2025-12-02", -778, "x")], accts);
  // self/spouse flagged isTransfer
  const selfM = matchGooglePayStatement([gpe({ kind: "self_transfer", party: "StateBankofIndia4358" })], [T("t1", "hdfc", "2025-12-02", -125000, "x")], accts);
  const spouseM = matchGooglePayStatement([gpe({ party: "VINEETHVINODNAIR" })], [T("t1", "hdfc", "2025-12-02", -125000, "x")], accts);
  // same-amount same-day within one account → ambiguous
  const amb = matchGooglePayStatement([gpe({ amountPaise: -8000, txnDate: "2025-12-06" })],
    [T("a", "hdfc", "2025-12-06", -8000, "x"), T("b", "hdfc", "2025-12-06", -8000, "x")], accts);
  // unknown last-4 → fall back to all bank/cc accounts
  const fb = matchGooglePayStatement([gpe({ fundingBankLast4: "9999", amountPaise: -100 })], [T("t1", "hdfc", "2025-12-02", -100, "x")], accts);

  const matchChecks: Array<[string, boolean]> = [
    [`account routing picks the right account by last-4 (→ HDFC t1, not SBI t2)`, routed.matched.length === 1 && routed.matched[0].txnId === "t1" && routed.matched[0].confidence === "amount-window"],
    [`UPI-ID match is primary — matches even outside the date window (confidence "id")`, idHit.matched.length === 1 && idHit.matched[0].confidence === "id" && idHit.matched[0].txnId === "t1"],
    [`amount off by 1 paise → no match`, noMatch.matched.length === 0 && noMatch.unmatched.length === 1],
    [`self-transfer matched + flagged isTransfer`, selfM.matched.length === 1 && selfM.matched[0].isTransfer === true],
    [`family-name transfer matched + flagged isTransfer`, spouseM.matched.length === 1 && spouseM.matched[0].isTransfer === true],
    [`same-amount same-day within one account → ambiguous, neither matched`, amb.matched.length === 0 && amb.ambiguous.length === 1],
    [`unknown last-4 falls back to all bank/cc accounts`, fb.matched.length === 1 && fb.matched[0].txnId === "t1"],
    [`byBank breakdown counts matched/total per funding last-4`, routed.byBank["0789"]?.matched === 1 && routed.byBank["0789"]?.total === 1],
  ];
  for (const [label, ok] of matchChecks) { if (!ok) failures++; console.log(`GPAY-MATCH ${ok ? "PASS" : "FAIL"}: ${label}`); }
}

// ---- Google Pay statement apply plan (Pass 3): improve-not-overwrite, idempotent, provenance ----
{
  const gpe = (over: Partial<import("../src/lib/ingest/types.js").GooglePayStatementEntry>): import("../src/lib/ingest/types.js").GooglePayStatementEntry => ({
    txnDate: "2025-12-02", time: "08:30PM", amountPaise: -125000, direction: "outflow", kind: "paid",
    party: "RandomKirana", upiTxnId: "u1", fundingBankName: "HDFC Bank", fundingBankLast4: "0789",
    merchantText: "RandomKirana", rowRef: "u1", ...over,
  });
  const st = (over: Partial<GpayTxnState>): GpayTxnState => ({ id: "t1", merchant: null, notes: null, categorySource: "default", enrichmentRef: null, ...over });
  const gm = (txnId: string, upiTxnId: string): GpayMatch => ({ txnId, upiTxnId, confidence: "id", isTransfer: false });
  const okCat = (_n: string) => ({ id: "cat-x" });
  const refuseCat = (_n: string) => null;

  // (a) merchant IMPROVES on a raw UPI string; description_raw never in the payload.
  const eM = gpe({ upiTxnId: "u1", party: "ChaiPoint", merchantText: "ChaiPoint" });
  const wM = planGooglePayWrites([gm("t1", "u1")], new Map([["u1", eM]]), new Map([["t1", st({ merchant: "UPI/DR/511/CHAI" })]]), okCat)[0];

  // (b) self-transfer category applied over Uncategorized Review; only suggested over an already-categorized row.
  const eS = gpe({ upiTxnId: "us", kind: "self_transfer", party: "StateBankofIndia4358" });
  const ebr = new Map([["us", eS]]);
  const wDef = planGooglePayWrites([gm("t1", "us")], ebr, new Map([["t1", st({ categorySource: "default" })]]), okCat)[0];
  const wUser = planGooglePayWrites([gm("t1", "us")], ebr, new Map([["t1", st({ categorySource: "user" })]]), okCat)[0];

  // (c) a refused (14/15) mapping is neither applied nor suggested.
  const wRef = planGooglePayWrites([gm("t1", "us")], ebr, new Map([["t1", st({})]]), refuseCat)[0];

  // (d) idempotent re-run.
  const eT = gpe({ upiTxnId: "ut", party: "Blinkit", merchantText: "Blinkit" });
  const first = planGooglePayWrites([gm("t1", "ut")], new Map([["ut", eT]]), new Map([["t1", st({})]]), okCat)[0];
  const after = st({ merchant: first.merchant ?? null, notes: first.notes, categorySource: "default", enrichmentRef: "ut" });
  const second = planGooglePayWrites([gm("t1", "ut")], new Map([["ut", eT]]), new Map([["t1", after]]), okCat)[0];

  const planChecks: Array<[string, boolean]> = [
    [`merchant improves, not overwrites ("UPI/DR/511/CHAI · ChaiPoint")`, wM.merchant === "UPI/DR/511/CHAI · ChaiPoint"],
    [`payload never carries description_raw / description_clean`, !("description_raw" in wM) && !("description_clean" in wM)],
    [`notes append one "GPay: …" line`, wM.notes.startsWith(GPAY_NOTE_PREFIX) && wM.notes.split("\n").filter((l) => l.startsWith(GPAY_NOTE_PREFIX)).length === 1],
    [`self-transfer category APPLIED over Uncategorized Review (source google_pay_statement)`, wDef.categoryId === "cat-x" && wDef.categorySource === "google_pay_statement"],
    [`NOT applied over an already-categorized row → suggestion only`, wUser.categoryId === undefined && wUser.suggestedCategoryName === "Own Account Transfer"],
    [`refused (14/15) mapping neither applied nor suggested`, wRef.categoryId === undefined && wRef.suggestedCategoryName === undefined],
    [`first run changes the row`, first.changed === true && first.merchant === "Blinkit"],
    [`re-run is a no-op (changed=false)`, second.changed === false],
    [`re-run keeps exactly one GPay note line`, second.notes.split("\n").filter((l) => l.startsWith(GPAY_NOTE_PREFIX)).length === 1],
  ];
  for (const [label, ok] of planChecks) { if (!ok) failures++; console.log(`GPAY-PLAN ${ok ? "PASS" : "FAIL"}: ${label}`); }

  const noteChecks: Array<[string, boolean]> = [
    [`mergeSourceNote: null + "GPay: a" → "GPay: a"`, mergeSourceNote(null, "GPay: a", GPAY_NOTE_PREFIX) === "GPay: a"],
    [`coexists with an MM line ("MM: x" + GPay → both kept)`, mergeSourceNote("MM: x", "GPay: a", GPAY_NOTE_PREFIX) === "MM: x\nGPay: a"],
    [`replaces a prior GPay line ("GPay: a" + "GPay: b" → "GPay: b")`, mergeSourceNote("GPay: a", "GPay: b", GPAY_NOTE_PREFIX) === "GPay: b"],
    [`gpayNoteLine builds "GPay: <party> (via <bank> <last4>)"`, gpayNoteLine(gpe({ party: "JioPrepaid" })) === "GPay: JioPrepaid (via HDFC Bank 0789)"],
    [`gpayNoteLine handles a blank payee`, gpayNoteLine(gpe({ party: "" })) === "GPay: (unknown payee) (via HDFC Bank 0789)"],
  ];
  for (const [label, ok] of noteChecks) { if (!ok) failures++; console.log(`GPAY-NOTE ${ok ? "PASS" : "FAIL"}: ${label}`); }
}

// ---- Google Pay statement UI (Pass 4): confirm-before-write, busy guard, unmatched read-only ----
{
  const panel = readFileSync("src/components/google-pay-statement-panel.tsx", "utf8");
  const route = readFileSync("src/app/api/enrich/google-pay-statement/route.ts", "utf8");
  const page = readFileSync("src/app/(app)/transactions/page.tsx", "utf8");
  const uiChecks: Array<[string, boolean]> = [
    [`panel previews before writing (Scan & preview → mode=preview)`, panel.includes('run("preview")') && panel.includes('mode === "preview"')],
    [`panel has a separate confirm step that applies (mode=apply)`, panel.includes('run("apply")') && panel.includes("Apply enrichment")],
    [`panel shows reconciliation deltas + per-funding-bank breakdown`, panel.includes("Reconciliation vs statement totals") && panel.includes("Match coverage by funding account")],
    [`panel honors the busy/nav-guard pattern (useBusy + begin/end)`, panel.includes("useBusy()") && panel.includes("begin(") && panel.includes("end(id)")],
    [`unmatched shown read-only, NO insert offered`, panel.includes("Importing these directly isn") && !/insert/i.test(panel)],
    [`route is enrichment-only: never inserts into transactions`, !route.includes(".insert(") && route.includes(".update(")],
    [`route guards categories via guardCategory (no 14/15 auto-assign)`, route.includes("guardCategory")],
    [`panel is mounted in the transactions Review section`, page.includes("<GooglePayStatementPanel />")],
  ];
  for (const [label, ok] of uiChecks) { if (!ok) failures++; console.log(`GPAY-UI ${ok ? "PASS" : "FAIL"}: ${label}`); }
}

console.log("\n" + "=".repeat(78));
console.log(failures === 0 ? "ALL GATES PASSED" : `${failures} GATE(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
