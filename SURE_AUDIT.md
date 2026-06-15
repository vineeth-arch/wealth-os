# SURE_AUDIT.md — What Sure is and does

> Read-only audit of **`we-promise/sure`** (a community fork of the abandoned Maybe Finance), cloned and read at source. Code is ground truth; live screenshots were sanity checks only. Every load-bearing claim below was verified against the actual file (cited as `path:line` relative to the Sure repo root). This is the spec-precursor for a possible feature-parity build in wealth-os — understand first, decide second (`SURE_STRATEGY.md`), build third.

Audit date: 2026-06-15. Sure pinned at `main` (cloned fresh).

---

## 1. Stack + architecture

| Layer | Choice | Proof |
|---|---|---|
| Framework | **Ruby on Rails 8.1** | `Gemfile:6` (`gem "rails", "~> 8.1.0"`), Ruby 3.4.x |
| Frontend | **Hotwire** — Turbo + Stimulus, no SPA | `importmap-rails` (`Gemfile:17`), `turbo-rails`, `stimulus-rails`; Stimulus controllers in `app/javascript/controllers/**` |
| View layer | ERB + **ViewComponent** (Lookbook for previews) + Tailwind | `tailwindcss-rails` (`Gemfile:19`), `app/components/**`, `app/views/**` |
| Charts | **D3.js** via Stimulus controllers (custom, not a wrapper lib) | `app/javascript/controllers/sankey_chart_controller.js`, `time_series_chart_controller.js`, `donut_chart_controller.js` |
| DB | **PostgreSQL**, UUID PKs, multi-tenant by `family_id` | `db/schema.rb` (all major tables carry `family_id`) |
| Jobs | **Sidekiq + Redis**, AASM state machines, sidekiq-cron, sidekiq-unique-jobs | `app/models/sync.rb`, `app/jobs/**` |
| Money | **Custom `Money` value object** (no `money-rails`); BigDecimal amount + currency string | `lib/money.rb`, `app/models/concerns/monetizable.rb` (verified: no money gem in `Gemfile`) |
| Auth | Sessions + OmniAuth (Google/GitHub/SAML/OIDC), Doorkeeper OAuth, Pundit, WebAuthn, TOTP MFA | `config/routes.rb` (`/mfa`, `/oidc_account`, `sessions`), `Gemfile` |
| License | **AGPL-3.0** | `LICENSE:1` ("GNU AFFERO GENERAL PUBLIC LICENSE Version 3") |

**Money storage — the critical parity fact.** Sure does **not** use integer minor units. The `monetize` macro (`app/models/concerns/monetizable.rb:5-15`) wraps a stored value as `Money.new(value, currency)`; the underlying columns are `DECIMAL(19,4)` (e.g. `budgets.budgeted_spending`, `db/schema.rb:363,376-377`). So a Sure amount is **BigDecimal major units + a separate `currency` column**, with per-row multi-currency and FX via an `exchange_rates` table. wealth-os is **integer paise, single currency (INR)**. Both avoid float; the models differ (decimal-major+currency vs integer-minor). This matters for any port (see `SURE_GAP.md`).

**Ledger shape.** Sure uses an **Entry/entryable** pattern: `entries` is the dated/amount/currency ledger row, polymorphic to `Transaction`, `Trade`, or `Valuation` (`app/models/entry.rb`, `transaction.rb`, `trade.rb`). Accounts are a **`delegated_type :accountable`** polymorphism across 9 types: `Depository Investment Crypto Property Vehicle OtherAsset CreditCard Loan OtherLiability` (`app/models/concerns/accountable.rb:4`). Asset vs liability is a virtual column (`CreditCard/Loan/OtherLiability` → liability, else asset; `db/schema.rb` `accounts.classification`).

**Multi-tenant.** Everything is scoped to a `family` (households), with `users` belonging to a family, account sharing, and invitations — i.e. Sure is **multi-user by design**.

---

## 2. Route inventory (`config/routes.rb`)

