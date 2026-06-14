-- wealth-os 0007_money_manager_enrichment
-- Money Manager (.xlsx) is an ENRICHMENT source for transactions already imported — never an importer.
-- It needs a place to append her human note context and to record provenance for idempotent re-uploads.
--
-- 1) `notes`            : free-text the enricher appends to (one replaceable "MM: …" line). The existing
--                         UPI enricher only ever wrote `merchant`; there was no notes column before now.
-- 2) `enrichment_source`: which external source last enriched this row (e.g. 'money_manager').
-- 3) `mm_row_ref`       : the matched Money Manager row's stable hash, so a re-uploaded/updated export
--                         updates the same transaction in place instead of duplicating.
-- 4) category_source gains 'money_manager' so an applied MM category is distinguishable, sticks (the
--    AI-suggest scan only touches 'default'), and stays user-reviewable. `description_raw` is untouched.

alter table public.transactions add column if not exists notes text;
alter table public.transactions add column if not exists enrichment_source text;
alter table public.transactions add column if not exists mm_row_ref text;

alter table public.transactions drop constraint if exists transactions_category_source_check;
alter table public.transactions add constraint transactions_category_source_check
  check (category_source in ('rule','ai_suggested','user','default','money_manager'));
