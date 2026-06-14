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
src/app/                 App Router: login, auth/callback, (app)/{dashboard,import,review,accounts,holdings,calculators,integrations}, api/{import,commit,bootstrap,integrations,holdings/*,cron/daily}
src/components/          app-shell, import-wizard, review-table, charts, integrations-panel, holdings-panel, tax-calculator, ui/* (vendored shadcn-style primitives)
src/lib/ingest/          verified parsers, money/date utils, hashing, rule engine, dispatch, wire types
src/lib/prices/          PriceSource adapters (mfapi/amfi/mfdata/yahoo/manual) + refreshPrices; pure parse helpers tested in the gate
src/lib/holdings.ts      instrument auto-mapping (ISIN -> AMFI scheme / Yahoo symbol), pure
src/lib/calc/tax.ts      tax-regime engine (integer paise; slabs verified + gate-asserted)
src/lib/integrations.ts  LLM provider catalog + pure status derivation
src/lib/halan.ts         bucket aggregation + holdings present value (pure, tested)
src/lib/supabase/        server/browser/middleware/service clients (@supabase/ssr; service = reference-table writes)
src/lib/seed-data.ts     GENERATED taxonomy + rules + accounts for in-app bootstrap
scripts/verify.ts        the gate - parsers + Halan math
supabase/migrations/0001_init.sql   full schema with RLS, dedup unique index, reference seeds
fixtures/                real statements (git-ignored)
```

## Shipped in this sub-pass

- Integrations page (`/integrations`) - LLM provider selection (Anthropic default; OpenAI/Gemini/OpenRouter) and price-source connect/status. **LLM keys are server env vars** (presence ⇒ "connected"), never in the browser or DB - see strategy note below.
- Price layer - `PriceSource` adapters: mfapi (primary MF NAV), amfi (NAVAll.txt, shared with MF auto-mapping), mfdata fallback, yahoo-finance2 (NSE/BSE/demat-SGB), manual_ibja (gold). `refreshPrices()` writes `prices` via the service role.
- One daily Vercel cron (`/api/cron/daily`): keepalive every run (Supabase free pauses at ~7 days idle) + weekly price refresh gated inside the handler.
- Holdings (`/holdings`) - Zerodha workbook -> `instruments` + `holdings_snapshots`, with ISIN->source-code auto-mapping (human confirms the rest). Dashboard shows present value (last-known-price fallback), as-of date, and cash-vs-total net worth.
- Calculators (`/calculators`) - old vs new tax regime (salaried, v1); FY 2025-26 / AY 2026-27 slabs verified by web search and asserted in the gate.

### Integrations strategy (scope boundary)

- APIs integrated here are **price APIs only** (mfapi / mfdata / amfi / Yahoo / manual_ibja).
- Explicitly **out of scope**: Kite/Upstox brokerage APIs, Tickertape, any third-party MCP integration.
- **Account Aggregator is the north-star** for a real-time account feed - logged as direction, not a build item.

## Deferred to a later sub-pass (cleanly separable)

- AI assist - `description_clean` cleanup + category *suggestions* only; amounts/dates/balances never sent to an LLM. This is what consumes the integrations LLM selection.
- Server-encrypted LLM key entry from the UI (into `integrations.encrypted_secret`), and browser-encrypted statement passwords (`bank_profiles`).
- Physical/digital gold ingestion (`manual_ibja`) + an `asset_snapshot` account. Demat-held SGBs are already covered via the Zerodha + Yahoo path.
- §87A marginal relief (and the new-regime special marginal-relief band); more calculators.
- BHIM UPI merchant enrichment surfacing.
- Loan module follow-ups: multi-loan optimisation (avalanche vs snowball ordering) and pulling live loan balances from statements — manual entry only for now.
- IPS / rebalancing engine and a full net-worth forward-projection module; EPF/PPF/NPS maturity projection (needs those balances ingested first, via future EPFO/NPS/CAS parsers).
- Capital-gains tax: loss set-off / carry-forward, cess & surcharge, and slab treatment of F&O/commodities/currencies (currently surfaced as slab income, not taxed in the calculator).
