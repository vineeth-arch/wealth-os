-- wealth-os 0008_rule_hits
-- Vendor rules are already a user-global, editable repository (0001: no account_id, just user_id + RLS,
-- with `priority` for first-match-wins order and `active` to enable/disable). This migration only adds
-- per-rule re-run telemetry so the Rules tab can show a "hit count" that survives a page reload.
--
-- 1) `last_hit_count` : how many transactions this rule matched on the most recent "Re-run rules across
--                       all transactions" pass. Null until the first re-run.
-- 2) `last_run_at`    : when that re-run happened. Null until the first re-run.
-- Both are pure telemetry — they never affect matching, ordering, or the 14/15 guard.

alter table public.vendor_rules add column if not exists last_hit_count int;
alter table public.vendor_rules add column if not exists last_run_at timestamptz;
