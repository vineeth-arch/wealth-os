/**
 * Generates fixtures/money_manager_sample.xlsx — a SMALL, fully-SYNTHETIC redacted Money Manager
 * export used only to gate the parser/matcher. The real export contains personal data (spouse name,
 * a baby naming, birthdays) and is NEVER committed. This file is the spec for the fixture's contents:
 * every value here is invented. Run: `tsx scripts/gen-mm-fixture.ts`.
 *
 * Columns mirror the real export exactly:
 *   Period | Accounts | Category | Subcategory | Note | INR | Income/Expense | Description | Amount | Currency | Accounts
 * Row 4's `Amount` (col 8) is a deliberate garbage sentinel (99999) to prove the parser reads INR
 * (col 5), not the redundant duplicate column.
 */
import * as XLSX from "xlsx";

const HEADER = ["Period", "Accounts", "Category", "Subcategory", "Note", "INR", "Income/Expense", "Description", "Amount", "Currency", "Accounts"];

// Period is an Excel serial datetime; the fractional part is log time, only the date matters.
const rows: unknown[][] = [
  HEADER,
  [46185.5, "Bank Accounts", "💰 Salary", null, "Salary", 50000, "Income", null, 50000, "INR", 50000],
  [46184.3, "Bank Accounts", "🚖 Transport", null, "To office", 120, "Exp.", null, 120, "INR", 120],
  [46183.1, "Bank Accounts", "📺 Netflix", null, "Netflix subscription", 649, "Exp.", null, 649, "INR", 649],
  [46182.7, "Bank Accounts", "👩‍❤️‍👨 Personal", null, "Lunch", 250, "Exp.", "Cafe Coffee Day", 99999, "INR", 250],
  [46181.2, "Bank Accounts", "💳 CC", null, "Credit card payment", 3000, "Exp.", null, 3000, "INR", 3000],
  [46180.9, "Bank Accounts", "Other", null, "Vinnie", 500, "Income", null, 500, "INR", 500],
  [46180.1, "Bank Accounts", "🤑 SIP", null, "SIP", 1000, "Exp.", null, 1000, "INR", 1000],
  [46179.4, "Bank Accounts", "🧘🏼 Health", null, "Medical", 400, "Exp.", "Apollo Pharmacy", 400, "INR", 400],
];

const ws = XLSX.utils.aoa_to_sheet(rows);
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
XLSX.writeFile(wb, "fixtures/money_manager_sample.xlsx");
console.log("wrote fixtures/money_manager_sample.xlsx (8 synthetic rows)");
