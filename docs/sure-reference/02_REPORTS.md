# 02 — Reports

> Read `00_PORTING_GUIDE.md` first. Restated in wealth-os terms (paise, `+`=inflow, `user_id`, 276 taxonomy). Sure pointers `path:line` at `b0b0dc86…`, re-read this run.

## 1. What it is

A single period-driven page: pick a period (Monthly / Quarterly / YTD / Last 6 Months / Custom), see income / expenses / net savings with period-over-period deltas, a month-by-month trend, net worth, investment performance, and a category × month breakdown — exportable to CSV (and a Google-Sheets `IMPORTDATA` recipe). Read-only; no data is written.

## 2. Sure data model

Reports own **no tables** — they aggregate `entries`/`transactions` over a period. Two period concepts (don't conflate):
- **`Period`** (`app/models/period.rb`) — the analytics preset/value object; a `PERIODS` table (`:12-95`) of 12 presets + `Period.custom(start_date:, end_date:)` (`:from_key:102-110`). Used app-wide (dashboard too).
- **Reports `@period_type`** (`app/controllers/reports_controller.rb` `setup_report_data:101`) — the *reports page's* switcher: `monthly | quarterly | ytd | last_6_months | custom`. The controller resolves it to a concrete `@period` (via `Period.custom` with computed ranges) and a `@previous_period`.

`IncomeStatement` (`app/models/income_statement.rb`) is the metrics engine.

## 3. The math / algorithm (numbered)

**Period engine:**
1. **Preset table** (`period.rb:12-95`): each preset = `{ date_range: -> [start,end], label, label_short, comparison_label }`. The 12 presets: `last_day(1D) · current_week(WTD) · last_7_days(7D) · current_month(MTD) · last_month(LM) · last_30_days(30D) · last_90_days(90D) · current_year(YTD) · last_365_days(365D) · last_5_years(5Y) · last_10_years(10Y) · all_time(All)`. `all_time` starts at the oldest entry date (fallback 5y).
2. **Reports switcher** resolves `@period_type` → `{start_date, end_date}`: `monthly`=current/selected month; `quarterly`=current quarter; `ytd`=Jan 1→today; `last_6_months`; `custom`=user range.
3. **Previous (comparison) window** (`build_previous_period:272-278`): `duration = end − start (days)`; `previous_end = start − 1 day`; `previous_start = previous_end − duration`. A **same-length window immediately before** the current one.

**Metrics** (paise, `+`=inflow):
4. **`income_totals` / `expense_totals`** (`income_statement.rb:32-45`) — per-period totals, **excluding pending** (`:18`; n/a for wealth-os — all imported txns are posted) and the porting-guide exclusion set. → wealth-os income = `Σ amount_paise>0`; spend = `Σ(−amount_paise)` for `amount_paise<0`, parent ∈ `SPEND_CLASSES`.
5. **`net_category_totals`** (`income_statement.rb:47-108`) — **at parent level** (subcategories rejected, `:66-67`): for each parent, `net = expense_total − income_total`; `net>0` ⇒ a net-expense category (amount `net`), `net<0` ⇒ net-income category (amount `|net|`). Then **`weight = category_net / total_net_for_type × 100`** (`:92,97`).
6. **Summary metrics** (`build_summary_metrics:280-304`): `net_savings = income − expenses`; `income_change` / `expense_change` via rule 7; `budget_percent` via rule 8.
7. **Period-over-period %** (`calculate_percentage_change:306-310`): `previous == 0 ? 0 : (current − previous) / previous × 100`, rounded 1dp.
8. **Budget performance** (`calculate_budget_performance:312-322`): current month only — `budget.actual_spending / budget.allocated_spending × 100`. ⚠ denominator is **`allocated_spending`** (rule 6 of `01_BUDGETS.md`), not `budgeted_spending`.
9. **Trends** (`build_trends_data:324-356`): iterate each month in the period; per month `{ income = income_totals.total, expenses = expense_totals.total, net = income − expenses, is_current_month }`. **Savings-rate** is derived in the view (`print.html.erb:156`): `income > 0 ? round(net / income × 100) : 0`.
10. **Net-worth metrics** (`build_net_worth_metrics:573-604`): `current_net_worth = balance_sheet.net_worth`, `total_assets`, `total_liabilities`, `trend` (period change from `net_worth_series(period:).trend`), and `asset_groups`/`liability_groups` (per-group totals, zero-balance filtered). **Investment metrics** (`build_investment_metrics:463-481`): `portfolio_value`, `unrealized_trend`, `period_return_trend`, `period_contributions`, `period_withdrawals`, `top_holdings(limit: 5)`, and `gains_by_tax_treatment` (`:483-571`: per `taxable | tax_deferred | tax_exempt | tax_advantaged`, `unrealized_gain` + `realized_gain` = `total_gain`). → wealth-os assembles these from `accountBalances`/`holdingsValue` + the `realized_gain_*` tables.

**Export — category × month matrix:**
11. **`build_monthly_breakdown_for_export`** (`:689-757`): build the month list (`start.beginning_of_month` stepping `next_month` to `end.end_of_month`); pull period txns **excluding `BUDGET_EXCLUDED_KINDS`** (`:707`); per txn — `type = amount>0 ? expense : income` (Sure sign), `category_name or "Uncategorized"`, `month_key = date.beginning_of_month`, `value = |amount|` (FX→family currency); group by `[category_name, type]` into `{ months: {month→sum}, total }`; sort each type by `total` desc.
12. **`generate_transactions_csv`** (`:759+`): header `["Category", <"%b %Y" per month…>, "Total"]`; an `INCOME` section header row, then one row per income category `[name, <per-month formatted>, …, total]`; then an `EXPENSES` section the same way. (XLSX/PDF generators exist but are gated behind un-installed `caxlsx`/`prawn` gems — effectively pending.)
13. **Google Sheets** (`google_sheets_instructions` action + view): not a push — hands the user `=IMPORTDATA(".../reports/export_transactions?…&api_key=KEY")`. Needs a **read-scoped API token** on the export URL.
14. **Series granularity** (`period.rb:174-182` `interval`): `end > start + 5y → "1 month"`; `end > start + 1y → "1 week"`; else `"1 day"`. Drives the resolution of trend/net-worth series.
15. **Synthetic categories in the breakdown** (`reports_controller.rb`): no-category transactions key `[:uncategorized, type]` (`:420`); trades with no category key `[:other_investments, type]` (`:417`) — symbol atoms, distinct from integer category ids. → wealth-os: `Uncategorized Review` leaf; "other investments" has no analog (holdings live outside the txn ledger).
16. **XLSX/PDF + print** (`reports_controller.rb`): the XLSX (`generate_transactions_xlsx:831`, needs `caxlsx`) and PDF (`generate_transactions_pdf:909`, needs `prawn`) generators exist but are **commented out / gem-gated** (`:54-69`) — effectively pending. The `print` action (`:18-22`) renders `layout: "print"` (a minimal Tufte layout that auto-fires `window.print()`).

## 4. UI/UX shape

`app/views/reports/index.html.erb`:
- **Period switcher**: segmented tabs Monthly | Quarterly | YTD | Last 6 Months | Custom; Custom reveals two auto-submitting date inputs; prev/next arrows + a popover **period picker** (month grid / quarter grid / year list, future periods disabled).
- **Body**: a stack of **collapsible, drag-reorderable sections** (persisted to user prefs): Summary (4 cards: Income, Expenses, Net savings, Budget %, each with Δ% vs prior) → Net Worth → Trends (monthly table + averages) → Investment Performance / Flows → Transactions Breakdown (income/expense tables with subcategory rollup, sort by amount/count, **Export CSV** + **Google Sheets** buttons).
- A **Print** button → a Tufte-style print layout.

## 5. ★ wealth-os build notes

**Module `src/lib/period.ts`** (pure): port the preset table (rule 1) as a `PERIODS` map → `{ key, label, labelShort, comparisonLabel, range(): [startISO, endISO] }`, plus `customPeriod(start, end)`, the reports `periodType` resolver (rule 2), and `previousWindow(period)` (rule 3). This abstraction is reusable by the dashboard too (the current app is **month-only** via `src/components/month-select.tsx` + `?month=YYYY-MM`).

**Reuse, don't re-derive:**
- per-category / per-parent period aggregation → `src/lib/drilldown.ts` + `src/lib/halan.ts` (`bucketTotals`, `monthlyCashFlow`); the net-per-category logic (rule 5) mirrors `halan.ts`.
- the spend predicate + sign → `SPEND_CLASSES` / `halan.ts` (porting guide §2, §6).
- the parent/leaf map → `parentByCatId` (`src/lib/server/load-drill.ts`); never hardcode category strings.

**Routes & consolidation:**
- New `/reports` App Router page (`force-dynamic`).
- **Recommendation: Reports absorbs `/insights`** — `/insights/[metric]` is today's per-metric drill; a period-driven Reports page is the superset. Keep `/buckets/[NN]` (bucket drill) and `/compass` (health checks) as-is.
- **CSV export route** (`/api/reports/export` or a route handler) producing the rule 11–12 matrix. **Recommend CSV-only for v1**; skip the live Google-Sheets `IMPORTDATA` path unless wanted — it requires exposing a read-scoped bearer-token URL, a real surface-area/security decision for a single-user app.

**`verify.ts` tests:**
- rule 3: `previousWindow` of a 30-day period is the immediately-preceding 30 days (exact ISO bounds).
- rule 7: P/P% with `previous = 0` returns 0; otherwise matches `(cur−prev)/prev×100` to 1dp.
- rule 5: `weight` over a fixture sums to 100 per type (within rounding).
- rules 11–12: CSV matrix on a fixture month — per-category row sums equal the period's spend-by-bucket totals from `halan.ts` (paise-exact), months columns + Total reconcile.
