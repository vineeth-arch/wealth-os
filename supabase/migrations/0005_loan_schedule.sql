-- wealth-os 0005_loan_schedule
-- Imported loan repayment schedules. A computed loan keeps storing only its params (Prompt 07) and
-- the app derives the amortization; an IMPORTED loan carries its actual, lender-issued schedule whose
-- irregular first installment (broken-period interest) and final rounding a clean amortizer cannot
-- reproduce — so those rows are the source of truth and are stored verbatim. Money is bigint paise.

alter table public.loans
  add column source text not null default 'computed' check (source in ('computed','imported'));

create table public.loan_schedule_rows (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  loan_id uuid not null references public.loans(id) on delete cascade,
  instl_no int not null,
  due_date date not null,
  instl_paise bigint not null,
  principal_paise bigint not null,
  interest_paise bigint not null,
  os_principal_paise bigint not null,
  unique (loan_id, instl_no)
);

alter table public.loan_schedule_rows enable row level security;

create policy loan_schedule_rows_owner on public.loan_schedule_rows
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
