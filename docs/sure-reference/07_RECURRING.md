# 07 — Recurring / upcoming transactions

> Read `00_PORTING_GUIDE.md` first. wealth-os terms (paise · `+`=inflow · `user_id`). Sure `path:line` @ `b0b0dc86…`, re-read this run. Build effort **L** — the biggest standalone backlog feature (its own migration + detection engine). See `06_TRANSACTIONS.md` for the other ledger backlog items.

## 1. What it is

Detect recurring merchants/amounts and show an **Upcoming** list ("rent, EMI, SIP due soon"). Turns the backward-looking ledger into cash-flow foresight; pairs with Compass.

## 2. Sure data model

`recurring_transactions` (`db/schema.rb:1503-1534`): `family_id`, `account_id`, `destination_account_id` (recurring transfers), `merchant_id`, `name`, `amount DECIMAL(19,4)`, `currency`, `expected_day_of_month (1-31)`, `last_occurrence_date`, `next_expected_date`, `status (active|inactive)`, `occurrence_count`, `manual` (user-created vs auto-detected), `expected_amount_min/max/avg DECIMAL(19,4)`. Partial unique indexes by *shape* (merchant+account / name+account / transfer-pair variants); check constraints (a transfer needs a source and distinct accounts). Model `app/models/recurring_transaction.rb` + `recurring_transaction/identifier.rb` (detect) + `cleaner.rb` (staleness) + the job.

## 3. The math / algorithm (numbered)

All amounts → paise; `+`=inflow.
1. **`create_from_transaction`** (`recurring_transaction.rb:143-194`): scan **6 months** of history for matches (by `merchant_id` or `name`, same currency, **day-of-month ±2**, same account); seed variance (0 matches → nil; 1 → min=max=avg; 2+ → min, max, simple mean); `next_expected_date` computed **from today**; `manual: true`, `occurrence_count = matches`.
2. **Next date** (`:237-259`): if `Date(thisYear, thisMonth, expected_day) > today` → that date; else next month's `expected_day` **with month-end fallback** (e.g. day 31 in Feb → Feb 28/29; invalid date ⇒ `end_of_month`).
3. **`record_occurrence!(date, amount)`** (`:309-321`): set `last_occurrence_date`, recompute `next_expected_date`, `update_amount_variance` (manual only), `occurrence_count += 1`, `status = active`.
4. **Welford running average** (`:324-343`, verified): first sample → `min=max=avg=x`; else `min=min(min,x)`, `max=max(max,x)`, and `n = occurrence_count − 1`, `avg = avg + (x − avg)/(n + 1)`.
5. **Matching window** (`:262-283, 416-429`): day-of-month `BETWEEN max(day−2,1) AND min(day+2,31)`; amount = `[min, max]` if manual+variance else exact `amount`; match merchant or name. Transfers matched by **account-pair**, not name.
6. **`projected_entry`** (`:360-387`): only if `active?` and `next_expected_date.future?`; display amount = `expected_amount_avg` (manual+variance) else fixed `amount`; carries min/max/avg + `has_variance` + transfer endpoints.
7. **Auto-detection** (`identifier.rb`): scan **3 months**, **exclude transfer kinds**, group by `(merchant_id|name, amount, currency, account)`; require **≥ 3 occurrences** (`:39`), **last within 45 days** (`:43`), and **day clustering** — circular std-dev of day-of-month **≤ 5** on a 31-day cycle (`:49`, `days_cluster_together?`); `expected_day` = circular median.
8. **Cleaner staleness** (`cleaner.rb`): mark inactive if `last_occurrence_date` is older than **6 months (manual) / 2 months (auto)**; prune auto-detected inactive rows older than 6 months.
9. **Job** (`identify_recurring_transactions_job.rb`): debounced 30 s after a sync, advisory-locked, skipped while syncs are in flight.
10. **Upcoming window (UI)** (`transactions_controller.rb:58-64`): active rows with `next_expected_date` in `[today, today+10d]`.

## 4. UI/UX shape

An **Upcoming** tab on the transactions screen: projected rows grouped by `next_expected_date` (ascending), each with merchant/name, a "Projected" badge, days-until, and (for variance) an amount range. Manual rows can be created via "Mark as recurring" on a transaction.

## 5. ★ wealth-os build notes

- **Migration `0011_recurring_transactions`** (integer paise, `user_id`, RLS — copy `0001` owner pattern; **no currency**): `account_id`, `destination_account_id`, `merchant text`, `name text`, `category_id`, `amount_paise bigint`, `expected_day_of_month int`, `last_occurrence_date date`, `next_expected_date date`, `status text`, `occurrence_count int`, `manual bool`, `expected_amount_min/max/avg_paise bigint`. Partial-unique by shape as in §2.
- **Pure `src/lib/recurring.ts`** (`tsx`-runnable): detection (group over `TxnLike[]`, the §7 thresholds, circular-median day), next-date (§2 month-end fallback), Welford variance (§4 — keep `avg_paise` integer; note the rounding when porting the division), matching window (§5).
- **No Sidekiq / no live sync in wealth-os** → drop the debounced-job + advisory-lock machinery (§9). Run detection **deterministically on demand** — after a commit, or behind a "Detect recurring" button / an `/api/recurring/detect` route over imported txns. Simpler than Sure by design.
- **Transfers:** wealth-os transfers are **category-driven (parent `10`)**, not a kind+pair. Exclude parent `10` from name/merchant detection (mirrors Sure excluding `TRANSFER_KINDS`); recurring *transfers* are a later refinement.
- **Reuse:** `parentByCatId` for category; merchant from the enrichment fields; `TxnLike` + the txn loaders (`drilldown.ts`, `server/load-drill.ts`). Sign per `halan.ts` (`+`=inflow).
- **`verify.ts`:** next-date for day-31 → Feb 28/29; Welford `avg_paise` exact over a sample sequence; detection fires only at ≥3 occurrences / ≤45-day recency / day-cluster ≤5 on a fixture; amount window selects the right matches.
