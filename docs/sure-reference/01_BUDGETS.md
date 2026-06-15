# 01 — Budgets

> Read `00_PORTING_GUIDE.md` first. All amounts below are restated in **wealth-os terms**: integer paise, `+`=inflow, `user_id`, the 276 Halan taxonomy. Sure pointers are `path:line` at commit `b0b0dc86…`, re-read this run.

## 1. What it is

A budget is **one row per user per period** (a calendar month in practice) holding a total spend target and an expected income. Each budget fans out into **per-category targets**. The screen shows a ring of actual-vs-target with per-category over/on-track rows. There is **no separate "actuals" store** — actual spending is derived live from categorized transactions for the period.

## 2. Sure data model

**`budgets`** — `db/schema.rb:372`; model `app/models/budget.rb`.
- `family_id`, `start_date`, `end_date`, `budgeted_spending DECIMAL(19,4)`, `expected_income DECIMAL(19,4)`, `currency`, timestamps.
- Unique index on `(family_id, start_date, end_date)` → exactly one budget per family per period.
- Bootstrapped on demand: `Budget.find_or_bootstrap(family, start_date:, user:)` (`budget.rb:47-66`) `find_or_create_by!` the row, then `sync_budget_categories` (`:92-109`) **creates a `budget_category` (with `budgeted_spending: 0`) for every family category that lacks one and destroys any orphaned ones** — so the join always mirrors the live taxonomy.

**`budget_categories`** — `db/schema.rb:360`; model `app/models/budget_category.rb`.
- `budget_id`, `category_id`, `budgeted_spending DECIMAL(19,4)`, `currency`, timestamps.
- Unique index on `(budget_id, category_id)`.
- `Group.for(...)` (`budget_category.rb:17-23`) builds the parent→[subcategories] tree for display.

## 3. The math / algorithm (numbered — cite these in the build prompt)

Sign already handled: Sure "expense" = positive amount; in wealth-os "spend" = magnitude of **outflows** (`amount_paise < 0`) whose category parent ∈ `SPEND_CLASSES` (`src/lib/halan.ts:20`). See porting guide §6 for the exclusion set and the **invest-in-budget decision**.

**Budget-level (paise):**
1. **`actual_spending`** (`budget.rb:227-229` → `net_totals.total_net_expense`) = total net spend for the period, excluding the porting-guide exclusion set. → wealth-os: `Σ (−amount_paise)` over period txns with parent ∈ `SPEND_CLASSES`, **netted** per category by rule 2.
2. **Per-category actual** (`budget.rb:231-236`) = `max(expense − refund, 0)`. → paise: `expense = Σ(−amount_paise)` outflows in that category; `refund = Σ(amount_paise)` inflows in that category; `actual = max(expense − refund, 0)` (never negative). This mirrors Sure's `net_category_totals` net (`income_statement.rb:78-85`).
3. **`available_to_spend`** (`budget.rb:246-248`) = `budgeted_spending − actual_spending`. Negative ⇒ over budget.
4. **`percent_of_budget_spent`** (`budget.rb:250-254`) = `budgeted_spending <= 0 ? 0 : actual_spending / budgeted_spending × 100`. This is the "X% spent / on track" number.
5. **`overage_percent`** (`budget.rb:256-260`) = over only: `|available_to_spend| / actual_spending × 100`.

**Allocation side (budget setup):**
6. **`allocated_spending`** (`budget.rb:265-267`) = `Σ budget_categories.budgeted_spending WHERE category is a parent` (subcategories excluded to avoid double-count).
7. **`available_to_allocate`** (`budget.rb:275-277`) = `budgeted_spending − allocated_spending`.
8. **`allocated_percent`** (`budget.rb:269-273`) = `allocated_spending / budgeted_spending × 100`.
9. **`allocations_valid?`** (`budget.rb:279-281`) = `initialized AND available_to_allocate ≥ 0 AND allocated_spending > 0`.

