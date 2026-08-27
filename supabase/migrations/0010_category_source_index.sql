-- wealth-os 0010_category_source_index
-- ai/suggest and ai/apply both filter transactions on .eq("user_id",...).eq("category_source","default")
-- to find still-uncategorized rows (audit FA-10). 0001's indexes cover (user_id,txn_date), category_id,
-- and tags, but not this hot filter. Partial on category_source='default' — the only value these routes
-- ever query — so the index stays small as most transactions move off "default" over time. Purely
-- additive; no data or existing query is affected.

create index if not exists transactions_user_uncategorized_idx
  on public.transactions (user_id)
  where category_source = 'default';
