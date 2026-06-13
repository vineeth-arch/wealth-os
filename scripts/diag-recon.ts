// scripts/diag-recon.ts — READ-ONLY reconciliation diagnostic (throwaway).
// Runs each parser against its committed fixture and reports recon health.
// Changes NO parser logic. Run: npx tsx scripts/diag-recon.ts
//   or against an arbitrary file:
//   npx tsx scripts/diag-recon.ts --file path/to/statement.md --parser sbi
import { readFileSync } from "node:fs";
import { parseSbi } from "../src/lib/ingest/parsers/sbi.js";
import { parseIdfcBank } from "../src/lib/ingest/parsers/idfc-bank.js";
import { parseFederal } from "../src/lib/ingest/parsers/federal.js";
import { parseIdfcCc } from "../src/lib/ingest/parsers/idfc-cc.js";
import { parseSuryodayCc } from "../src/lib/ingest/parsers/suryoday-cc.js";
import { formatPaise } from "../src/lib/ingest/util.js";
import type { StatementParseResult, ParsedTransaction } from "../src/lib/ingest/types.js";

type ParserKey = "sbi" | "federal" | "idfc-bank" | "idfc-cc" | "suryoday";

// Every parser normalized to "string -> StatementParseResult[]" (single-statement parsers wrap in [ ]).
const PARSERS: Record<ParserKey, (content: string) => StatementParseResult[]> = {
  sbi: (c) => [parseSbi(c)],
  "idfc-bank": (c) => [parseIdfcBank(c)],
  federal: (c) => parseFederal(c),
  "idfc-cc": (c) => parseIdfcCc(c),
  suryoday: (c) => parseSuryodayCc(c),
};

const FIXTURES: Array<{ key: ParserKey; file: string; label: string }> = [
  { key: "sbi", file: "AccountStatement_27052026_133757.md", label: "SBI" },
  { key: "federal", file: "Federalbank-2026-05-27.md", label: "Federal" },
  { key: "idfc-bank", file: "IDFC_BANK_STATEMENT-2026-05-27.md", label: "IDFC Bank" },
  { key: "idfc-cc", file: "IDFC_CC-2026-05-27.md", label: "IDFC CC" },
  { key: "suryoday", file: "Surodyay_CC-2026-05-27.md", label: "Suryoday CC" },
];

interface Finding { label: string; ok: boolean; reason: string; }
const findings: Finding[] = [];

function getFlag(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}

/** Walk the stated running balance from opening; return the first row where it diverges. */
function firstChainBreak(r: StatementParseResult): { index: number; txn: ParsedTransaction; expected: number; stated: number } | null {
  const opening = r.reconciliation.openingPaise;
  if (opening === null) return null;
  let run = opening;
  for (let i = 0; i < r.transactions.length; i++) {
    const t = r.transactions[i];
    run += t.amountPaise;
    if (t.balanceAfterPaise !== undefined && t.balanceAfterPaise !== run) {
      return { index: i, txn: t, expected: run, stated: t.balanceAfterPaise };
    }
  }
  return null;
}

function diagnose(label: string, r: StatementParseResult): void {
  const rec = r.reconciliation;
  const verdict = rec.ok ? "PASS" : "FAIL"; // parser's own identity is authoritative
  console.log(`\n[${verdict}] ${label} — ${r.institution}  ${r.accountName}  ${r.periodStart ?? "?"} → ${r.periodEnd ?? "?"}`);
  console.log(`  txns: ${r.transactions.length}` +
    `   opening: ${rec.openingPaise !== null ? formatPaise(rec.openingPaise) : "n/a"}` +
    `   closing: ${rec.closingPaise !== null ? formatPaise(rec.closingPaise) : "n/a"}`);
  console.log(`  expected Δ: ${rec.expectedDeltaPaise !== null ? formatPaise(rec.expectedDeltaPaise) : "n/a"}   parsed Σ: ${formatPaise(rec.parsedSumPaise)}`);

  // Naive "opening + Σ == closing" — holds only for asset accounts. CC liability accounts use closing−opening == −Σ.
  if (rec.openingPaise !== null && rec.closingPaise !== null) {
    const naive = rec.openingPaise + rec.parsedSumPaise - rec.closingPaise;
    const naiveOk = naive === 0;
    const note = !naiveOk && rec.ok
      ? "  (≠0 but recon OK — credit-card LIABILITY account: identity is closing−opening == −Σ, not +Σ)"
      : "";
    console.log(`  naive opening+Σ−closing: ${formatPaise(naive)} ${naiveOk ? "== 0 ✓" : "≠ 0"}${note}`);
  } else {
    console.log(`  naive opening+Σ−closing: n/a (no opening/closing — card statement reconciles by debit/credit totals)`);
  }

  // Running-balance chain: first divergence, with the offending parsed row.
  const withBal = r.transactions.filter((t) => t.balanceAfterPaise !== undefined).length;
  if (rec.openingPaise === null || withBal === 0) {
    console.log(`  chain: n/a (${withBal === 0 ? "no per-row balances" : "no opening balance"})`);
  } else {
    const brk = firstChainBreak(r);
    if (brk === null) {
      console.log(`  chain: verified on every row (${withBal}/${r.transactions.length} rows carry a balance)`);
    } else {
      const t = brk.txn;
      console.log(`  chain: BREAKS at row #${brk.index + 1} of ${r.transactions.length}`);
      console.log(`    row: ${t.txnDate}  amt ${formatPaise(t.amountPaise)}  stated-bal ${formatPaise(brk.stated)}  expected ${formatPaise(brk.expected)}  diff ${formatPaise(brk.stated - brk.expected)}`);
      console.log(`    desc: ${t.descriptionRaw.slice(0, 90)}`);
    }
  }

  console.log(`  detail: ${rec.detail}`);
  for (const w of r.warnings) console.log(`  warn: ${w}`);
  findings.push({ label, ok: rec.ok, reason: rec.ok ? "reconciled" : rec.detail });
}

console.log("=".repeat(78));
console.log("WEALTH-OS RECONCILIATION DIAGNOSTIC — read-only, no parser changes");
console.log("=".repeat(78));

const fileFlag = getFlag("--file");
if (fileFlag) {
  const parserFlag = getFlag("--parser");
  if (!parserFlag || !(parserFlag in PARSERS)) {
    console.error(`--file requires --parser <${Object.keys(PARSERS).join("|")}>`);
    process.exit(2);
  }
  const key = parserFlag as ParserKey;
  const results = PARSERS[key](readFileSync(fileFlag, "utf8"));
  console.log(`\nParsing ${fileFlag} with parser "${key}" → ${results.length} statement(s)`);
  results.forEach((r, i) => diagnose(results.length > 1 ? `${key} #${i + 1}` : key, r));
} else {
  for (const fx of FIXTURES) {
    const results = PARSERS[fx.key](readFileSync(`fixtures/${fx.file}`, "utf8"));
    results.forEach((r, i) => diagnose(results.length > 1 ? `${fx.label} #${i + 1}` : fx.label, r));
  }
}

console.log("\n" + "=".repeat(78));
console.log("FINDINGS");
console.log("-".repeat(78));
const pad = Math.max(12, ...findings.map((f) => f.label.length));
for (const f of findings) console.log(`${(f.ok ? "PASS" : "FAIL").padEnd(5)} ${f.label.padEnd(pad)}  ${f.reason}`);
const failed = findings.filter((f) => !f.ok).length;
console.log("-".repeat(78));
console.log(failed === 0 ? `ALL ${findings.length} STATEMENTS RECONCILE` : `${failed}/${findings.length} STATEMENT(S) FAILED`);