Grouped; line numbers are the `resources`/`resource` declaration.

**Core finance**
- `resources :transactions` (`:388`) — index/new/create/show/update/destroy; nested `bulk_update`, `bulk_delete`, `split`, `transfer_match`, `pending_duplicate_merges`, category, attachments. The transaction ledger + filters.
- `resources :accounts` (`:447`, shallow) — index/new/show/destroy + member `sync`, `sparkline`, `toggle_active`, `set_default`, `sharing`, `unlink`. Plus per-accountable controllers (`credit_cards`, `loans`, `depositories`, `investments`, `cryptos`, `properties`, `vehicles`, …).
- `resources :categories` (`:288`) — CRUD + `merge`, `perform_merge`, `bootstrap`, `destroy_all`.
- `resources :rules` (`:433`) — CRUD + `confirm`, `apply`, `confirm_all`, `apply_all`, `destroy_all`, `clear_ai_cache`.
- `resources :tags` (`:279`), `resources :merchants`, `resources :transfers` (`:338`).
- `resources :budgets` (`:305`, `param: :month_year`) — index/show/edit/update + `copy_previous`, `picker`, nested `budget_categories`.
- `resources :reports` (`:297`, index only) + collection `update_preferences`, `export_transactions`, `google_sheets_instructions`, `print`, `picker`.
- `resources :goals` (`:312`) — savings goals + `goal_pledges`.
- `resources :imports` (`:344`) — full lifecycle (`upload`, `configuration`, `clean`, `confirm`, `rows`, `mappings`, `publish`, `revert`, `apply_template`).
- `resources :holdings` (`:361`), `resources :trades` (`:369`), `resources :valuations` (`:374`), `resources :securities` (`:498`, index).
- `root` → `pages#dashboard`.

**AI / assistant**
- `resources :chats` (`:187`) with nested `messages` (create) + `retry`. In-app financial chat.
- `POST /mcp` — in-repo **MCP server** (`app/controllers/mcp_controller.rb`).

**Provider sync (live feeds — the big out-of-scope surface)**
- `*_items` resources for **Plaid, SimpleFin, Enable Banking, Akahu, Brex, Mercury, Lunchflow, Coinbase, Binance, Kraken, Coinstats, IBKR, SnapTrade, Sophtron, Indexa Capital** (`config/routes.rb:7-160`), each with `preload_accounts`/`select_accounts`/`link_accounts`/`sync`.

**Account / settings / auth**
- `namespace :settings` (`:240`) — profile, preferences, appearance, hosting, billing, API keys, **MCP token** (`settings/mcp`), security.
- `/mfa`, `/sessions`, `/registration`, `/password_reset`, `/onboarding`, `/oidc_account`, `impersonation_sessions`, `invitations`, `invite_codes`, `family_exports`.

**API** — full `namespace :api { namespace :v1 }` (`:517+`) mirroring accounts, transactions, trades, holdings, transfers, valuations, budgets, categories, merchants, rules, securities, tags, imports, chats, syncs. API-key + OAuth auth; this is what powers Google-Sheets export and external MCP.

---

## 3. Feature inventory (concrete on the four vn cares about)

### 3a. Budgets  ★

**Data model.** `budgets` (`db/schema.rb:372`) is one row **per family per period** (unique on `family_id, start_date, end_date`), holding `budgeted_spending` (total) and `expected_income`, both `DECIMAL(19,4)` + `currency`. `budget_categories` (`db/schema.rb:360`) is the join, one per `(budget_id, category_id)`, each with its own `budgeted_spending`. Models: `app/models/budget.rb`, `app/models/budget_category.rb`. A budget is bootstrapped on demand: `Budget.find_or_bootstrap(family, start_date:, user:)` creates the row and syncs a `budget_category` for each family category.

