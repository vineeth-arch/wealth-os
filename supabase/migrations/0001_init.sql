-- wealth-os 0001_init
-- Money is ALWAYS bigint paise. Sign convention: + = inflow to the account, − = outflow.
-- CC purchases are negative; CC bill payments received are positive.

create extension if not exists pgcrypto;

-- ───────────────────────── accounts ─────────────────────────
create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,                          -- "SBI Savings", "IDFC FIRST Credit Card", ...
  institution text not null,                   -- parser key: SBI | FEDERAL | IDFC_BANK | IDFC_CC | SURYODAY_CC | ZERODHA | SNAPSHOT
  kind text not null check (kind in ('bank','credit_card','broker','asset_snapshot')),
  currency text not null default 'INR',
  -- net-worth anchor = opening balance of the earliest imported statement (decided default)
  anchor_balance_paise bigint,
  anchor_date date,
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

-- ───────────────────────── categories (Halan taxonomy) ─────────────────────────
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  parent_id uuid references public.categories(id) on delete restrict,
  color text not null default '#64748b',
  lucide_icon text not null default 'circle',
  -- guard rails: Leakage (parent 14) and Review (parent 15) leaves are never auto-assignable
  auto_assignable boolean not null default true,
  unique (user_id, name)
);

-- ───────────────────────── imports ─────────────────────────
create table public.imports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  file_name text not null,
  institution text not null,
  period_start date,
  period_end date,
  opening_paise bigint,
  closing_paise bigint,
  expected_delta_paise bigint,
  parsed_sum_paise bigint not null,
  reconciled boolean not null,
  parsed_count int not null,
  inserted_count int not null,
  duplicate_count int not null,
  warnings jsonb not null default '[]',
  created_at timestamptz not null default now()
);

-- ───────────────────────── transactions ─────────────────────────
create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  import_id uuid references public.imports(id) on delete set null,
  txn_date date not null,
  amount_paise bigint not null,                -- signed; see header convention
  balance_after_paise bigint,
  description_raw text not null,               -- immutable as parsed
  description_clean text,                      -- AI-suggested display name (never overwrites raw)
  merchant text,                               -- UPI-enriched counterparty when matched
  category_id uuid references public.categories(id) on delete set null,
  category_source text not null default 'rule' check (category_source in ('rule','ai_suggested','user','default')),
  tags text[] not null default '{}',           -- leakage is a TAG here, never a category
  ref_no text,
  native_type text,
  sub_account text,                            -- e.g. CC card last-4
  upi_ref text,
  content_hash text not null,                  -- sha256(account|date|amount|normdesc|occurrence)
  occurrence int not null default 1,
  created_at timestamptz not null default now(),
  unique (account_id, content_hash)            -- idempotent imports, enforced by the database itself
);
create index transactions_user_date_idx on public.transactions (user_id, txn_date desc);
create index transactions_category_idx on public.transactions (category_id);
create index transactions_tags_idx on public.transactions using gin (tags);

-- ───────────────────────── vendor rules ─────────────────────────
create table public.vendor_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  priority int not null,                       -- first match wins, ascending
  match_text text not null,                    -- normalized uppercase substring
  category_id uuid not null references public.categories(id) on delete cascade,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (user_id, priority)
);

-- ───────────────────────── instruments & holdings ─────────────────────────
create table public.instruments (
  isin text primary key,                       -- canonical instrument key (decided default)
  name text not null,
  asset_class text not null check (asset_class in ('equity','mutual_fund','sgb','gold','fd','bond','cash')),
  symbol text,
  amfi_scheme_code text,                       -- for mfapi.in NAV lookups
  yahoo_symbol text,                           -- e.g. ETERNAL.NS for yahoo-finance2
  sector_or_type text
);

create table public.holdings_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  import_id uuid references public.imports(id) on delete set null,
  as_of date not null,
  isin text not null references public.instruments(isin),
  qty numeric not null,
  avg_price_paise bigint not null,
  last_price_paise bigint not null,
  unique (account_id, as_of, isin)
);

-- ───────────────────────── prices ─────────────────────────
create table public.price_sources (
  id text primary key,                         -- 'mfapi' | 'yahoo' | 'manual_ibja' | 'mfdata' | 'amfi'
  display_name text not null,
  kind text not null check (kind in ('mf_nav','equity','gold','manual')),
  enabled boolean not null default true
);

create table public.prices (
  isin text not null references public.instruments(isin),
  price_date date not null,
  price_paise bigint not null,
  source text not null references public.price_sources(id),
  fetched_at timestamptz not null default now(),
  primary key (isin, price_date, source)
);

-- ───────────────────────── integrations & profiles ─────────────────────────
create table public.integrations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('llm','price_source','storage')),
  provider text not null,                      -- 'anthropic' | 'openai' | 'gemini' | 'openrouter' | 'mfapi' | 'yahoo' | ...
  -- LLM keys are stored encrypted client-side; server never sees plaintext (decided default)
  encrypted_secret text,
  kdf_salt text,
  status text not null default 'not_connected' check (status in ('connected','not_connected','error')),
  meta jsonb not null default '{}',
  updated_at timestamptz not null default now(),
  unique (user_id, kind, provider)
);

create table public.bank_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,                          -- "SBI", "Federal", ...
  -- statement-PDF password, encrypted in the browser with a passphrase-derived key
  password_ciphertext text not null,
  kdf_salt text not null,
  kdf_iterations int not null default 600000,
  unique (user_id, name)
);

-- ───────────────────────── RLS: single-user isolation on every table ─────────────────────────
alter table public.accounts            enable row level security;
alter table public.categories          enable row level security;
alter table public.imports             enable row level security;
alter table public.transactions        enable row level security;
alter table public.vendor_rules        enable row level security;
alter table public.holdings_snapshots  enable row level security;
alter table public.integrations        enable row level security;
alter table public.bank_profiles       enable row level security;

do $$
declare t text;
begin
  foreach t in array array['accounts','categories','imports','transactions','vendor_rules','holdings_snapshots','integrations','bank_profiles']
  loop
    execute format('create policy %I_owner on public.%I for all using (auth.uid() = user_id) with check (auth.uid() = user_id);', t, t);
  end loop;
end $$;

-- instruments / prices / price_sources are reference data: readable by any authenticated user, written by service role only
alter table public.instruments   enable row level security;
alter table public.prices        enable row level security;
alter table public.price_sources enable row level security;
create policy instruments_read   on public.instruments   for select using (auth.role() = 'authenticated');
create policy prices_read        on public.prices        for select using (auth.role() = 'authenticated');
create policy price_sources_read on public.price_sources for select using (auth.role() = 'authenticated');

insert into public.price_sources (id, display_name, kind) values
  ('mfapi',       'mfapi.in (free MF NAV)',            'mf_nav'),
  ('mfdata',      'mfdata.in (alternate MF data)',     'mf_nav'),
  ('amfi',        'AMFI NAVAll.txt (raw)',             'mf_nav'),
  ('yahoo',       'Yahoo Finance (NSE .NS / BSE .BO)', 'equity'),
  ('manual_ibja', 'Manual entry (IBJA-anchored gold)', 'manual');
