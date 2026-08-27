# ARCHITECTURE.md — wealth-os system map

A working map of the codebase for a fresh reviewer, written during the Fable audit (redone
2026-08-27 after a container reset — see `AUDIT.md`). `CLAUDE.md` is the operating contract;
this file is the "where does X live and how does data actually flow" reference.

---

## What this is

A single-user personal finance OS: Indian bank/credit-card/broker statements → deterministic
paise-exact parsing → a fixed 276-name Monika Halan taxonomy → a dashboard (net worth, cash flow,
buckets, leakage, a "Compass" health-check view). Next.js 15 (App Router), Supabase
(Postgres/Auth/RLS), Vercel. No feature ever sends a money value (amount/date/balance) to an LLM.

## Stack

Next.js 15 (webpack, not Turbopack), React 19, TypeScript strict (bundler resolution), Tailwind v3
+ CSS-variable theming, vendored shadcn-style primitives (`src/components/ui/`), Recharts, Framer
Motion, `@supabase/ssr`. Pure-logic deps: `cheerio` (HTML parsing), `xlsx` (broker/MM workbooks),
`yaml` (seed data). Nothing else without a reason — see CLAUDE.md's "Stack (locked)".

## Directory layout

```
src/app/
  page.tsx, login/, auth/callback/          landing, auth, magic-link/OAuth callback
  (app)/                                    authed pages, all `export const dynamic = "force-dynamic"`
    dashboard/                              net worth, cash flow, buckets, leakage, present value
    transactions/                           the ledger + Review panel (enrichment, AI-suggest, rules)
    accounts/, holdings/, loans/            per-domain management pages
    buckets/[bucket]/, insights/[metric]/   drill-down pages sharing loadDrillData()
    compass/                                Halan-style financial-health check (machineH1..H6)
    calculators/, integrations/, settings/  tax regime calc, LLM/price provider config, misc
  api/
    import/, commit/                        the core pipeline (parse → reconcile → persist)
    holdings/{import,commit,map}/           broker holdings pipeline (separate from txn pipeline)
    enrich/, enrich/money-manager/,         post-commit enrichment (never inserts, only updates)
      enrich/google-pay-statement/
    ai/{suggest,apply}/                     LLM category suggestions (description-only prompt)
    rules/{apply,create,reorder}/           vendor-rule engine + global re-apply
    bootstrap/                              per-user idempotent taxonomy/rules/accounts seed
    cron/daily/                             Vercel cron: Supabase keepalive + weekly price refresh
    loans/, upstox/{dividends,tax}/         loan schedule + Upstox-specific broker imports
    integrations/, accounts/                config + account CRUD

src/lib/
  ingest/                  parsers/*.ts (one per statement format) + dispatch.ts, rules.ts, util.ts
                           (hashing/normalization), wire.ts (client/server DTOs), enrich.ts,
                           money-manager.ts, google-pay-category-map.ts, money-manager-category-map.ts
  halan.ts                 bucket aggregation, cash flow, leakage, holdings present value — pure
  compass.ts               the H1-H6 "machine" health checks + freedom/lifestyle-creep ratios — pure
  drilldown.ts             shared per-transaction aggregation for the drill-down pages
  calc/tax.ts              old-vs-new tax regime engine — pure, gate-verified against real slabs
  holdings.ts              ISIN → AMFI scheme code / Yahoo symbol auto-mapping — pure
  prices/                  PriceSource adapters (mfapi/amfi/mfdata/yahoo/manual) + refreshPrices()
  llm/                     provider adapters (gemini, openai) — description-only prompts, no money
  integrations.ts          LLM/price provider catalog + pure dispatch-resolution logic
  supabase/                server/browser/middleware/service clients; NEVER instantiated at module
                           scope (prerender has no session) — see CLAUDE.md gotchas
  server/                  shared server-side helpers (load-drill.ts, rules.ts category guard)
  client/                  shared client-side helpers (category-write.ts)
  auth/                    pure auth helpers (safeNextPath, constantTimeEqual — both audit fixes)
  accounts/format.ts       account-detail display formatting — pure
  seed-data.ts             GENERATED (npm run data:generate) taxonomy + rules + accounts

scripts/verify.ts          THE GATE — every fixture parsed + reconciled, every pure-logic unit test
supabase/migrations/       0001 (full initial schema + RLS) through 0010, additive from there
fixtures/                  synthetic, format-faithful statement samples (committed; gate input only)
```

## Data flow: the core pipeline

