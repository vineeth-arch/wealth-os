# HANDOFF.md — wealth-os onboarding ground truth

> **Gate baseline:** green at the merge of `origin/main` into `claude/laughing-planck-00qsmh` (`c57e3fa`) — `npm run verify` (ALL GATES PASSED), `npm run typecheck` (clean), `npm run build` all exit 0 on 2026-06-14.
>
> **Scope note:** this audit was first run on `claude/laughing-planck-00qsmh` *before* `origin/main` (which carries the Compass) was merged in. The tables below reflect the **post-merge** tree (Compass present). The earlier baseline `66ba476` was the pre-merge, docs-only state.
>
> **Method:** every claim below is grounded in a file actually read in this repo and cited by `path` (line where useful). Where a doc (`CLAUDE.md`, `README.md`, `USER_GUIDE.md`, prompts) disagrees with the code, **the code wins here** and the disagreement is logged as drift in `AUDIT.md`. Read this with `CLAUDE.md`; the two together are enough to work safely.

---

## 1. 60-second orientation

- **What it is:** a private, single-user, import-only Personal Wealth OS. Indian bank/card/broker statements → paise-exact deterministic parsing → Monika Halan taxonomy → dashboard. Stack: Next.js 15 App Router + React 19 + TypeScript (strict) + Supabase (Postgres/Auth/RLS) + Vercel (`package.json`, `CLAUDE.md`).
- **Import-only, one pool:** data exists only after a statement is imported and committed. There is no live bank pull. The Personal-vs-Business split is **by category, not by account** — `accounts.kind` has no personal/business flag (`supabase/migrations/0001_init.sql`).
- **Money is integer paise end-to-end.** `parseAmount` returns paise and throws on anything unclean; rupees appear only at the view boundary (`src/lib/ingest/util.ts`, `src/lib/format.ts`).
- **Sign convention:** `+` = inflow to the account, `−` = outflow; re-asserted in aggregation (`src/lib/halan.ts:79-82`).
- **Taxonomy:** 276 category names = 15 parents + 261 leaves (`supabase/seed/taxonomy_master_from_sure.csv`, generated into `src/lib/seed-data.ts`). Leakage is a **tag**, not a category (`src/lib/halan.ts:24`).
- **Dedup:** `content_hash = sha256(account | ISO-date | amountPaise | normalizeDesc(descriptionRaw) | occurrence)`, **merchant excluded** (`src/lib/ingest/util.ts:72-74`). Re-importing an overlapping period inserts nothing.
- **Trust boundary (the hard wall):** only description text reaches an LLM — the AI-suggest route selects `id, description_raw, merchant` and nothing else (`src/app/api/ai/suggest/route.ts:38`). No amount/date/balance/account ever leaves the server.
- **The gate is ground truth:** `npm run verify && npm run typecheck && npm run build`. `verify` (`scripts/verify.ts`) parses every fixture, asserts each statement reconciles, proves idempotency, and unit-tests the math — **without touching the DB**.
- **Compass (the proprietor lens):** present post-merge — `src/lib/compass.ts` computes the personal-vs-business lens with the identity `personalIncome = allIncome − businessCosts − tax` (parent 11 costs, parent 12 tax) over a 6-month trailing window (`compass.ts:47,15`); surfaced at `/compass`. Gate-tested in `scripts/verify.ts` (Machine H1–H6 + Mirror).
- **Where to start reading:** `CLAUDE.md` (operating contract) → `src/lib/ingest/` (parsers + util) → `scripts/verify.ts` (what's actually guaranteed) → `src/lib/halan.ts` + `src/lib/drilldown.ts` + `src/lib/compass.ts` (aggregation) → `src/app/` (framework).

---

## 2. Run it

```bash
npm install
npm run dev        # local dev (needs .env.local)
npm run verify     # THE GATE — parsers reconcile on real fixtures + math unit tests → exit 0
npm run typecheck  # tsc --noEmit
npm run build      # next build
```

**Environment variables** (derived from a `process.env` grep; all keys are server-only):

| Var | Purpose | Where set | Read at |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL | Vercel + `.env.local` | `src/lib/supabase/{client,server,middleware}.ts` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Anon key (RLS-scoped, browser-safe) | Vercel + `.env.local` | same |
| `SUPABASE_SERVICE_ROLE_KEY` | Service client; writes reference tables, bypasses RLS | Vercel server env only | `src/lib/supabase/service.ts:11` (read inside fn) |
| `GEMINI_API_KEY` | Gemini AI-suggest key | Vercel server env | `src/lib/llm/gemini.ts:36` (server-only file) |
| `GEMINI_MODEL` | Override Gemini model | optional | `src/lib/llm/gemini.ts:38` |
| `OPENAI_API_KEY` | OpenAI AI-suggest key | Vercel server env | `src/lib/llm/openai.ts:83` (server-only file) |
| `OPENAI_MODEL` | Override OpenAI model | optional | `src/lib/llm/openai.ts:85` |
| `CRON_SECRET` | Auth for the daily Vercel cron | Vercel server env | `src/app/api/cron/daily/route.ts:19` |
| `ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY` | Listed providers in `integrations.ts` — **no adapter wired** | n/a | `src/lib/integrations.ts:24,27` |

**Migrations are applied by the human, not the gate.** A green build/deploy does **not** mean a migration ran. Apply new SQL in the Supabase SQL editor: `https://supabase.com/dashboard/project/ouhcdhyxuzhgkploncmt/sql/new`, then redeploy if needed. The gate never connects to the DB.

---

## 3. Invariants (verified against code)

| # | Invariant | Status | Proving file:path |
|---|---|---|---|
| 1 | Money = integer paise; throws on unclean | PASS | `src/lib/ingest/util.ts` (parseAmount), `*_paise` columns in `0001_init.sql`, format only at `src/lib/format.ts` |
| 2 | Sign: + inflow / − outflow | PASS | parsers (`parsers/hdfc.ts`, `parsers/idfc-cc.ts` DR/CR); re-asserted `src/lib/halan.ts:79-82`, `src/lib/drilldown.ts` |
| 3 | Taxonomy 276 = 15 parents + 261 leaves; leakage is a tag | PASS | `supabase/seed/taxonomy_master_from_sure.csv` (276 rows, 15 with empty parent), `src/lib/seed-data.ts` (276 `"parent"`, 15 null, 24 `autoAssignable:false`); `LEAKAGE_TAG` `src/lib/halan.ts:24`; rule refusal `src/lib/ingest/rules.ts`, `src/lib/server/rules.ts`. (Count is **printed** by `scripts/verify.ts:528` but not hard-asserted — see AUDIT C-1.) |
| 4 | content_hash = sha256(account\|ISO\|amount\|normalizeDesc(raw)\|occurrence); merchant excluded; raw desc immutable | PASS | `src/lib/ingest/util.ts:72-74`, `finalizeHashes` :92-103 |
| 5 | accounts.kind ∈ {bank, credit_card, broker, asset_snapshot}; no personal/business flag; lens is category-driven | PASS | `supabase/migrations/0001_init.sql` (CHECK); no business flag anywhere |
| 6 | Only description text reaches the LLM | PASS (highest value) | `src/app/api/ai/suggest/route.ts:38,46` (selects `id,description_raw,merchant`; payload `description_raw · merchant`), `src/lib/llm/prompt.ts`, `gemini.ts`, `openai.ts` |
| 7 | LLM keys = server env only | PASS | `src/lib/llm/gemini.ts:36`, `openai.ts:83` (server-only headers); client reads only `NEXT_PUBLIC_*`; `integrations.ts` stores choice only |
| 8 | RLS on every user-owned table | PASS | owner policies (`auth.uid() = user_id`) in `0001`–`0006` (incl. `profile`); reference tables (`instruments`, `prices`, `price_sources`) read-only to authenticated |
| 9 | Reconcile-or-show | PASS | parsers + per-statement opening→closing assertions in `scripts/verify.ts` |
| 10 | Gate never touches the DB (green ≠ migration applied) | PASS | `scripts/verify.ts` runs parsers/math only; no Supabase client imported |

---

## 4. Architecture

**Layered flow** (`CLAUDE.md` Architecture, confirmed against code):

```
Source statement (md/html/xlsx)
  → src/lib/ingest/parsers/*     deterministic parse + per-row reconciliation
  → finalizeHashes (util.ts)     occurrence + content hash
  → /api/import                  reconcile + rule-suggest categories (nothing persisted)
  → import wizard (client)        human confirms category + leakage tag
  → /api/commit                  re-validate, dedup-upsert, set anchor
  → Supabase (RLS)               transactions, imports, accounts, categories, vendor_rules
  → /dashboard (server)          halan.ts → net worth / cash flow / buckets / leakage
```

Pure logic (`src/lib/ingest/`, `halan.ts`, `drilldown.ts`, `format.ts`, `calc/*`) imports no React/Next and runs under `tsx`. Framework code is confined to `src/app/` and `src/components/`.

**Route map (pages that exist on this branch — `src/app/`):**

| Route | Purpose | Key files |
|---|---|---|
| `/` | Root redirect to dashboard/login | `src/app/page.tsx` |
| `/login` | Supabase auth | `src/app/login/page.tsx`, `src/app/auth/callback/route.ts` |
| `/dashboard` | Net worth, cash flow, buckets, leakage, balances | `src/app/(app)/dashboard/page.tsx`, `src/lib/halan.ts` |
| `/compass` | Machine (H1–H6) + Mirror; proprietor personal/business lens | `src/app/(app)/compass/page.tsx`, `src/lib/compass.ts`, `src/components/compass/*` |
| `/transactions` | Hub — Import / Review / Rules tabs (`?tab=`) | `src/app/(app)/transactions/page.tsx` |
| `/accounts` | Accounts, anchors, workspace bootstrap | `src/app/(app)/accounts/page.tsx`, `src/lib/accounts/format.ts` |
| `/holdings` | Zerodha + Upstox holdings → present value | `src/app/(app)/holdings/page.tsx`, `src/lib/holdings.ts` |
| `/loans` | Amortization + prepayment + stored lender schedule | `src/app/(app)/loans/page.tsx`, `src/lib/calc/loan.ts` |
| `/calculators` | Tabbed calculators hub | `src/app/(app)/calculators/page.tsx`, `src/lib/calc/*` |
| `/insights/[metric]` | Drill-down: income·spend·invest·leakage·net | `src/app/(app)/insights/[metric]/page.tsx`, `src/lib/drilldown.ts` |
| `/buckets/[bucket]` | Drill-down by one of 15 parent buckets | `src/app/(app)/buckets/[bucket]/page.tsx` |
| `/settings` | LLM provider + price-source selection (choice only) | `src/app/(app)/settings/page.tsx`, `src/lib/integrations.ts` |
| `/help` | In-app user guide | `src/app/(app)/help/page.tsx` |

**Redirects preserving old deep links** (`next.config.mjs`): `/import`→`/transactions?tab=import`, `/review`→`?tab=review`, `/rules`→`?tab=rules`, `/upstox`→`/holdings`, `/integrations`→`/settings`. (So `/upstox` is **not** a standalone page on this branch.)

**Nav** (`src/components/app-shell.tsx` `NAV`): 8 items — Dashboard, **Compass**, Transactions, Accounts, Holdings, Loans, Calculators, Settings. The `/help` link is a separate `?` icon in the sidebar footer (not a nav item).

**API routes (`src/app/api/`):** `accounts`, `bootstrap`, `import`, `commit`, `enrich`, `integrations`, `cron/daily`, `ai/{suggest,apply}`, `rules/{,apply,create}`, `holdings/{import,map,commit}`, `loans/{,[id],import-schedule}`, `upstox/{tax/import,tax/commit,dividends/import}`. Only `ai/suggest` calls an LLM.

**Lib map (`src/lib/`):** `halan.ts` (bucket aggregation, sign, balances, holdings value), `drilldown.ts` (insight/bucket drill math — mirrors halan sign rules), `format.ts` (rupee/INR view boundary), `holdings.ts` (ISIN/symbol auto-mapping), `integrations.ts` (LLM provider catalog + pure status/dispatch), `recategorize.ts` (manual recategorize / add-as-rule), `busy.ts` (global busy store for nav-guard), `ingest/*` (parsers, `util.ts`, `types.ts`, `rules.ts`, `dispatch.ts`, `enrich.ts`, `wire.ts`), `llm/*` (`provider.ts`, `prompt.ts`, `gemini.ts`, `openai.ts`), `calc/*` (`tax.ts`, `loan.ts`, `sip.ts`, `retirement.ts`, `hlv.ts`, `capital-gains.ts`, `emergency.ts`), `prices/*` (`amfi`, `mfapi`, `mfdata`, `yahoo`, `manual`, `index`, `types`), `server/*` (`rules.ts`, `load-drill.ts`), `supabase/*` (`client`, `server`, `middleware`, `service`), `accounts/format.ts`, `client/category-write.ts`, `utils.ts`.

**Busy / nav-guard:** `src/lib/busy.ts` is a pure reducer (begin/end ops, clamps at 0); `src/components/guarded-link.tsx` (`GuardedLink`) confirms before navigating away while an op is running. Both are gate-tested in `scripts/verify.ts` (busy store checks).

---

## 5. Data model

All money columns are **integer paise** (`*_paise`). All user-owned tables carry `user_id` + an owner RLS policy `auth.uid() = user_id`. Reference tables are read-only to authenticated users, written by the service role.

**Per-migration changelog** (read from `supabase/migrations/`):

| File | Adds |
|---|---|
| `0001_init.sql` | Core schema + RLS: `accounts` (kind ∈ {bank, credit_card, broker, asset_snapshot}, anchor_balance_paise/date), `categories` (parent_id, auto_assignable), `imports` (opening/closing/parsed_sum paise, reconciled), `transactions` (amount_paise, balance_after_paise, description_raw/clean, merchant, category_id, category_source, tags, content_hash, occurrence, unique(account_id, content_hash); indexes on (user_id, txn_date), category_id, tags), `vendor_rules`, `instruments` (ISIN PK, asset_class — reference), `holdings_snapshots`, `price_sources`/`prices` (reference), `integrations`, `bank_profiles` |
| `0002_account_details.sql` | `accounts`: + account_holder_name, account_number, ifsc, branch, account_type, upi_id |
| `0003_upstox.sql` | `holdings_snapshots.avg_price_paise` DROP NOT NULL (Upstox has no cost basis); new `realized_gain_segments`, `realized_gain_lots` (FY + segment, paise) |
| `0004_loans.sql` | `loans` (kind, principal_paise, annual_rate_pct, tenure_months, start_date, emi_category) |
| `0005_loan_schedule.sql` | `loans.source` CHECK ∈ {computed, imported}; new `loan_schedule_rows` (per-installment principal/interest/os, stored lender schedule) |
| `0006_profile.sql` | `profile` (one row per user, `data` jsonb = Compass reflection checklist + goal-return assumption; **no money**; RLS owner policy) |

---

## 6. Subsystems

**(a) Parsers (`src/lib/ingest/parsers/`).** Fixture-is-the-spec: each parser reverse-engineers exact layout/quirks from a real fixture in `fixtures/`, and reconciles to the statement's own opening→closing totals. Institutions: `hdfc.ts` (HDFC savings, fixed-width), `sbi.ts` (SBI, MarkItDown markdown table), `idfc-bank.ts` (IDFC bank, text+markdown), `federal.ts` (Federal, 12 monthly statements/file), `idfc-cc.ts` (IDFC CC, multi-render dedup, DR/CR sign), `suryoday-cc.ts` (Suryoday CC, interleaved pages, ref-dedup, subset-sum boundary days), `hdfc-loan.ts` (loan schedule), `market.ts` (BHIM UPI html + Zerodha xlsx + Google Pay), `upstox.ts` (holdings/dividends/tax xlsx). **To add a parser:** mirror an existing adapter under `parsers/`, register it in `src/lib/ingest/dispatch.ts`, add a fixture, and add reconciliation assertions in `scripts/verify.ts` (the new parser is not "done" until the gate proves it).

**(b) Taxonomy + rules + AI categorizer + enrichment.** Taxonomy CSV → generated `seed-data.ts` (via `scripts/generate-app-data.ts`) and `seed.sql` (via `scripts/generate-seed.ts`). `src/lib/ingest/rules.ts` loads taxonomy + vendor rules and refuses any rule targeting parents 14/15 (leakage is a tag, set at review). `src/lib/server/rules.ts` re-guards on `auto_assignable`. AI categorizer: provider abstraction in `src/lib/llm/provider.ts` + `integrations.ts` `resolveLlmDispatch`; prompt built in `prompt.ts` (description + category names only); adapters `gemini.ts`, `openai.ts`. Enrichment (`ingest/enrich.ts`): matches UPI counterparties to transactions by (date, amount, sign), reports ambiguous instead of guessing, writes only `{id, merchant}`.

**(c) Holdings / prices / cron.** `holdings.ts` auto-maps ISIN→AMFI scheme / symbol→Yahoo `.NS` before asking the human. `prices/*` adapters all return integer paise; `prices/index.ts` selects the most recent price per ISIN. `src/app/api/cron/daily/route.ts` is the single daily Vercel cron (keepalive + weekly refresh), gated by `CRON_SECRET`.

**(d) Compass — present (`src/lib/compass.ts`, 512 lines).** Pure proprietor-lens engine: `lensTotals()` splits one pool into personal/business **by category** with the identity `personalIncome = allIncome − businessCosts − tax` (`compass.ts:47`; businessCosts = Σ outflows parent 11, tax = Σ outflows parent 12; business-income leaves under parent 01 resolved from the seed taxonomy, `compass.ts:21`). All ratios use a 6-month trailing window (`TRAILING_WINDOW_MONTHS`, `compass.ts:15`). **The Machine** — `machineH1` cash-flow ratios (save ≥20%, EMI, living cost), `machineH2` emergency fund (bank-kind liquid only, target 6 mo), `machineH3` protection presence, `machineH4` investing consistency, `machineH5` allocation/concentration, `machineH6Leakage` net-worth trend + leakage. **The Mirror** — `freedomRatio`, `lifestyleCreep`, `enjoymentFloor`, `REFLECTIONS` checklist (persisted in the `profile` table, migration `0006_profile.sql` — no money). R/A/G bands via `bandHigher`/`bandLower`; a `reconcile()` proves the lens sums are internally consistent. Surfaced at `/compass` (`src/app/(app)/compass/page.tsx` + `src/components/compass/*`). Gate-tested in `scripts/verify.ts` (`lensTotals`, `computeWindow`, `reconcile`, `machineH1–H6`, Mirror signals).

**(e) Calculators (`src/lib/calc/`).** Pure, gate-tested: `tax.ts` (old/new regime, §87A rebate), `loan.ts` (amortization, EMI, prepayment reduce-tenure vs reduce-EMI), `sip.ts` (SIP/step-up/goal corpus), `retirement.ts` (FIRE corpus + SWP drawdown), `hlv.ts` (Human Life Value), `capital-gains.ts` (STCG/LTCG), `emergency.ts` (emergency-fund sizing). Surfaced at `/calculators`.

**(f) Loans.** Where a lender repayment schedule was imported (`0005`, `loan_schedule_rows`, `loans.source = 'imported'`), the UI shows the **stored** schedule, not a recomputed one; otherwise it computes via `calc/loan.ts`.

---

## 7. Conventions & guardrails

- **Do not touch:** the verified parsers in `src/lib/ingest/parsers/` (they reconcile to the paisa) and `next.config.mjs`'s `webpack.extensionAlias` (lets webpack follow the parsers' `.js`→`.ts` specifiers without editing them).
- **Surface conflicts; never silently resolve them.** If two docs / a type / the DB disagree, stop and flag (this is the project's worst historical defect).
- **Integer paise + ISO dates internally; sign = + inflow / − outflow.** Format to rupees only at the view boundary.
- **Never hardcode category strings** — reference the taxonomy module / `seed-data.ts`; bucket logic keys off the two-digit parent prefix.
- **No money value (amount/balance/date) ever passes through an LLM.** AI may clean descriptions and *suggest* a category; the human confirms.
- **Migrations are human-applied;** the gate never applies them. Smallest change that passes the gate; run the gate before declaring anything done.

## 8. Extension recipes

- **Add a parser:** new file in `src/lib/ingest/parsers/` mirroring an existing one → register in `ingest/dispatch.ts` → add fixture in `fixtures/` → add reconciliation assertions in `scripts/verify.ts`.
- **Add a calculator:** new pure module in `src/lib/calc/` → add a tab in `src/app/(app)/calculators/page.tsx` → assert the math in `scripts/verify.ts`.
- **Add a Compass check:** (when Compass lands) mirror an existing H-check in the compass module → register in its check list → assert in `verify.ts`. Not present on this branch.
- **Add an LLM provider:** add to `LLM_PROVIDERS` in `src/lib/integrations.ts` → implement an adapter mirroring `src/lib/llm/openai.ts` (description-only payload, server-only) → register it in the `ADAPTERS` map used by `src/app/api/ai/suggest/route.ts` → add dispatch checks in `verify.ts`.

## 9. Gotchas (from code + history)

- **Upstox/Excel bogus read-only dims:** the xlsx `dimension ref` is unreliable; the parser ignores it and loads the real used range (`src/lib/ingest/parsers/upstox.ts`).
- **Build-green ≠ migration applied** — apply SQL manually in Supabase.
- **IA/UX refactors cause runtime/lifecycle bugs the gate can't catch** (the gate tests pure logic, not React lifecycle). Do a 2-minute manual click-through after big UI changes.
- **`+` inflow / `−` outflow** is the internal convention everywhere; don't invert.
- **Next 15 `cookies()` is async** — Supabase server client is `await createSupabaseServer()`; never call Supabase at module top-level (prerender has no session). Authed pages use `export const dynamic = "force-dynamic"`.
- **No `next/font/google`** — the build network is restricted; use the system font stack in `globals.css`.
- **Free-tier Supabase pauses after ~1 week idle** — the daily cron keeps it alive.

## 10. Current state & roadmap pointer

- **Shipped (post-merge):** ingestion core (all listed parsers reconcile), app spine (auth, import wizard, review, dashboard), integrations/price/holdings/calculators, loans (with imported schedule), AI category-suggest (description-only), IA v2 routes + drill-downs, the **Compass** (Machine H1–H6 + Mirror, `src/lib/compass.ts` + `/compass`), in-app `/help`.
- **Deferred per `README.md`:** statement-password browser encryption (`bank_profiles`), physical gold ingestion, §87A marginal relief, per-trade Upstox ledger.
- **Live categorization watch-outs:** parent-10 transfers must be tagged as transfers (own-account moves, CC bill payments, money sent to invest) or every ratio breaks; CC bill-payment double-count; Upstox dividend double-count (if a bank credit and an Upstox dividend both book the same payout).
- **Roadmap / plan-of-record:** `README.md` (Deferred + narrative). Treat `README.md` as the plan and `CLAUDE.md` as the operating contract; this file is the verified map.
