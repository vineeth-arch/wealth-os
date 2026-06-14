-- wealth-os 0003_upstox
-- Upstox demat ingestion: holdings (no cost basis), realized capital-gains records.
--
-- 1) Upstox holdings reports carry NO average buy price. Allow avg_price_paise to be NULL
--    so an honest snapshot (qty + last price only) can be stored without guessing a basis.
-- 2) Realized gains from the Upstox tradewise tax report → two RLS-owned tables that the
--    Prompt 07 capital-gains / tax view will read. Money is integer paise.

alter table public.holdings_snapshots
  alter column avg_price_paise drop not null;

-- per-segment realized P&L + charges summary (one row per user/account/FY/segment)
create table public.realized_gain_segments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  financial_year text not null,
  segment text not null,                 -- 'equities' | 'fo' | 'commodities' | 'currencies'
  gross_pl_paise bigint not null,
  net_pl_paise bigint not null,
  charges_paise bigint not null,
  short_term_paise bigint not null,
  long_term_paise bigint not null,
  speculation_paise bigint not null,
  unique (user_id, account_id, financial_year, segment)
);

-- one row per closed (matched buy↔sell) lot
create table public.realized_gain_lots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  financial_year text not null,
  segment text not null,
  scrip text not null,
  isin text not null,
  qty numeric not null,
  buy_date date not null,
  buy_amt_paise bigint not null,
  sell_date date not null,
  sell_amt_paise bigint not null,
  total_pl_paise bigint not null,
  short_term_paise bigint not null,
  long_term_paise bigint not null,
  unique (user_id, account_id, financial_year, segment, isin, buy_date, sell_date, qty)
);

alter table public.realized_gain_segments enable row level security;
alter table public.realized_gain_lots     enable row level security;

do $$
declare t text;
begin
  foreach t in array array['realized_gain_segments','realized_gain_lots']
  loop
    execute format('create policy %I_owner on public.%I for all using (auth.uid() = user_id) with check (auth.uid() = user_id);', t, t);
  end loop;
end $$;
