# 00 — Porting guide (Sure → wealth-os)

The cross-cutting translation layer. **Read this before any surface doc.** Every Sure formula in `01`–`05` assumes these six mappings. All pointers re-read from source this run at commit `b0b0dc86…`.

---

## 1. Money model

| | Sure | wealth-os |
|---|---|---|
| Type | `Money` value object: `BigDecimal amount` + `Currency` (`lib/money.rb:33-40`) | plain `number` = **integer paise** |
| Storage | `DECIMAL(19,4)` **major units** + a `currency` string column per row (`db/schema.rb`, e.g. `budgets.budgeted_spending:376`) | `bigint` **paise**, INR only (`src/lib/format.ts:1`) |
| Multi-currency / FX | yes — `Money#exchange_to` + `exchange_rates` table (`lib/money.rb:51`) | **none** — single currency (INR) |
| Format boundary | `Money::Formatting` | `formatINR(paise)` / `formatINRCompact` (`src/lib/format.ts:3,12`) |

**Conversion rule (porting):** a Sure amount in major units → wealth-os paise = `round(major × 100)`. Sure's `DECIMAL(19,4)` has 4 fractional places; INR needs 2 — there is no sub-paise money in wealth-os, so **round to paise** and keep everything integer. **Drop the `currency` column and all FX entirely** in every ported table — do not add a currency field "to be safe"; INR-only is an invariant.

---

## 2. Sign convention  ⚠ porting hazard

| | Sure | wealth-os |
|---|---|---|
| Inflow (income, refund, money in) | **negative** `entries.amount` | **positive** `amount_paise` |
| Outflow (expense, money out) | **positive** | **negative** |
| Proof | `app/models/entry.rb:271` (`amount.negative? ? "income" : "expense"`); search scopes `entry.rb:111-112` (`income → amount < 0`, `expense → amount >= 0`) | `src/lib/halan.ts:2-3` header + `monthlyCashFlow` (`:79-82`) |

**Flip rule:** Sure stores the **inverse** of wealth-os. Every Sure formula that sums, compares, or thresholds an amount must be **re-derived in `+`=inflow terms — do not blindly multiply by −1.** Concretely:
- Sure "expense total" = `Σ amount WHERE amount >= 0` → wealth-os "spend total" = `Σ (−amount_paise) WHERE amount_paise < 0` (i.e. magnitude of outflows).
- Sure "income total" = `Σ |amount| WHERE amount < 0` → wealth-os "income" = `Σ amount_paise WHERE amount_paise > 0`.
- `wealth-os already does this correctly` in `src/lib/halan.ts` (`bucketTotals`, `monthlyCashFlow`). **Reuse those rather than re-implementing the sign logic.**

---

## 3. Ledger shape

| Sure | wealth-os |
|---|---|
| `Entry` (date/amount/currency/name) → polymorphic `entryable` = `Transaction` \| `Trade` \| `Valuation` (`app/models/entry.rb`) | flat **`transactions`** row (date, `amount_paise`, `description_*`, `category_id`, `tags`) — no entry/entryable split |
| `Account` `delegated_type :accountable` across **9 types** (`concerns/accountable.rb:4`) | `accounts.kind ∈ {bank, credit_card, broker, asset_snapshot}` |
| Holdings via `Trade`/`Holding`/`Security` | `holdings_snapshots` + `instruments` + `prices` |
| Daily `balances` table + `Valuation` entries | per-account **anchor** (`anchor_balance_paise` + `anchor_date`) + summed txns (`halan.ts accountBalances`) |

**Accountable → wealth-os concept map:**

| Sure accountable | Classification | wealth-os equivalent |
|---|---|---|
| `Depository` | asset | `accounts.kind = 'bank'` |
| `Investment`, `Crypto` | asset | `accounts.kind = 'broker'` (+ `holdings_snapshots`) |
| `Property`, `Vehicle`, `OtherAsset` | asset | `accounts.kind = 'asset_snapshot'` |
| `CreditCard` | liability | `accounts.kind = 'credit_card'` |
| `Loan` | liability | `loans` table (+ `loan_schedule_rows`) — *not* an `accounts.kind` |
| `OtherLiability` | liability | n/a (use `asset_snapshot` with negative balance, or skip) |

