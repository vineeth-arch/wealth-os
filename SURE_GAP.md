# SURE_GAP.md — Sure vs wealth-os, feature by feature

> Companion to `SURE_AUDIT.md`. Honest comparison of every Sure capability against wealth-os **as it exists today**, with the proving wealth-os file and a rough effort to reach parity **in Next.js**. The point is to scope a possible build precisely — it is the **MISSING/PARTIAL rows**, not "everything." Several Sure features are deliberately **out of scope for an import-only single-user app** and are listed separately so they are not mistaken for gaps.

**Status legend:** `HAVE` = wealth-os already does this (parity or better) · `PARTIAL` = a piece exists, not the full feature · `MISSING` = absent.
**Effort legend (Next.js build):** `S` = a few days (new screen/widget reusing existing data + components) · `M` = ~1–2 weeks (new aggregation + UI, simple/no migration) · `L` = ~3–6 weeks (new schema + engine + polished UI) · `XL` = months / architecturally heavy.

---

## A. Budgets  ★ (the headline gap)

| Feature | Sure (how) | wealth-os today | Effort | Notes |
|---|---|---|---|---|
| Per-category / per-month budget targets | `budgets` + `budget_categories` tables; `Budget.find_or_bootstrap` | **MISSING** — no `budgets` table; zero `budget` matches in code/schema (`supabase/migrations/*`) | **L** | New migration + targets editor. The hard part is *not* the math. |
| Actual-vs-budget ("X% spent", on track) | `percent_of_budget_spent = actual/budgeted*100`; `actual_spending` from `IncomeStatement` excl. transfers | **MISSING** | **S** | Actuals are essentially **free**: `bucketTotals()`/`monthlyCashFlow()` in `src/lib/halan.ts` already sum spend per parent per month. Just divide by target. |
| Allocation model (allocated vs available-to-allocate) | `allocated_spending` (parents only), `available_to_allocate` | **MISSING** | **S–M** | Pure arithmetic over the targets table. |
| Parent/sub budget inheritance + ring-fencing | `inherits_parent_budget?`, shared pool math | **MISSING** | **M** | Maps cleanly onto the Halan 15-parent / 261-leaf tree (`src/lib/seed-data.ts`). |
| Budget ring / donut + per-category rows UX | `donut-chart` Stimulus + over/on-track sections | **MISSING** | **M** | Recharts can do the ring; rows reuse `category-select` + existing bar patterns. |
| Copy previous month | `copy_previous` → `Budget#copy_from!` | **MISSING** | **S** | |
| Month navigation (prev/next/picker) | `param: :month_year`, calendar popover | **PARTIAL** | **S** | `src/components/month-select.tsx` already drives `?month=` on insights/buckets. |
| Suggested daily spend, income-vs-expected | `suggested_daily_spending`, `surplus_percent` | **MISSING** | **S** | Nice-to-have arithmetic. |

**Budgets verdict:** genuinely MISSING end-to-end, but **cheaper than it looks** — wealth-os already owns the spend-aggregation engine and the taxonomy. The work is one migration + a targets UI + a ring; the engine is a thin layer on `halan.ts`. Total ≈ **L**.

---

## B. Reports  ★

| Feature | Sure (how) | wealth-os today | Effort | Notes |
|---|---|---|---|---|
| Dedicated Reports page | `reports#index`, reorderable sections | **PARTIAL** | **M** | Equivalent value is spread across `/dashboard`, `/insights/[metric]`, `/buckets/[NN]`, `/compass` — but there is no single period-driven report. |
| Period engine: Monthly/Quarterly/YTD/Last-6-mo/Custom | `app/models/period.rb` (12 presets + custom) | **PARTIAL** | **M** | wealth-os is **month-only** today (`month-select.tsx`, `?month=YYYY-MM`). Generalize to date ranges. |
| Period-over-period % change | `(cur−prev)/prev*100`, same-length prior window | **MISSING** | **S** | Compass has trend sparklines but not generic P/P deltas. |
| P&L by category w/ subcategory rollup + weights | `IncomeStatement#net_category_totals` | **PARTIAL** | **S–M** | `drilldown.ts` already aggregates by parent/leaf; just present per-period. |
| Net-worth + assets/liabilities in report | `balance_sheet` metrics | **PARTIAL** | **M** | Net worth exists (`halan.ts accountBalances`); see Balance Sheet row in §C. |
| Investment performance / flows | `investment_statement` (return, contributions, top holdings, gains by tax-treatment) | **PARTIAL** | **M** | wealth-os has holdings present-value (`holdingsValue`) + realized capital-gains (`realized_gain_*`); not assembled into a report. |
| CSV export | `export_transactions` → category×month CSV | **MISSING** | **S** | No export anywhere in wealth-os today. |
| Google Sheets (live) | `=IMPORTDATA(export_url?api_key=…)` | **MISSING** | **M** | Needs a token-authed CSV endpoint. **Security note:** in a single-user import-only app this means exposing a bearer-token URL; weigh before building. |
| Print view | `reports/print`, `layout: print` | **MISSING** | **S** | |