```
Source statement (md/html/xlsx)
  -> src/lib/ingest/parsers/*        deterministic parse; each parser proves its own reconciliation
  -> finalizeHashes (util.ts)        content_hash = sha256(account|date|amount|normdesc|occurrence)
  -> POST /api/import                re-parses server-side, rule-suggests categories — NOTHING persisted
  -> import wizard (client)          human confirms category + leakage tag per row
  -> POST /api/commit                re-validates categories + re-derives hash, upserts (dedup by
                                      unique index), sets/advances the account's net-worth anchor
  -> Supabase (RLS)                  transactions, imports, accounts, categories, vendor_rules
  -> loadDrillData() (server-side)   single source of truth for per-txn rows; feeds dashboard,
                                      buckets/[bucket], insights/[metric], compass, accounts pages
  -> halan.ts / compass.ts           pure aggregation -> net worth / cash flow / buckets / leakage /
                                      health-check bands
```

Post-commit **enrichment** (Money Manager `.xlsx`, Google Pay statement `.md`, BHIM/GPay "My
Activity" exports via `/api/enrich`) is a *second*, strictly additive pass: it only `UPDATE`s
already-committed rows (merchant text, one replaceable provenance-tagged `notes` line, and category
*only* over an `Uncategorized Review` row) — it never `INSERT`s, because that money already exists
in the bank/CC statement and would double-count.

Holdings (`/holdings`, Zerodha/Upstox) are a **separate, parallel pipeline** — `holdings_snapshots`
+ `instruments`, no `imports` row, ISIN-keyed auto-mapping to a price source, valued via
`holdingsValue()` in `halan.ts` (latest `prices` row per ISIN, last-known-price fallback).

## Trust boundaries (see AUDIT.md FA-5 for the corrected, precise statement)

- **Server-authoritative at commit:** category re-validated against the taxonomy; content hash +
  occurrence re-derived (client cannot set them); dedup enforced by a DB unique index.
- **Client-trusted at commit:** amount/date/description are *echoed back* from the client's
  `/api/import` response, not re-parsed from the source file at commit time. The intended flow
  never exploits this (client forwards import output untouched), but it is not currently enforced
  server-side. Recorded as a follow-up, not current behavior — do not assume otherwise.
- **No money to LLM, ever:** `ai/suggest` selects only `id,description_raw,merchant` — asserted by
  the gate's `verify.ts` structural check, not just code review.

## Auth & RLS model

`@supabase/ssr` cookies; `middleware.ts`-guarded authed routes. Every user-data table carries
`user_id` + an owner RLS policy (`accounts`, `categories`, `transactions`, `imports`,
`vendor_rules`, `holdings_snapshots`, `loans`, `loan_schedule_rows`, `integrations`, `profile`,
realized-gain tables). Reference tables (`instruments`, `prices`, `price_sources`) are read-only to
authenticated users, written only by the service-role client (`src/lib/supabase/service.ts`).
Application code additionally scopes account lookups by `user_id` (defense in depth — RLS is the
real guard, but a second explicit filter costs nothing and survives an RLS misconfiguration).

## Taxonomy & money invariants (enforced, not just documented)

- **276 names = 15 parents + 261 leaves**, hard-asserted by the gate (`verify.ts`) — a taxonomy
  drift fails the build, not just a lint.
- **Integer paise everywhere.** `parseAmount` throws on anything unclean; no float ever enters a
  money path; formatting to rupees happens only at the view boundary (`format.ts`).
- **Leakage is a tag, not a category.** The auto-categorizer (rules, AI-apply, enrichment) can
  never assign a category whose parent is `14 Cash Leakage Watchlist` or `15 Review Buckets` —
  enforced by `guardCategory` at every write path and gate-asserted structurally.
- **Dedup is a DB-level guarantee**, not application logic: `unique(account_id, content_hash)` in
  `0001_init.sql`. Re-importing an overlapping statement inserts zero rows, by construction.

## The gate

`npm run verify` (→ `scripts/verify.ts`) parses every fixture, asserts each statement's own
opening→closing arithmetic against the parsed sum, proves re-import idempotency, structurally
checks the LLM trust boundary and the 14/15 auto-assign wall, and unit-tests every pure-logic
module (`halan.ts`, `compass.ts`, `calc/tax.ts`, the ingest parsers, the audit's new pure helpers).
It is the only check with runtime + DB visibility this repo has None — see AUDIT.md's closing note
on why a runtime/integration tier is the top recommended next investment.

## What this map deliberately omits

Full API contract shapes (`wire.ts` is the source of truth), the Compass "H1–H6 machine" formula
derivations (`compass.ts` docblocks), and per-parser statement-format quirks (each parser file's
own comments + `CLAUDE.md`'s "Confirmed facts" are more precise than a summary here would be).
