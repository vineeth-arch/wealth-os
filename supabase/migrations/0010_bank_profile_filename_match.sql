-- 0010: statement-password profiles gain a filename glob for import-time auto-suggest.
-- bank_profiles already holds the browser-encrypted PDF password (password_ciphertext, kdf_salt,
-- kdf_iterations) with an owner RLS policy (see 0001_init.sql). The only addition needed for the
-- in-app converter is a glob pattern (e.g. *HDFC*statement*) matched against the picked filename so
-- the right saved password is suggested. Nullable: a profile may exist without a glob.
alter table public.bank_profiles add column if not exists filename_match_pattern text;
