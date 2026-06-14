-- wealth-os 0004_loans
-- Manually-entered loans for the /loans dashboard (amortization + prepayment what-if).
-- Money is ALWAYS bigint paise. RLS-owned per user. Live balances are NOT pulled from statements (deferred);
-- a loan may optionally reference an EMI account + a parent-05 taxonomy leaf, informational only.

create table public.loans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid references public.accounts(id) on delete set null,  -- optional EMI account (informational)
  name text not null,
  kind text not null check (kind in ('home','vehicle','personal','education','business','other')),
  principal_paise bigint not null,
  annual_rate_pct numeric not null,
  tenure_months int not null,
  start_date date not null,
  emi_category text,                  -- optional taxonomy leaf under parent 05 (informational)
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

alter table public.loans enable row level security;

create policy loans_owner on public.loans
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
