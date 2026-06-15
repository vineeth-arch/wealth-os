# 06 — High-value extras (beyond the 4 screens)

> Read `00_PORTING_GUIDE.md` first. These are **candidate** extractions — not yet scheduled like Budgets/Reports/Dashboard/Balance-Sheet — ranked by **value × fit for an import-only, single-user, INR app**. Same clean-room rule: formulas in wealth-os terms (paise · `+`=inflow · `user_id` · 276 taxonomy), Sure cited as `path:line` at `b0b0dc86…`, re-read this run. Effort: S = days · M = ~1–2 wks · L = ~3–6 wks.

These directly improve wealth-os's **core ritual** (import → review → categorize) and its forward-looking value, which is where a personal tool either earns daily use or doesn't.

---

## 1. Quick-Categorize wizard  — *S · top pick*

**What it is.** Group the uncategorized review queue by similar description, then one click "categorize all of these **and** make a rule for next time." Collapses the most-repeated chore in the app.

**Sure pointer.** `app/models/rule.rb:45` `self.create_from_grouping(family, grouping_key, category, transaction_type:)` — builds a rule from a name-grouping + optional income/expense filter + a set-category action; the controller applies it immediately.

**★ wealth-os build notes.**
- No new table. A `/transactions` Review action: bucket `Uncategorized Review` rows by `normalize(description_raw)` prefix, show counts, let the user pick a Halan leaf per group.
- **Reuse:** `normalize` + `categorize` (`src/lib/ingest/rules.ts`), `/api/rules/create` (priority = max+10) and `/api/rules/apply` (re-run), and `src/components/review-table.tsx`. Resolve categories via the taxonomy module — **never hardcode names** (porting guide §5); the wizard must refuse parent 14/15 leaves (`guardCategory`).
- **verify.ts:** grouping is deterministic for a fixture; creating-then-applying a group rule is idempotent (second run changes nothing) and respects the 14/15 guard.

## 2. Recurring / upcoming  — *L · biggest user-facing win after Budgets*

**What it is.** Detect recurring merchants/amounts and show an **Upcoming** list ("rent, EMI, SIP due this week"). Turns a backward-looking ledger into cash-flow foresight; pairs with Compass.

**Sure pointer.** `app/models/recurring_transaction.rb` — table `db/schema.rb:1503`; variance fields `:10-12` (`expected_amount_min/max/avg`); `create_from_transaction (~:190)` scans history; `projected_entry` renders upcoming items; next date = `expected_day_of_month` projected forward with month-end fallback; auto-detect via `identify_patterns_for!`.

**★ wealth-os build notes.**
- **Migration `0011_recurring_transactions`** (integer paise, `user_id`, RLS): `expected_day_of_month int`, `next_expected_date date`, `expected_amount_min/max/avg_paise bigint`, `merchant text`, `category_id`, `status`, `last_occurrence_date`.
- Pure `src/lib/recurring.ts`: pattern detection over `TxnLike[]` (group by merchant + amount band + day-of-month), next-date computation (month-end fallback), and **Welford** incremental variance.
- Surface as a dashboard/transactions "Upcoming" section.
- **verify.ts:** detection on a fixture history; next-date for a Feb-31 case → Feb 28/29; variance update matches Welford paise-exact.

## 3. Transaction splits  — *M · accuracy*

**What it is.** Split one payment across categories (a ₹6,000 order = groceries + electronics + gift). Without it, every mixed purchase corrupts a bucket — at odds with wealth-os's paise-exact identity.

**Sure pointer.** `app/models/entry.rb:393` `split!(splits)` (validates Σ children == parent, marks parent excluded), `:426` `unsplit!`, `:16` `child_entries` via `parent_entry_id`, `:386` split-child check.

