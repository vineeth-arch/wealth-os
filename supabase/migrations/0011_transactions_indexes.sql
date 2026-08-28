-- 0011: query-shape indexes for the hot transaction reads, plus two DB-side aggregation functions
-- that let the dashboard fetch a few hundred grouped rows instead of draining the whole ledger.
--
-- IMPORTANT — this SQL was authored and reviewed but NOT executed against a live Postgres instance
-- (this environment has no database access). Before trusting the dashboard's RPC-backed numbers,
-- confirm they are byte-identical to the pre-migration numbers (see the Pass 6 manual checklist in
-- the PR). If they ever disagree, the app falls back automatically to the proven row-by-row path on
-- any RPC error — but a WRONG-without-erroring result would not be caught by that fallback, so the
-- manual paise-exact comparison is the real safety net here, not just "the query didn't fail."
--
-- ---- Indexes ----
-- 1) (user_id, category_source): ai/suggest filters eq 'default'; rules/apply filters
--    in ('default','rule','ai_suggested','money_manager'). Composite (not partial) because the
--    in(...) form spans four values — a partial WHERE category_source='default' index would only
--    serve one of the two hot shapes.
-- 2) (user_id, id): the paginated-drain sort key — every fetchAllRows() call site orders by id.
-- 3) (account_id, txn_date desc): the account-filtered Review query and the same-day ±N-day context
--    window (account_id eq + txn_date between). unique(account_id, content_hash) can't serve these.
create index if not exists transactions_user_source_idx
  on public.transactions (user_id, category_source);

create index if not exists transactions_user_id_id_idx
  on public.transactions (user_id, id);

create index if not exists transactions_account_date_idx
  on public.transactions (account_id, txn_date desc);

-- ---- Aggregation functions ----
-- Deliberately minimal: NO category-hierarchy logic lives in SQL. Both functions return raw,
-- un-classified sums grouped by category_id (the bare FK) — the app resolves category_id -> parent
-- bucket name using the (tiny, already-fetched) categories table in TypeScript, reusing the exact
-- classifyParent()/SPEND_CLASSES/LEAKAGE_TAG logic in src/lib/halan.ts that's already gate-tested.
-- This keeps the SQL itself to a straightforward GROUP BY + SUM, the least error-prone shape possible
-- for money math this project cannot execute-test from this environment.
--
-- security invoker (not definer) + explicit auth.uid() filter: runs with the calling user's own RLS,
-- same trust boundary as every other query in this app.

create or replace function public.dashboard_category_month_totals()
returns table (
  category_id uuid,
  month text,
  is_leakage boolean,
  is_positive boolean,
  amount_sum_paise bigint,
  txn_count bigint
)
language sql
stable
security invoker
as $$
  select
    category_id,
    to_char(txn_date, 'YYYY-MM') as month,
    (tags @> array['leakage']::text[]) as is_leakage,
    (amount_paise >= 0) as is_positive,
    sum(amount_paise)::bigint as amount_sum_paise,
    count(*)::bigint as txn_count
  from public.transactions
  where user_id = auth.uid()
  group by category_id, to_char(txn_date, 'YYYY-MM'), (tags @> array['leakage']::text[]), (amount_paise >= 0)
$$;

create or replace function public.dashboard_account_balances()
returns table (
  account_id uuid,
  amount_sum_paise bigint
)
language sql
stable
security invoker
as $$
  select t.account_id, sum(t.amount_paise)::bigint as amount_sum_paise
  from public.transactions t
  join public.accounts a on a.id = t.account_id
  where t.user_id = auth.uid() and (a.anchor_date is null or t.txn_date >= a.anchor_date)
  group by t.account_id
$$;
