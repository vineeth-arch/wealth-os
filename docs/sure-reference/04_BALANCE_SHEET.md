# 04 — Balance sheet (assets vs liabilities)

> Read `00_PORTING_GUIDE.md` first. Restated in wealth-os terms (paise, `+`=inflow, `user_id`). Sure pointers `path:line` at `b0b0dc86…`, re-read this run. Built as a dashboard section (Phase B3).

## 1. What it is

The net-worth breakdown: **net worth = assets − liabilities**, with accounts grouped (by type) under an Assets total and a Liabilities total, each shown as a proportional bar + legend + expandable rows, plus a net-worth-over-time line.

## 2. Sure data model

No dedicated table — `BalanceSheet` (`app/models/balance_sheet.rb`) is a service over accounts:
- **`net_worth = assets.total − liabilities.total`** (`:37-39`).
- `assets` / `liabilities` are **`ClassificationGroup`**s (`:13-27`) built from `account_totals.asset_accounts` / `.liability_accounts` (`AccountTotals` splits accounts by their `classification` virtual column — `Loan`/`CreditCard`/`OtherLiability` ⇒ liability, else asset; see porting guide §3).
- `ClassificationGroup.total` = `Σ account.converted_balance` over accounts where `included_in_finances?` (per the prior audit's `classification_group.rb`; converted to family currency).
- `account_groups` sub-groups accounts by accountable type for display (`:33-35`).
- **`net_worth_series(period:)`** (`:41-43`) → `NetWorthSeriesBuilder` produces `{ date, value }` points across the period (cached), favorable direction "up".
- Accounts are sorted by user pref (`sorted:66-82`: name/balance asc/desc).

## 3. The math / algorithm (numbered)

In wealth-os (paise; credit cards/loans are liabilities, not negative assets):
1. **Classify accounts** (porting guide §3): **assets** = `accounts.kind ∈ {bank, broker, asset_snapshot}`; **liabilities** = `accounts.kind = credit_card` **plus** the `loans` table.
2. **Asset balances**:
   - `bank` / `asset_snapshot` → `accountBalances()` balance (`src/lib/halan.ts`, anchor + Σ txns).
   - `broker` → **present value** via `holdingsValue()` (`halan.ts`), not the cash balance.
3. **Liability balances** (store as positive magnitudes for the liabilities total):
   - `credit_card` → `|accountBalances() balance|` (the card balance is negative; its magnitude is what you owe).
   - `loans` → outstanding principal = the latest `os_principal_paise` from `loan_schedule_rows` (imported/computed), per loan.
4. **`assets.total`** = `Σ` rule-2 balances. **`liabilities.total`** = `Σ` rule-3 magnitudes.
5. **`net_worth = assets.total − liabilities.total`** (rule 4). This must reconcile with the existing single-sum net worth (`accountBalances().netWorthPaise`) **once holdings present-value and loan outstanding are folded in** — note the existing `netWorthPaise` already nets credit cards as negative but does **not** include holdings present-value or loans, so the balance-sheet total is the more complete figure; reconcile and prefer it.
6. **Group weights** (UI): per account-group `weight = group_total / classification_total × 100`.
7. **Net-worth series**: replay cumulatively — for each step date in the period, `net_worth(date) = Σ asset balances as-of date − Σ liability magnitudes as-of date`. Reuse the anchor+Σtxns logic of `accountBalances()` evaluated per step.

## 4. UI/UX shape

`app/views/pages/dashboard/_balance_sheet.html.erb`: two sections (Assets, Liabilities), each with a header (name + total + syncing pulse), a **proportional stacked color bar** of account-group weights, a **legend** (swatch + name + %), and an **expandable** per-group table (`<details>`) with indented account rows (logo, name, weight%, balance) and per-row sparklines.

## 5. ★ wealth-os build notes

**No new table needed** — derive from existing `accounts`, `holdings_snapshots`/`prices`, and `loans`/`loan_schedule_rows`.

**Module**: add to `src/lib/halan.ts` (or a small `src/lib/balance-sheet.ts`) a `balanceSheet(accounts, txns, holdings, prices, loans)` returning `{ assets: Group[], liabilities: Group[], assetsTotalPaise, liabilitiesTotalPaise, netWorthPaise }`. **Reuse `accountBalances()` and `holdingsValue()`** — do not re-derive balances.

**Route/placement**: render as a **dashboard section** (and reuse inside `/reports` Net-Worth section). Classification is by `accounts.kind` (porting guide §3); loans come from the `loans` table, not a `kind`.

**`verify.ts` tests:**
- rule 5: `assets.total − liabilities.total = netWorthPaise` for a fixture (paise-exact), with holdings + loans included.
- rule 1: classification — a `credit_card` lands in liabilities, a `broker` in assets valued by `holdingsValue` (not cash).
- rule 3: loan outstanding equals the latest `os_principal_paise` row for that loan.
- rule 6: group weights sum to 100 per classification (within rounding).
