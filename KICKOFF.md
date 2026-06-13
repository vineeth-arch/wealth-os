# Claude Code kickoff — wealth-os, next sub-pass

Read `CLAUDE.md` first and obey it. Run `npm run verify` before claiming anything done.
Build ONLY the scope below. Anything else goes to README "Deferred", not into code.

## Scope (in order)
1. **Integrations page** (`/integrations`): connect/disconnect + status (connected | not_connected | error) for
   LLM providers (Anthropic default; OpenAI / Gemini / OpenRouter selectable) and price sources
   (mfapi, mfdata, amfi, yahoo, manual_ibja — rows already seeded). Persist to the `integrations` table.
   - **LLM API keys are encrypted in the browser** (passphrase-derived key; store ciphertext + kdf_salt). The server never sees plaintext. Mirror the approach used for `bank_profiles`.
2. **Price layer**: a `PriceSource` adapter interface with implementations:
   - `mfapi` (primary, MF NAV by AMFI scheme code; free, no auth), `mfdata`/`amfi` fallbacks,
   - `yahoo` via `yahoo-finance2` for NSE `.NS` / BSE `.BO` equities and listed SGBs (server-side only — CORS),
   - `manual_ibja` for unlisted gold.
   Write fetched NAV/price to `prices`. Instrument identity is `isin`; map MF -> `amfi_scheme_code`, equity/SGB -> `yahoo_symbol`, confirmed on first sight (human-in-the-loop, like vendor rules).
3. **Crons** (`vercel.json`): weekly Supabase keep-alive (ping a trivial authed-by-service route), and a price-refresh job (EOD/weekly is fine). Use `SUPABASE_SERVICE_ROLE_KEY` server-side only.
4. **Holdings/snapshot UI**: surface the already-verified Zerodha holdings parser -> `holdings_snapshots` + `instruments`; show present value on the dashboard using `prices`.
5. **Calculators**: tax-regime comparison first (salaried, v1).
   - **Verify FY slabs at build time — web-search the current AY rates, do NOT recall them from memory.** A wrong slab table is worse than no calculator. Cite the source in a comment.

## Hard rules (from CLAUDE.md — non-negotiable)
- No money value (amount/date/balance) ever passes through an LLM. AI = description cleanup + category *suggestions* only.
- Do not edit `src/lib/ingest/parsers/*` or remove the `webpack.extensionAlias` in `next.config.mjs`.
- Money is integer paise; format only at the view boundary.
- Leakage stays a tag; never auto-assign parent 14/15 categories.
- Every new capability ends in something checkable (gate / `tsc` / `next build` / a reconciliation or a unit test). Add the check in the same change.
- Smallest change that passes the gate. Surface conflicts; don't silently resolve them.

## Definition of done
`npm run verify` green, `npm run typecheck` clean, `npm run build` green, and a one-line note per feature of how it's verified.