**The math (verified in `app/models/budget.rb:223-308`):**
- `actual_spending = net_totals.total_net_expense` — pulled from `IncomeStatement` for the budget's period, **excluding** `Transaction::BUDGET_EXCLUDED_KINDS` = `funds_movement, one_time, cc_payment` (`app/models/transaction.rb:85`).
- per category: `budget_category_actual_spending = max(expense − refund, 0)` (`:231-236`) — refunds are income posted to the same category; never negative.
- `available_to_spend = budgeted_spending − actual_spending` (`:246`); negative = over budget.
- **"X% spent" / on-track** = `percent_of_budget_spent = (actual_spending / budgeted_spending) * 100` (`:250-254`).
- `overage_percent = available_to_spend.abs / actual_spending * 100` when over (`:256-260`).
- **Allocation (setup) side:** `allocated_spending = Σ budget_categories where !subcategory (parent only)` (`:265-267`); `available_to_allocate = budgeted_spending − allocated_spending` (`:275-277`); `allocated_percent` (`:269-273`). `allocations_valid?` requires `available_to_allocate >= 0 && allocated_spending > 0` (`:279`).
- **Subcategory inheritance:** a sub with `budgeted_spending` 0/nil **inherits** its parent's budget (`inherits_parent_budget?`); subs with their own limit "ring-fence" money out of the parent's shared pool (`app/models/budget_category.rb` `available_to_spend`).
- **Uncategorized** is a synthetic budget category (UUIDv5 of "uncategorized", no DB row) given `max(available_to_allocate, 0)`.
- `suggested_daily_spending = available_to_spend / days_remaining` (current month only).
- Income side mirrors spend: `actual_income`, `actual_income_percent`, `remaining_expected_income`, `surplus_percent`.
- `copy_previous` → `Budget#copy_from!(source)` copies totals + per-category allocations from the prior month.

**Controllers/views.** `budgets_controller.rb` (index→current month, show, edit totals, update, copy_previous, picker) + `budget_categories_controller.rb` (allocation form index, drill-down drawer show, per-category update via Turbo-stream auto-submit).

### 3b. Reports  ★

**Period engine.** `app/models/period.rb` defines a `PERIODS` table of ~12 presets (`last_day, current_week, last_7_days, current_month, last_month, last_30_days, last_90_days, current_year (YTD), last_365_days, last_5_years, last_10_years, all_time`) plus `Period.custom(start_date:, end_date:)`. Each carries `label`, `label_short`, `comparison_label`, and an auto `interval` (1 day/week/month by span). `Period.current_month_for(family)` respects custom fiscal-month start. The UI exposes **Monthly / Quarterly / YTD / Last 6 Months / Custom** (`app/views/reports/index.html.erb`).

**Metrics.** `app/models/income_statement.rb` (+ `income_statement/totals.rb`) computes per period: `income_totals`, `expense_totals`, `net_category_totals` (net expense/income per category with a `weight` = category ÷ classification total × 100), and `median_expense/avg_expense/median_income` for projections. `reports_controller.rb` assembles `@summary_metrics` (income, expenses, net savings, budget %), `@trends_data` (month-by-month income/expense/net/savings-rate), `@net_worth_metrics` (current, period change, assets vs liabilities), and `@investment_metrics` (portfolio value, return, contributions/withdrawals, top holdings, gains by tax treatment). **Period-over-period %** is `(current − previous) / previous * 100` against a same-length prior window (`reports_controller.rb`).

**Export path.** `GET /reports/export_transactions?...&format=csv` → `generate_transactions_csv` produces a **category × month matrix** (rows = categories grouped income/expense with subcategory rollup, columns = each month + Total) named `transactions_breakdown_<start>_to_<end>.csv`. Auth is dual-mode: session **or** `?api_key=` / `X-Api-Key` (scope `read`). **Google Sheets** is not a push integration — `google_sheets_instructions` hands the user an `=IMPORTDATA("…/export_transactions?…&api_key=KEY")` formula (`app/views/reports/google_sheets_instructions.html.erb`). XLSX/PDF exporters exist in code but are gated behind un-installed `caxlsx`/`prawn` gems (effectively pending). There is also a `print` view (Tufte-style, `layout: "print"`).

