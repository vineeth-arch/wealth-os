-- wealth-os 0008_google_pay_statement_enrichment
-- The Google Pay official "Transaction statement" is a SECOND enrichment source. It reuses the
-- `notes` + `enrichment_source` columns added for Money Manager (0007), but needs a SOURCE-AGNOSTIC
-- provenance ref (0007's `mm_row_ref` is Money-Manager-specific). Add a generic `enrichment_ref` and
-- extend the category_source CHECK so an applied GPay category is distinguishable, sticks (the
-- AI-suggest scan only touches 'default'), and stays user-reviewable. `description_raw` is untouched.

alter table public.transactions add column if not exists enrichment_ref text;

alter table public.transactions drop constraint if exists transactions_category_source_check;
alter table public.transactions add constraint transactions_category_source_check
  check (category_source in ('rule','ai_suggested','user','default','money_manager','google_pay_statement'));