**Reports verdict:** the *data* mostly exists; what's missing is a **period abstraction + a unified reports surface + export**. Total ≈ **M–L**.

---

## C. Dashboard / Cashflow / Balance Sheet  ★

| Feature | Sure (how) | wealth-os today | Effort | Notes |
|---|---|---|---|---|
| Net-worth headline | `balance_sheet.net_worth` | **HAVE** | — | `src/lib/halan.ts accountBalances()`, tile in `src/app/(app)/dashboard/page.tsx`. |
| Net-worth historical line | `net_worth_series` (D3 line) | **PARTIAL** | **S–M** | Compass shows a net-worth trend; no dedicated dashboard line chart. `charts.tsx` already has `MetricTrendChart`. |
| Cashflow visualization | **D3 Sankey** (`build_cashflow_sankey_data`) | **PARTIAL** | **M** | wealth-os has monthly income/spend/invest **bars** (`CashFlowChart` in `src/components/charts.tsx`); Sankey is a new viz. Data is free from `bucketTotals()`. |
| Balance sheet: assets vs liabilities breakdown | `ClassificationGroup` (asset/liability, grouped, weighted bar) | **MISSING** | **M** | Net worth is a single sum today. Account `kind` (`bank/credit_card/broker/asset_snapshot`) makes asset/liability classification trivial; loans (`loans` table) add the debt side. |
| Spend-by-category donut | `outflows_donut` (D3) | **HAVE** (as bars) | **S** | `src/components/dashboard/spend-buckets.tsx` shows per-parent spend bars + leakage; donut is cosmetic. |
| Investment summary widget | `investment_statement` | **PARTIAL** | **S** | Holdings present-value + coverage already on the dashboard. |
| Section collapse / drag-reorder + per-user layout | `dashboard_section_order`, Stimulus sortable | **MISSING** | **S** | Polish, not core. |
| Click-through chart → filtered transactions | every D3 chart links to filtered txns | **PARTIAL** | **S** | wealth-os drills number→`/insights/[metric]` & `/buckets/[NN]`; equivalent intent, different mechanic. |

**Dashboard verdict:** wealth-os is closest to parity here. Real gaps: **Sankey** and the **asset/liability balance-sheet widget**. Total ≈ **M**.

---

## D. Transactions / Categories / Rules / Recurring  ★

| Feature | Sure (how) | wealth-os today | Effort | Notes |
|---|---|---|---|---|
| Transaction list + categorization | Entry/entryable list, inline category | **HAVE** | — | `src/components/review-table.tsx` (inline category edit, optimistic save). |
| Filters | ~10 dims (text/date/amount/account/category/merchant/type/tag/status) | **PARTIAL** | **M** | wealth-os has source + category + account filters only. No text search / date / amount / tag. |
| Full-text search across descriptions | `Transaction::Search` on name/notes | **MISSING** | **M** | Review grid capped at 300 rows by design; deeper queries go to Supabase SQL today. |
| Bulk edit | `bulk_update` / `bulk_delete` + multi-select | **MISSING** | **M** | One-at-a-time today. |
| Categories taxonomy | flexible 2-level, `bootstrap!` ~22 defaults | **HAVE (richer)** | — | wealth-os ships the **276-name Halan taxonomy** (15 parents + 261 leaves), `src/lib/seed-data.ts`. This is a wealth-os *advantage*. |
| Rules engine | conditions→actions pipeline, compound AND/OR, multi-action, AI actions | **PARTIAL** | **M** | wealth-os has priority-ordered vendor-text→category rules w/ reorder + hit-count (`src/lib/ingest/rules.ts`, `src/components/rules-manager.tsx`). Adequate; Sure's compound conditions + multi-action are richer. |
| Quick Categorize wizard | group uncategorized by name → 1-click rule | **PARTIAL** | **S** | wealth-os has AI-suggest + "re-run rules" (`/api/rules/apply`); not the grouping wizard. |
| Splits | parent `excluded` + `parent_entry_id` children | **MISSING** | **M** | No split concept; one statement row = one txn. |
| Transfer matching (inter-account) | paired inflow/outflow, candidate match | **PARTIAL** | **M** | wealth-os neutralizes transfers via parent-10 + GPay self-transfer tokens (enrichment), but no UI pairing of two account rows. |
| Pending/posted reconciliation + merge | provider pending flags, fuzzy duplicate merge | **N/A (import-only)** | — | Statements are posted; idempotency is by `content_hash` dedup (`/api/commit`). Not a gap. |
| Recurring / upcoming | `recurring_transactions` + auto-detect + variance + projected entries | **MISSING** | **L** | No recurring table. New schema + pattern detection + projection UI. The clearest "missing engine" after Budgets. |
| Attachments on txns | up to 10 files/txn | **MISSING** | **S–M** | Niche for an import-only ledger. |

**Transactions verdict:** the core (list + inline categorization + rules) is **HAVE**; taxonomy is **better**. Gaps are **search, bulk edit, richer filters, splits, transfer-pairing UI, and recurring/upcoming**.

---

## E. Accounts / Import / Money / Holdings (supporting)