### 3c. Dashboard (Cashflow Sankey, Net Worth, Balance Sheet)  ★

Root → `pages_controller#dashboard` (`app/controllers/pages_controller.rb`). Sections are **user-reorderable + collapsible** (`Current.user.dashboard_section_order`, persisted via PATCH): `cashflow_sankey`, `outflows_donut`, `investment_summary`, `net_worth_chart`, `balance_sheet`.

- **Cashflow Sankey.** `build_cashflow_sankey_data(net_totals, income_totals, expense_totals, currency)` (`pages_controller.rb:148`, called `:24`) builds nodes (a central "Cash Flow" hub + income categories inbound + expense categories outbound + a Surplus/Deficit node) and weighted links `{source, target, value, color, percentage}`, netting per-subcategory direction. Rendered by `sankey_chart_controller.js` (D3 + `d3-sankey`): hover-highlight, click-to-zoom into subcategories, click-through to filtered transactions.
- **Net worth.** `app/models/balance_sheet.rb`: `net_worth = assets.total − liabilities.total` (`:37`); `net_worth_series(period:)` via `Balance::ChartSeriesBuilder` over historical (incl. disabled) accounts, cached. Rendered by `time_series_chart_controller.js` (D3 line + split gradient + tooltip).
- **Balance sheet.** Assets/liabilities split into `ClassificationGroup`s, each grouping accounts by accountable type, summing `converted_balance` (family currency, FX-applied), filtered by `included_in_finances?`. UI: a proportional stacked color bar + legend + expandable per-group account rows with sparklines (`app/views/pages/dashboard/_balance_sheet.html.erb`).
- **Outflows donut** (`donut_chart_controller.js`) — spend by category for the period, hover-swaps center total, click-through to filtered transactions.

### 3d. Transactions, Categories, Rules, Recurring  ★

**Sign convention (porting hazard).** Sure stores `entries.amount` as **negative = income/inflow, positive = expense/outflow** — verified at `app/models/entry.rb:271` (`amount.negative? ? "income" : "expense"`) and the search scopes `:111-112`. The UI inverts it for display (`-entry.amount_money`). This is the **inverse of wealth-os** (`+` = inflow), which its own CLAUDE.md flags ("no Sure-style inversion here"). Any port must flip sign.

**Transactions.** `transactions_controller#index` builds a `Transaction::Search` filter object (`app/controllers/transactions_controller.rb:15-20`) over `family` + accessible accounts; `search_params` (`:525-528`) cover **~10 dimensions**: `search` (name/notes), `start_date/end_date`, `amount + amount_operator (=/>/<)`, `accounts`, `categories`, `merchants`, `types`, `tags`, `status`, `active_accounts_only`. Active filters render as removable badge pills; cleared state persists in session. `Transaction` has `enum :kind` (`transaction.rb:69`: `standard, funds_movement, cc_payment, loan_payment, one_time, investment_contribution`); `TRANSFER_KINDS` and `BUDGET_EXCLUDED_KINDS` (`:85`) drive analytics exclusion. Each row is an `entry` (date/amount/currency/name) + a `transaction` entryable (category/merchant/tags); `excluded`/`user_modified`/`import_locked` + a `locked_attributes` JSONB protect manual edits from provider re-sync.
- **Bulk edit** (`transactions/bulk_updates_controller.rb` + `Entry.bulk_update!`): multi-select toolbar updates date/name/category/merchant/notes/tags across selected entries (skips split parents; tags only on explicit opt-in).
- **Splits** (`Transaction::Splittable`): `entry.split!` marks the parent `excluded` and creates `parent_entry_id` children that sum to the parent; `unsplit!` reverses.
- **Transfer matching** (`Transaction::Transferable`): paired inflow/outflow across accounts, candidate-matched within a date window; surfaced as a "Transfer Match".
- **Pending/posted reconciliation**: provider pending flags live in `extra` JSONB (`PENDING_PROVIDERS`); `Entry.reconcile_pending_duplicates` auto-excludes exact same-day matches and stores fuzzy matches as a `potential_posted_match` suggestion; `merge_with_duplicate!` merges (date+category from pending, name+merchant from posted) or the user dismisses.