---

## 4. Multi-tenancy

Sure is multi-user: every table carries `family_id` and scoping is "per family" (`db/schema.rb` throughout). wealth-os is **single-user**: every table carries **`user_id`** with an RLS owner policy (`auth.uid() = user_id`). **Translation is mechanical: every Sure "per family" = wealth-os "per user".** New tables must include `user_id uuid not null` + the standard RLS owner policy (copy the pattern from `supabase/migrations/0001_init.sql`). Sure's account-sharing / permission tiers (owner/read_write/read_only) have **no analog** — drop them.

---

## 5. Category model

| | Sure | wealth-os |
|---|---|---|
| Shape | 2-level: `Category` self-ref `parent_id`, `subcategories` (`category.rb:8-9`) | 2-level: 15 parents + 261 leaves (`src/lib/seed-data.ts`, `parent` = parent-name string) |
| Style | `color` hex `#RRGGBB` + `lucide_icon`, sub inherits parent color (`category.rb:11-17`) | `color` + `icon` per `SeedCategory` (`seed-data.ts:4`) |
| Income/expense tag | **none** — Sure removed category classification; direction is **amount-sign-inferred** (`category.rb:27-29`, "classification removed") | **parent-prefix-driven**: 2-digit prefix → `BucketClass` (`halan.ts classifyParent:26-30`) |
| Merge | `Category::Merger` reassign+destroy | n/a (fixed taxonomy) |

**Key structural match:** both are 2-level parent/leaf, so Sure's parent/sub budget logic maps cleanly onto the Halan tree. **Differences to honour:**
- wealth-os taxonomy is **fixed** (276 names, generated; do not create categories at runtime). **Never hardcode category-name strings in build code** — resolve via the taxonomy module / the `parentByCatId` map used in `src/lib/server/load-drill.ts` and `src/lib/drilldown.ts`. Identify parents by their **2-digit prefix** (`halan.ts:13-17`), never the human suffix.
- **Leakage is a TAG, not a category** (`halan.ts:24` `LEAKAGE_TAG`). Sure has no leakage concept.
- The auto-categorizer must **never** assign a leaf under parent **`14 Cash Leakage Watchlist`** or **`15 Review Buckets`**; the only allowed fallback is **`Uncategorized Review`** under parent **`10 Transfers & Adjustments`** (`loadRules` refuses such rules; `autoAssignable=false` seed flag). Carry this invariant into any budget/report category iteration.

---

## 6. Transaction kinds & the budget/report exclusion set  ⚠ correction + decision

**Sure** tags each transaction with `enum :kind` (`app/models/transaction.rb:69-76`):
`standard · funds_movement · cc_payment · loan_payment · one_time · investment_contribution`.
Two derived sets (`transaction.rb:80,85`):
- `TRANSFER_KINDS = funds_movement, cc_payment, loan_payment, investment_contribution`
- `BUDGET_EXCLUDED_KINDS = funds_movement, one_time, cc_payment` — **only these three.**

> **Correction vs prior audit.** `SURE_AUDIT.md`/the prior Reports notes listed `BUDGET_EXCLUDED_KINDS` as including "transfer" / all transfer kinds. **Source says otherwise** (`transaction.rb:82-85`): the comment is explicit that `loan_payment` and `investment_contribution` are **intentionally NOT excluded** — "they represent real cash outflow from a budgeting perspective." So Sure **counts loan payments and investment contributions as budget spend**, and excludes only inter-account movements (`funds_movement`), credit-card payments (`cc_payment`), and `one_time` items.

**wealth-os has no `kind` enum.** The equivalent is **category-driven**, and it already exists — `src/lib/halan.ts:20-22` `SPEND_CLASSES` (parents `02,03,04,05,06,07,11,12,13,14`) which **excludes** income(01), invest(08), assets(09), transfer(10), review(15), uncategorized. **The wealth-os budget/report "spend" predicate must reuse `SPEND_CLASSES` / the cash-flow logic in `halan.ts` and Compass (`src/lib/compass.ts`); do not invent a parallel exclusion set.**

Exclusion-set mapping:

| Sure exclusion | wealth-os equivalent |
|---|---|
| `funds_movement` (inter-account transfer) | parent **`10 Transfers & Adjustments`** → already excluded by `SPEND_CLASSES` |
| `cc_payment` (CC bill payment) | categorized under parent **`10`** → already excluded |
| `one_time` | **no analog** — wealth-os doesn't flag one-time items; they fall under their natural category. (Optional future: a `tags` value, but out of scope.) |

> **⚠ Decision to surface for the Budgets build (do not silently resolve).** Sure counts `investment_contribution` (SIP/invest) and `loan_payment` toward budget spend. wealth-os's `SPEND_CLASSES` **includes** debt/EMIs (parent `05`) ✅ but **excludes** invest (parent `08`). So a SIP **is** budget spend in Sure but **is not** in wealth-os's existing spend definition. The build must pick one and state it:
> - **(Recommended) Follow wealth-os convention** — invest (08) stays out of "spend"; budgets cover parents in `SPEND_CLASSES` only. Keeps Budgets consistent with the dashboard cash-flow and Compass.
> - **Or** add invest as an opt-in budget line (closer to Sure). If chosen, do it as an explicit toggle, not by quietly widening `SPEND_CLASSES`.
> Either way, **reuse the existing class set as the base**; this decision is *additive*, not a fork of the predicate.

---

## 7. Edit precedence — locked attributes / user-override  (cross-cutting; matters for Rules, Bulk-edit, Splits)

Sure's `Enrichable` concern (`app/models/concerns/enrichable.rb`) governs **who may overwrite a field**: external (Plaid) and internal (Rules, AI) sources may enrich an attribute **only if the user hasn't taken ownership of it**. The module's own comment says it plainly (`:9-10`): "If a Rule tells us to set the category to Groceries, but the user later overrides… we should not override the category again."
- `enrich_attribute(attr, value, source:)` (`:44`) skips any attribute that is `locked?` (`:123`); writes are logged to `data_enrichments`.
- `lock_saved_attributes!` (`:139-143`) locks whatever the user just changed; `clear_ai_cache` (`:145`) only unlocks AI-set values that the user hasn't since changed.

**wealth-os equivalent — already present:** `transactions.category_source` (`user | rule | ai_suggested | default | …`) + the **reapply override policy** in `src/lib/ingest/rules.ts` (`REAPPLY_SOURCES` never touches a `user`-set category). When porting Rules/Bulk-edit/Splits, **route writes through that policy** — a rule/bulk action must not overwrite a user-set category; a manual edit sets `category_source = 'user'` and becomes sticky. Do **not** add a `locked_attributes` JSONB; `category_source` is wealth-os's lock.

## 8. Split parents are excluded from all aggregation  (cross-cutting; see `06_TRANSACTIONS.md` §2)

Once splits exist, **a split parent must never be counted** — only its children. Sure enforces this two ways: the parent row is flagged `excluded: true`, and every aggregator merges the `excluding_split_parents` scope (`app/models/entry.rb:72-78`, a `NOT EXISTS (SELECT 1 FROM entries ce WHERE ce.parent_entry_id = entries.id)`). It is applied in income-statement totals, balances, search, and export.

**wealth-os:** when splits land, add the same guard to every aggregator (`bucketTotals`, `accountBalances` in `src/lib/halan.ts`; the loaders in `drilldown.ts`/`server/load-drill.ts`) — exclude split parents, count children. Children sum to the parent, so net figures are unchanged.

## 9. Account visibility & money precision (two smaller cross-cutting notes)

- **Account visibility:** Sure scopes analytics to `Entry.visible` = accounts with `status ∈ {draft, active}` (a deactivated account drops out of totals). **wealth-os has no account status** — all accounts are live — so this maps to **n/a** (don't add a status column for parity).
- **Money precision:** Sure stores `DECIMAL(19,4)` (4 fractional places) and carries small UI tolerances (±0.01 on the amount filter, ±0.005 on split balancing). wealth-os is **integer paise** — convert `round(major × 100)`, and note that **integer sums are exact**, so split/budget reconciliation needs **no tolerance** (assert `===`, not "within ε"). This is a wealth-os correctness advantage; preserve it.