| Feature | Sure (how) | wealth-os today | Effort | Notes |
|---|---|---|---|---|
| Multiple accounts + net-worth anchor | 9 accountable types, `balances`, valuations | **HAVE** | — | `accounts` table w/ `kind` + `anchor_balance_paise`/`anchor_date`; `halan.ts`. |
| Money model | `DECIMAL(19,4)` BigDecimal + currency + FX | **HAVE (single-currency)** | — | wealth-os = **integer paise, INR**. Different model; both float-free. Multi-currency = out of scope (§F). |
| Import pipeline | generic CSV/QIF + **AI PDF**, column mapping, format detection, revert | **HAVE (different philosophy)** | — | wealth-os ships **specialized paise-exact Indian bank/CC/broker parsers** + reconciliation + content-hash dedup (`src/lib/ingest/`). Richer for Indian statements; Sure richer for arbitrary CSV mapping. |
| Holdings / investments | `securities`/`trades`/`holdings` + providers | **HAVE** | — | Zerodha/Upstox import → `instruments`/`holdings_snapshots`/`prices`; present-value via `holdingsValue()`. |
| Loans | `Loan` accountable | **HAVE (richer)** | — | `loans` + `loan_schedule_rows`: amortization, prepayment what-ifs, imported schedules. |
| Capital gains | investment tax-treatment metrics | **HAVE (richer for India)** | — | `realized_gain_segments`/`realized_gain_lots`, STCG/LTCG. |
| India tax calculators | — | **HAVE (Sure has none)** | — | `/calculators`: regime, §87A, FIRE, HLV, SIP (`src/components/calculators/*`). wealth-os advantage. |

---

## F. Out of scope for an import-only single-user app (flag — NOT gaps)

These are real Sure features, but building them would contradict wealth-os's design (import-only, single-user, no money to LLM). Do **not** count them in a parity scope.

| Sure feature | Why out of scope |
|---|---|
| **Live provider sync** — Plaid + 14 others (SimpleFin, crypto, IBKR, SnapTrade…), `Sync` AASM + Sidekiq + webhooks | wealth-os is **import-only** by deliberate design (CLAUDE.md). Replacing parsing with live feeds is a different product. |
| **Multi-user / families / invitations / account sharing / permission tiers** | wealth-os is **single-user** with per-user RLS. |
| **AI assistant + in-repo MCP server** (9 financial tools, Anthropic→OpenAI) | wealth-os hard invariant: **no money value ever passes through an LLM**; AI may only clean descriptions / *suggest* a category. Sure sends balances/amounts/categories to the LLM — adopting it would **violate** that invariant. AI assist in wealth-os is deferred (README). |
| **Multi-currency + FX** (`exchange_rates`, `Money#exchange_to`) | wealth-os is INR-only, integer paise. |
| **Savings goals** (`Goal`, pledges, projections) | Not one of the 4 target screens; wealth-os tracks goals lightly in the profile checklist. A possible future want, not a Sure-parity gap. |
| **Vault / vector search / AI data-enrichment** | Out of product scope; enrichment in wealth-os is deterministic (Money Manager / GPay matchers). |

---

## G. Money-model & porting notes

- **No float either side** — Sure: BigDecimal `DECIMAL(19,4)` + currency string + FX; wealth-os: **integer paise, INR**. A port keeps wealth-os's paise model; budget targets become `bigint` paise columns.
- **Sign convention is inverted** — Sure stores `negative = income, positive = expense` (`entry.rb:271`); wealth-os stores `+ = inflow, − = outflow`. Any logic lifted from Sure must flip sign. (wealth-os CLAUDE.md already anticipates "no Sure-style inversion here.")
- **Budget actuals are nearly free** — Sure derives them from `IncomeStatement`; wealth-os already has the identical aggregation in `src/lib/halan.ts` (`bucketTotals`, `monthlyCashFlow`, `SPEND_CLASSES` excludes transfers/invest/assets/review, mirroring `BUDGET_EXCLUDED_KINDS`). This is why Budgets is L-not-XL.
- **Taxonomy is a wealth-os strength** — the 276-name Halan tree already provides the parent/leaf hierarchy that Sure's budgets/reports assume.

---

## H. Effort roll-up (the parity scope, MISSING/PARTIAL only)

| Bundle | Rows it covers | Effort |
|---|---|---|
| **Budgets** (schema + targets UI + ring + on-track engine) | §A | **L** |
| **Reports** (period abstraction + unified page + CSV/print export) | §B | **M–L** |
| **Dashboard widgets** (Sankey + asset/liability balance sheet + net-worth line) | §C | **M** |
| **Transactions polish** (search, richer filters, bulk edit) | §D (filters/search/bulk) | **M** |
| **Recurring / upcoming** (schema + detection + projection UI) | §D (recurring) | **L** |
| **Splits + transfer-pairing UI** | §D (splits/transfers) | **M** |

Everything in §F is **excluded**. Everything in §E is already **HAVE**. The realistic "make wealth-os feel like Sure for the 4 screens" scope is **Budgets + Reports + the two dashboard widgets + transactions polish** — roughly **L + M-L + M + M**. Recurring and splits are follow-ons. See `SURE_STRATEGY.md` for whether to build this at all.