**Categories & Rules.** `app/models/category.rb` — 2-level parent/subcategory tree, hex color (sub inherits parent color), `lucide_icon`, `bootstrap!` defaults, and `Category::Merger` (`merge`/`perform_merge` reassigns txns then destroys sources). `app/models/rule.rb` (+ `rule/condition`, `rule/action`, registry executors) — a **conditions→actions pipeline**: conditions match name/type/category/merchant/account/amount with compound AND/OR (one level); actions `set_transaction_category/merchant/name/tags`, `exclude`, `set_as_transfer_or_payment`, and AI ones (`auto_categorize`, `auto_detect_merchants`). Apply is async (`apply`/`apply_all` jobs) with a `confirm` preview that estimates LLM cost. The **Quick Categorize wizard** groups uncategorized non-transfer txns by name prefix and one-click creates a rule per group (`Rule.create_from_grouping`).

**Recurring/Upcoming.** `app/models/recurring_transaction.rb` + `recurring_transactions` table (`db/schema.rb:1503`) — manual ("Mark as Recurring") or auto-detected (`identify_patterns_for!` after sync, debounced); fixed amount or, for manual, **variance-tracked** `expected_amount_min/max/avg` updated incrementally (Welford). `next_expected_date` = `expected_day_of_month` projected forward (month-end fallback). `projected_entry` renders forward-looking upcoming items (shown in an "Upcoming" tab, next ~10 days in the list). Supports recurring transfers (source/destination accounts); stale rows auto-deactivate (6 mo manual / 2 mo auto).

**Permission tiers** (multi-user): owner/full_control = full edit; read_write = annotate only (category/tags/merchant/notes); read_only = none — enforced in `permitted_entry_params`.

### 3e. Everything else (briefly — mostly out of scope for an import-only app)

- **Accounts data model & import** — see `SURE_GAP.md`/§1: 9 accountable types, daily `balances` table, `valuations`, opening-balance manager; **import pipeline** (`app/models/import.rb`) with 11 import classes (Transaction/Trade/Account/Mint/Actual/Category/Rule/Merchant/**Pdf (AI)**/Qif/Sure-NDJSON), CSV size 10 MB / PDF 25 MB, date+number-format auto-detection, signage convention, encoding fallback, duplicate detection (date+amount+currency+name), and a revert that cascade-deletes the import's accounts+entries.
- **Provider sync** — 15 live providers (Plaid, SimpleFin, crypto exchanges, IBKR, SnapTrade…) via a polymorphic `Sync` AASM state machine + Sidekiq + webhooks. The live-feed engine wealth-os deliberately omits.
- **Multi-currency** — `exchange_rates` table + `ExchangeRate::Importer` (Yahoo/Twelve Data, LOCF gap-fill); `Money#exchange_to` converts to family currency in reports/net-worth.
- **AI assistant + MCP** — `Chat`/`Message`/`ToolCall`; providers Anthropic (preferred, `claude-*`) → OpenAI fallback; an `Assistant` with **9 function tools** (GetTransactions/Accounts/Holdings/BalanceSheet/IncomeStatement/Budget, ImportBankStatement, SearchFamilyFiles, CreateGoal). The **same 9 tools** are exposed over an in-repo JSON-RPC **MCP server** at `POST /mcp` (`app/controllers/mcp_controller.rb`), Bearer-token auth. Financial summaries (amounts/categories) go to the LLM; the assistant is read-mostly + a few actions.
- **Savings goals** (`app/models/goal.rb`), **family/multi-user + invitations**, **vault/vector search**, **data enrichment** (AI merchant/category) — all family-scoped extras.

---

## 4. UX inventory of the 4 screens

Enough that a future build can match the feel without re-deriving it.