**★ wealth-os build notes.**
- wealth-os is flat `transactions`. Add a derived split: child rows referencing a `parent_txn_id`, with the **parent excluded from aggregation** (mirror Sure's `excluded`). Children carry their own `category_id`/`tags`.
- **Decide (surface, don't bury):** splits are **user-derived, not imported** → keep them **out of the `content_hash` dedup path** (`src/lib/ingest/util.ts`); a re-import must not resurrect or duplicate a split parent. Reconcile so `accountBalances()`/`bucketTotals()` count children, not the parent.
- **verify.ts:** Σ child `amount_paise` == parent (paise-exact); parent excluded from `bucketTotals`; re-import of the same statement leaves splits intact.

## 4. Bulk edit + search/filters on the review grid  — *M*

**What it is.** Multi-select rows → set category/tag in one action; full-text search + date/amount filters. Removes the 300-row cap and the "drop into Supabase SQL" escape hatch.

**Sure pointer.** `app/controllers/transactions/bulk_updates_controller.rb:5` (`create`, scoped `excluding_split_parents`) → `app/models/entry.rb:458` `bulk_update!(params, update_tags:)` (tags only on explicit opt-in). Search: `transactions_controller.rb:15-20` (`Transaction::Search`) + `:525-528` `search_params` (search/date/amount/category/account/merchant/type/tag/status).

**★ wealth-os build notes.**
- Extend `src/components/review-table.tsx` with a multi-select toolbar + a bulk category/tag endpoint (server re-validates categories like `/api/commit`; tags update only when explicitly chosen). Add server-side search/date/amount filters to the review query (lift the 300-row cap).
- **Reuse:** existing category-select + the rules-apply override policy (don't overwrite user-set categories).
- **verify.ts:** a bulk update touches only the selected ids; the search predicate matches the expected rows on a fixture.

## 5. Import revert (undo a commit as a unit)  — *M · safety net*

**What it is.** Roll back an entire import in one click. Today wealth-os commits are one-way (dedup makes re-import safe, but a bad categorization batch can't be undone wholesale).

**Sure pointer.** `app/models/import.rb:169` `revert` (within a transaction, destroys the import's `entries` and the `accounts` it created), `:161` `revert_later`, `:313` `revertable?`.

**★ wealth-os build notes.**
- wealth-os already stamps `transactions.import_id` (`0001_init.sql`) and stores `imports` rows. A revert deletes exactly that import's transactions and, if it was the **earliest** import for the account, re-derives the net-worth anchor (`anchor_balance_paise`/`anchor_date`) from the next-earliest. Do **not** delete the account itself (wealth-os accounts are user-created, not import-created — differs from Sure).
- **verify.ts:** revert removes only that `import_id`'s rows; a subsequent re-import of the same statement re-inserts them (idempotent end-to-end); anchor re-derivation is correct when the earliest import is reverted.

## 6. Privacy-blur toggle  — *S*

**What it is.** A header toggle that blurs all money values (screenshots, screen-sharing). Cheap, genuinely useful.

**Sure pointer.** Global affordance in the shell (see `05_UX_SHELL.md`).

**★ wealth-os build notes.**
- A CSS blur class over money spans (`formatINR` outputs), toggled from `src/components/app-shell.tsx`, state persisted in `profile.data` (`0006_profile.sql`) — **no migration**.
- **Verify at runtime, not the gate** (the gate doesn't exercise UI): a 2-minute click-through toggling blur across dashboard/transactions.

---

## Sequence recommendation

After **Budgets → Reports** (the scheduled Option B work): **Quick-Categorize (1) → splits (3) → recurring (2)**. The first two are cheap and hit the daily ritual; recurring is the larger build but the biggest "wow." Bulk-edit/search (4) and import-revert (5) slot in whenever the review flow or a bad import bites. Privacy-blur (6) is a standalone afternoon.

**Out of scope (do not mistake for extras):** live bank sync, multi-user/families, multi-currency/FX, and the AI assistant/MCP — the first three contradict the import-only/single-user/INR design; the assistant sends balances to an LLM, breaking the "no money to the LLM" wall (`00_PORTING_GUIDE.md`, `CLAUDE.md` invariants).
