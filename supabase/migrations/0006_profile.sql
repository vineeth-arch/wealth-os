-- wealth-os 0006_profile
-- One-row-per-user profile for the Compass Mirror: the reflection checklist + a goal-return assumption.
-- Pure preferences/behaviour — NO money values live here. RLS-owned per user, single row (unique user_id).
-- data jsonb shape: { checklist: { [key: string]: boolean }, asOf: string (ISO), goalReturnAssumption: number }

create table public.profile (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id)
);

alter table public.profile enable row level security;

create policy profile_owner on public.profile
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
