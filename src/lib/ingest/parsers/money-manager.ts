/**
 * Money Manager (.xlsx) household-spending export → normalized enrichment entries.
 * ENRICHMENT ONLY — these rows NEVER become transactions (that would double-count the bank ledger).
 * Her Note/Description is a far richer merchant label than the bank/UPI narration; that is the point.
 *
 * Verified format (single sheet, header row 1, data from row 2; 443 data rows in the sample):
 *   0 Period (Excel serial datetime = log time)   1 Accounts ("Bank Accounts", coarse — ignored)
 *   2 Category (emoji-prefixed)                    3 Subcategory (always empty)
 *   4 Note (~100% filled — her label)              5 INR (positive integer rupees)
 *   6 Income/Expense ("Income" | "Exp.")           7 Description (~19% filled — the merchant gold)
 *   8 Amount / 9 Currency / 10 Accounts  → redundant duplicates of INR/INR/INR; ignored.
 * Money is integer paise: INR * 100. Sign from direction (+ Income inflow, − Exp. outflow).
 * Load non-read-only (XLSX.read recomputes the real grid) — the read-only-dimension lesson from Upstox.
 * No money value ever passes through an LLM; this is deterministic parsing only.
 */
import * as XLSX from "xlsx";
import { createHash } from "node:crypto";
import type { MoneyManagerEntry } from "../types.js";

/**
 * Strip the leading emoji run — base pictographs, ZWJ sequences (👩‍❤️‍👨), skin-tone modifiers (🧘🏼),
 * variation/keycap selectors — plus any whitespace, then trim. "Other" (no emoji) is returned as-is.
 */
export function stripEmojiPrefix(s: string): string {
  return s.replace(/^[\p{Extended_Pictographic}\p{Emoji_Modifier}‍️⃣\s]+/u, "").trim();
}

/** Excel serial datetime → ISO YYYY-MM-DD (date1904=false epoch 1899-12-30). Floors to the DATE part (time is log noise). */
function serialDateToISO(serial: number): string {
  const ms = Date.UTC(1899, 11, 30) + Math.floor(serial) * 86400000;
  return new Date(ms).toISOString().slice(0, 10);
}

/** Labels that identify the header row (exact-cell match). */
const HEADER_LABELS = ["Period", "Category", "Income/Expense"];

export function parseMoneyManager(buf: Buffer): { entries: MoneyManagerEntry[]; warnings: string[] } {
  const wb = XLSX.read(buf, { type: "buffer" });
  const warnings: string[] = [];
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) return { entries: [], warnings: ["no sheet found"] };
  const g = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true }) as unknown[][];

  // Header-row detection: the row carrying Period / Category / Income/Expense.
  let headerIdx = -1;
  for (let i = 0; i < g.length; i++) {
    const cells = (g[i] ?? []).map((c) => String(c ?? "").trim());
    if (HEADER_LABELS.every((l) => cells.some((c) => c === l))) { headerIdx = i; break; }
  }
  if (headerIdx === -1) return { entries: [], warnings: ["no header row (Period/Category/Income/Expense)"] };

  const header = (g[headerIdx] as unknown[]).map((c) => String(c ?? "").trim());
  const col = (name: string) => header.indexOf(name); // first occurrence; redundant trailing "Accounts" never read
  const cPeriod = col("Period"), cCategory = col("Category"), cNote = col("Note"),
    cInr = col("INR"), cDir = col("Income/Expense"), cDesc = col("Description");

  const entries: MoneyManagerEntry[] = [];
  for (let i = headerIdx + 1; i < g.length; i++) {
    const r = g[i] as unknown[];
    if (!r || r.every((c) => c === undefined || c === null || String(c).trim() === "")) continue; // blank row

    const periodRaw = r[cPeriod];
    const dirRaw = String(r[cDir] ?? "").trim();
    const inrRaw = r[cInr];
    if (dirRaw === "" || inrRaw === undefined || inrRaw === null || String(inrRaw).trim() === "") {
      warnings.push(`row ${i + 1}: missing direction/amount — skipped`);
      continue;
    }
    const direction: "inflow" | "outflow" = dirRaw === "Income" ? "inflow" : "outflow";
    const magnitudePaise = Math.round(Number(inrRaw) * 100);
    if (!Number.isFinite(magnitudePaise)) { warnings.push(`row ${i + 1}: unparseable amount "${String(inrRaw)}"`); continue; }
    const amountPaise = direction === "inflow" ? magnitudePaise : -magnitudePaise;

    const note = String(r[cNote] ?? "").trim() || null;
    const description = String(r[cDesc] ?? "").trim() || null;
    const categoryRaw = stripEmojiPrefix(String(r[cCategory] ?? ""));
    const merchantText = description ?? note ?? "";

    const loggedAt = typeof periodRaw === "number" ? serialDateToISO(periodRaw) : String(periodRaw ?? "").slice(0, 10);
    // rowRef uses the raw Period (time-precise) so genuine same-day same-amount logs stay distinct + stable across re-uploads.
    const rowRef = createHash("sha256")
      .update([String(periodRaw ?? ""), String(amountPaise), note ?? "", description ?? ""].join("|"))
      .digest("hex");

    entries.push({ loggedAt, amountPaise, direction, categoryRaw, note, description, merchantText, rowRef });
  }

  return { entries, warnings };
}
