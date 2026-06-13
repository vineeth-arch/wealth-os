-- wealth-os 0002_account_details
-- Real-world identity for each account, for a copy-pastable "send me money" block.
-- Manual entry only (this data is in no parsed statement). All NULLABLE TEXT.
--
-- RLS: no change. accounts already has the `accounts_owner` policy
-- (for all using auth.uid() = user_id), which governs the whole row including new columns.
--
-- Privacy: the full account_number is stored and shown INTENTIONALLY (it's for receiving funds).
-- Single-user app behind auth + RLS; do not mask it and do not log it.

alter table public.accounts
  add column account_holder_name text,
  add column account_number      text,
  add column ifsc                text,
  add column branch              text,
  add column account_type        text,
  add column upi_id              text;
