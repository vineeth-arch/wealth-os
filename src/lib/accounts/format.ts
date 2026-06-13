/**
 * Pure formatter for an account's copy-pastable "send me money" block. No imports, no I/O — unit-tested
 * in verify.ts. Plain text, newline-separated, for WhatsApp/email paste. Fields are manual-entry and may
 * be missing; every line is emitted ONLY when its value is present, so there are never blank lines, a
 * dangling "·", or an orphan label. A fully-empty account formats to "".
 */

/** Camel-cased view of the account's identity columns (mapped from the DB row at the boundary). */
export interface AccountDetails {
  accountHolderName?: string | null;
  institution?: string | null; // parser-key code (SBI, IDFC_BANK, …); prettified for display below
  accountType?: string | null;
  accountNumber?: string | null;
  ifsc?: string | null;
  branch?: string | null;
  upiId?: string | null;
}

/**
 * `institution` is a parser code, not a readable bank name (the readable label lives in accounts.name).
 * Map the known codes to bank names for the paste block; fall back to the raw code for anything else.
 */
const INSTITUTION_LABEL: Record<string, string> = {
  SBI: "State Bank of India",
  FEDERAL: "Federal Bank",
  IDFC_BANK: "IDFC FIRST Bank",
  IDFC_CC: "IDFC FIRST Bank",
  SURYODAY_CC: "Suryoday Small Finance Bank",
  ZERODHA: "Zerodha",
  SNAPSHOT: "",
};

export function institutionLabel(code?: string | null): string {
  const c = (code ?? "").trim();
  if (!c) return "";
  return INSTITUTION_LABEL[c] ?? c;
}

export function formatAccountDetails(a: AccountDetails): string {
  const lines: string[] = [];
  const clean = (v?: string | null): string => (v ?? "").trim();

  const holder = clean(a.accountHolderName);
  if (holder) lines.push(holder);

  // "Bank · Type" — drop the separator if either side is empty, drop the whole line if both are.
  const bankAndType = [institutionLabel(a.institution), clean(a.accountType)].filter(Boolean).join(" · ");
  if (bankAndType) lines.push(bankAndType);

  const push = (label: string, v?: string | null): void => {
    const t = clean(v);
    if (t) lines.push(`${label}: ${t}`);
  };
  push("A/c No", a.accountNumber);
  push("IFSC", a.ifsc);
  push("Branch", a.branch);
  push("UPI", a.upiId);

  return lines.join("\n");
}