**Subcategory inheritance vs ring-fencing** (`budget_category.rb:80-135`):
10. **Inherit** (`:80-82`): a subcategory with `budgeted_spending` nil or 0 → `inherits_parent_budget?` → it shares the **parent's** `available_to_spend` (`:103-107`); `display_budgeted_spending` shows the parent's budget (`:86-94`).
11. **Ring-fence** (parent's `available_to_spend`, `:111-134`): a subcategory with its own limit carves money out of the parent pool. Compute:
    - `shared_pool = parent_budget − Σ(ring-fenced sub budgets)`
    - `shared_pool_spending = total_actual − Σ(ring-fenced sub actual)`
    - `parent.available_to_spend = shared_pool − shared_pool_spending`
    - A ring-fenced subcategory's own `available_to_spend = sub_budget − sub_actual` (`:108-110`).
12. **Synthetic Uncategorized** (`budget_category.rb:31-38`, `budget.rb` uncategorized handling): a categoryless catch-all (UUIDv5 of "uncategorized", **no DB row**) given `budgeted = max(available_to_allocate, 0)`. → wealth-os: map to the **`Uncategorized Review`** leaf (parent `10`); it receives the unallocated remainder.

**Income mirror + extras:**
13. **`suggested_daily_spending`** (`budget.rb` current-month only, positive only) = `available_to_spend / days_remaining`.
14. **Income side** (`budget.rb:286-308`): `actual_income = Σ inflows in period`; `actual_income_percent = actual_income / expected_income × 100`; `remaining_expected_income = expected_income − actual_income`; `surplus_percent` when remaining is negative.
15. **`copy_previous`** (`budget.rb` `copy_from!:151-170`, controller `copy_previous`): copy `budgeted_spending` + `expected_income` + every per-category allocation from the most-recent initialized prior budget.

**Estimates, states & display:**
16. **Auto-fill estimates** (`budget.rb:223-225, 286-288`): `estimated_spending = income_statement.median_expense(interval: "month")`, `estimated_income = median_income(interval: "month")` (median over monthly history via `FamilyStats`). The Setup form offers these as one-click prefills. → wealth-os: derive from `monthlyCashFlow()` history medians.
17. **Donut segments** (`to_donut_segments_json`, `budget.rb:203-218`): one segment per parent `{ color: category.color, amount: budget_category_actual_spending(bc), id: bc.id }`, plus — only when `available_to_spend > 0` — an `"unused"` segment `{ color: var(--budget-unallocated-fill), amount: available_to_spend }`. **Overage is implicit** (no unused segment when over). An uninitialized/invalid budget renders a single placeholder segment.
18. **States** (`budget.rb`): `initialized? = budgeted_spending.present?` (`:138`); `current?` (`:180`) compares to the calendar/custom month; `previous_budget_param`/`next_budget_param` (`:189-201`) gate month nav to a ±2-year window; `allocations_valid?` from rule 9.
19. **Budget performance in Reports** (`reports_controller.rb:312-322`, current month only): `actual_spending / allocated_spending × 100` — note the denominator is **`allocated_spending`** (rule 6), *not* `budgeted_spending`. Use the same in wealth-os's reports.

## 4. UI/UX shape

Two-step wizard → show page (`app/controllers/budgets_controller.rb`, `budget_categories_controller.rb`, `app/views/budgets/**`):
- **Setup (`edit`)**: two money inputs (`budgeted_spending`, `expected_income`) with an optional auto-fill from median history.
- **Allocate (`budget_categories#index`)**: a top **allocation-progress bar** (red if `available_to_allocate < 0`) + per-category number inputs that **auto-submit on blur** (parent rows + indented sub rows; "shared" placeholder for inheriting subs).
- **Show**: a center **donut ring** (segments = per-parent actual + an "unused" segment; center text swaps on hover/click) beside a budgeted-vs-actual summary; below, category rows split into **Over budget** / **On track** sections (filter pills). Each row: colored icon, name, status badge (Over/Warning≥90%/Good), progress bar, and `Spent | Budgeted [shared] | daily-suggestion | Remaining/Overage`.
- **Month nav**: prev/next + calendar popover + Today; `copy_previous` prompt when the period is uninitialized.

## 5. ★ wealth-os build notes

**Migration `0010_budgets.sql`** (integer paise, `user_id`, RLS — copy the owner-policy pattern from `0001_init.sql`; **no `currency` column**):
- `budgets`: `id uuid pk`, `user_id uuid not null`, `period_start date`, `period_end date`, `budgeted_spending_paise bigint not null default 0`, `expected_income_paise bigint not null default 0`, timestamps; `unique(user_id, period_start, period_end)`.
- `budget_categories`: `id uuid pk`, `user_id uuid not null`, `budget_id uuid fk`, `category_id uuid fk`, `budgeted_spending_paise bigint not null default 0`, timestamps; `unique(budget_id, category_id)`.
- RLS owner policy `auth.uid() = user_id` on both.

**`find_or_bootstrap` equivalent:** on first visit to a month, upsert a `budgets` row and **sync `budget_categories` against the live taxonomy** (rule from §2) — create a 0-paise row per leaf, prune orphans. The **donut** (rule 17) is a Recharts ring; segments come straight from `bucketTotals()`. (Sure's API emits both a formatted string and a `_cents` integer; wealth-os stores **paise natively**, so its `/api/budgets` just returns paise — no dual representation needed.)

**Module `src/lib/budget.ts`** (pure, no React/Next — runnable under `tsx`, like `halan.ts`). Implement rules 1–19 over the **same period-filtered `TxnLike[]`** the dashboard already builds. **Reuse, do not re-derive:**
- per-category / per-parent spend → `bucketTotals()` and the drill aggregation in `src/lib/drilldown.ts` (do **not** recompute from raw rows).
- the spend predicate → `SPEND_CLASSES` (`halan.ts:20`); the sign/net logic → `halan.ts` (porting guide §2, §6).
- the parent/leaf map → `parentByCatId` (`src/lib/server/load-drill.ts`); **never hardcode category-name strings** (porting guide §5).
- month navigation → `src/components/month-select.tsx`.

**Routes:** a `/budgets` App Router page (`force-dynamic`, Supabase per request) + `/api/budgets` CRUD (server re-validates, like `/api/commit`). Map the synthetic Uncategorized to the `Uncategorized Review` leaf.

**`verify.ts` tests (paise-exact):**
- exclusion set: a fixture with a transfer (parent 10), a CC payment, and an SIP (parent 08) → confirm they are/aren't in `actual_spending` per the §6 decision.
- rule 2: `max(expense − refund, 0)` with a refund inflow → never negative.
- rules 10–11: inherit-vs-ring-fence on a parent with one inheriting + one ring-fenced sub → parent `available_to_spend` matches the worked formula to the paisa.
- rule 9: `allocations_valid?` boundary (`available_to_allocate = 0` valid; `< 0` invalid).
- rule 15: `copy_previous` reproduces totals + allocations exactly (idempotent on re-copy).
