# wealth-os

Personal Wealth OS for vn. Import-only ingestion, Monika Halan taxonomy, paise-exact
reconciliation. Next.js 15 + Supabase + Vercel. **No transaction enters the database
unless the statement's own arithmetic proves the parse, and no money value ever passes
through an LLM.**

- Supabase project: `ouhcdhyxuzhgkploncmt` (https://ouhcdhyxuzhgkploncmt.supabase.co)
- Vercel: https://wealth-os-omega.vercel.app/

## Status

**Prompt 1 — verified ingestion core: DONE.** `npm run verify` -> 30 PASS, ALL GATES PASSED.
**Prompt 2 — runnable Next.js app (this pass): DONE.** `npm run build` is green; `tsc` clean.

```
npm install
npm run verify      # parsers + Halan math against real fixtures; exit 0 = all gates pass
npm run typecheck   # tsc --noEmit, clean
npm run build       # next build, green (9 routes)
npm run dev         # local dev server once .env.local is set
```

### What the app does (the monthly ritual)

1. Auth - email + password (magic-link fallback). Supabase SSR cookies; middleware guards every authed route.
2. Accounts - one-click workspace bootstrap seeds the 276-name taxonomy, 110 vendor rules, and the six canonical accounts (idempotent).
3. Import (/import) - pick an account, drop its markdown statement. The server parser runs, reconciles paise-exact, and suggests categories via your rules. Review in a table (category dropdown + one-click leakage tag), then commit. Re-importing an overlapping period inserts nothing.
4. Review (/review) - browse committed transactions, re-categorize, tag leakage; autosaves.
5. Dashboard (/dashboard) - net worth (anchored to the earliest imported statement), monthly cash-flow (income vs spend vs invest, Recharts), spend-by-Halan-bucket, leakage watchlist, per-account balances, review-queue count.

### Verified contracts & invariants

Parser format contracts and architecture invariants are unchanged from Prompt 1 (integer
paise end to end; +=inflow / -=outflow; dedup via sha256(account|date|amount|normdesc|occurrence)
unique per account; Leakage is a TAG, never an auto-assigned category; reporting by
transaction date + calendar month). The Halan bucket math (src/lib/halan.ts) is unit-tested
inside `npm run verify` (income/spend/invest/leakage splits, transfer exclusion, anchor-aware
balances).

Trust boundary (commit): amounts and dates come only from the server-side parse; the client
edits category + tags + include. /api/commit re-derives the content hash from immutable fields,
re-validates every category against the taxonomy, re-checks reconciliation, and dedupes at the DB.

## Running it locally

1. `cp .env.example .env.local` and fill NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY from the Supabase dashboard (Project Settings -> API).
2. Apply the schema: in the Supabase SQL editor (or `supabase db push`), run supabase/migrations/0001_init.sql.
3. `npm run dev`, open http://localhost:3000, create an account, then Accounts -> Set up my workspace.
4. Import a statement. (Real statements stay out of git - fixtures/ is git-ignored.)

Taxonomy/rule changes: edit the CSV/YAML in supabase/seed/, then `npm run data:generate`
(regenerates src/lib/seed-data.ts used by the in-app bootstrap) and/or `npm run seed:generate`
(regenerates supabase/seed/seed.sql for direct DB seeding). Both reuse the validated loaders,
so a Leakage/Review auto-rule or unknown category fails generation.

## Layout

```
src/app/                 App Router: login, auth/callback, (app)/{dashboard,import,review,accounts}, api/{import,commit,bootstrap}
src/components/          app-shell, import-wizard, review-table, charts, ui/* (vendored shadcn-style primitives)
src/lib/ingest/          verified parsers, money/date utils, hashing, rule engine, dispatch, wire types
src/lib/halan.ts         bucket aggregation math (pure, tested)
src/lib/supabase/        server/browser/middleware clients (@supabase/ssr)
src/lib/seed-data.ts     GENERATED taxonomy + rules + accounts for in-app bootstrap
scripts/verify.ts        the gate - parsers + Halan math
supabase/migrations/0001_init.sql   full schema with RLS, dedup unique index, reference seeds
fixtures/                real statements (git-ignored)
```

## Deferred to the next sub-pass (cleanly separable)

- Calculators (tax-regime comparison first; FY slabs verified at build time, not from memory).
- Integrations page - LLM providers (Anthropic default, OpenAI/Gemini/OpenRouter swap) and price sources, with connected/not-connected status; client-side key encryption.
- Price refresh - PriceSource adapters (mfapi.in primary, mfdata.in / AMFI fallback, yahoo-finance2 for NSE/BSE + listed SGBs, IBJA-anchored manual gold), Vercel cron.
- Weekly Supabase keep-alive cron (free tier pauses ~weekly).
- Holdings & snapshot imports - Zerodha holdings (parser already verified) -> holdings_snapshots; BHIM UPI merchant enrichment.
- AI assist - description cleanup + category suggestions (amounts/dates never sent).