**Global shell** (`app/views/layouts/application.html.erb`): left **icon rail** (~84px) → collapsible **left sidebar** (≤320px) holding the **account tree** → main content → optional right **AI chat** panel (≤400px). The account tree (`app/views/accounts/_account_sidebar_tabs.html.erb`) has **Assets / Debts / All** tabs (active tab stored in session); each tab lists `accountable_group` disclosures (e.g. Checking, Credit Cards) with a group total + lazy turbo-frame **sparkline**, expanding to per-account rows (logo, name, sync pulse, subtype, balance, sparkline) and a "New …" button. Privacy-blur toggle + sync `animate-pulse` are global affordances.

**Budgets.** Two-step wizard then a show page: a center **donut ring** (`donut-chart` Stimulus; segments per parent category by actual spend + an "unused" segment; center text swaps on hover/click) beside a budgeted-vs-actual summary, then category rows below split into **Over budget** / **On track** sections (filter pills via `budget_filter_controller.js`). Each row: colored category icon, name, status badge (Over/Warning/Good), a progress bar (destructive/warning/success), and Spent | Budgeted [shared badge] | suggested-daily | Remaining/Overage. Allocation step shows a top **allocation-progress bar** (red if over-allocated) and per-category number inputs that **auto-submit on blur** (`auto-submit-form` + `preserve-focus`). Month nav: prev/next arrows + calendar popover + Today.

**Reports.** Header with **Print**. A **period switcher**: segmented tabs Monthly | Quarterly | YTD | Last 6 Months | Custom; Custom reveals two auto-submitting date inputs; prev/next arrows + a popover **period picker** (month grid / quarter grid / year list, future periods disabled). Body is a stack of **collapsible, drag-reorderable sections** (`reports-sortable` + `reports-section`, persisted): Summary (4 metric cards with Δ% vs prior period) → Net Worth → Trends (monthly table + averages) → Investment Performance/Flows → Transactions Breakdown (income/expense tables with subcategory rollup, sort by amount/count, **Export CSV** + **Google Sheets** buttons).

**Dashboard.** Period picker at top (turbo-frame reload). Sections are collapsible + drag-reorderable (mouse/touch/keyboard, persisted to user prefs): **Cashflow Sankey** (h-96, expand-to-fullscreen, "Add Transaction" empty state) → **Outflows donut** (donut + category list, click-through to filtered txns) → **Investment summary** (portfolio value, unrealized gain, top-5 holdings) → **Net-worth line chart** (big value + trend Δ + comparison label) → **Balance sheet** (stacked color bar + legend + expandable asset/liability groups with sparklines). All charts are bespoke D3 with hover tooltips and click-to-filter.

**Transactions.** A filter bar (search, date range, amount, category/account/merchant/tag/type) over a dense list. Rows show date, account, name + merchant, **inline category chip** (editable), amount, cleared/locked affordances; **bulk-select** toolbar drives `bulk_update`/`bulk_delete`. Splits and transfer-matching are inline; pending+posted duplicates surface a merge prompt. Recurring/upcoming items render as projected entries.

---

## 5. One-paragraph synthesis

Sure is a **mature, multi-tenant, live-sync personal-finance platform**: Rails 8.1 + Hotwire + bespoke D3 charts, a polymorphic Entry/Account ledger in **decimal-major-units + multi-currency**, AGPL-3.0. Its budget engine (per-family/per-month targets with parent/sub allocation + on-track math), its report engine (preset+custom periods, P&L/net-worth/investment metrics, CSV+IMPORTDATA export), and its dashboard (D3 cashflow Sankey, net-worth series, asset/liability balance sheet) are exactly the four surfaces vn wants — and they are genuinely polished. Much of the rest of Sure (15 live provider feeds, multi-user families, the AI assistant + MCP, goals, vault) is **out of scope for an import-only app** and should not be mistaken for a gap. The feature-by-feature comparison and the build effort are in `SURE_GAP.md`; the path recommendation is in `SURE_STRATEGY.md`.
