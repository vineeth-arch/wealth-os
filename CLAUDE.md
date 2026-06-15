# CLAUDE.md — wealth-os

A private, import-only Personal Wealth OS. Indian bank/credit-card/broker statements ->
paise-exact parsing -> Monika Halan taxonomy -> dashboard. Next.js 15 (App Router) + Supabase
(Postgres/Auth/RLS) + Vercel. Single user. Money is **integer paise**, end to end.

Fuller narrative is in `README.md`. This file is the operating contract — read it first, every session.

---

## Operating principles (how to behave in this repo)

1. **Verification is ground truth, not your status report.** `npm run verify` exits 0 or it does not. Run it after every change to parsing, hashing, or the taxonomy/rule/Halan logic. Saying "done" without a green gate is the one unforgivable move here. (Generation -> verification loop; keep yourself on a short leash.)
2. **Smallest change that passes the gate.** No drive-by refactors, no "while I'm here." One concern per change. Big diffs are how silent breakage enters.
3. **Surface conflicts; never silently resolve them.** If two docs, a type, and the DB disagree, stop and say so. The single worst defect in this project's history was an agent that silently papered over a spec conflict. Flag, don't guess.
4. **Own the spec; the agent owns syntax.** The invariants and confirmed facts below are the spec. Implement freely *within* them. Changing one is a version-bump decision, not an implementation detail — ask.
5. **This is a verifiable domain. Keep it that way.** Every feature should end in something objectively checkable: the gate, `tsc`, `next build`, a reconciliation equality, a row count. If you add logic with no check, you have added risk, not value.
6. **Lean context.** This file is the lever. Keep it high-signal. If you learn a hard-won fact, add it to "Confirmed facts" in one line; don't bloat.

## The gate (run before declaring anything done)

```bash
npm run verify      # parsers reconcile paise-exact on real fixtures + Halan math unit tests -> exit 0
npm run typecheck   # tsc --noEmit, must be clean
npm run build       # next build, must be green
```

`npm run verify` is the heart. It parses every fixture in `fixtures/`, asserts each statement's
own opening->closing arithmetic equals the parsed sum, proves imports are idempotent, and unit-tests
the bucket math. 30 PASS reports + "ALL GATES PASSED" = good. Anything else = not done.

## Current state

- **DONE — ingestion core:** parsers for SBI, Federal, IDFC bank, IDFC CC, Suryoday CC (markdown), plus Zerodha holdings (xlsx) and BHIM UPI (html). All reconcile. `src/lib/ingest/`.
- **DONE — app spine:** auth, workspace bootstrap, import wizard (parse->reconcile->categorize->commit), review screen, dashboard (net worth, cash flow, Halan buckets, leakage). `next build` green.
- **DONE — integrations/price/holdings/calculators sub-pass:** `/integrations` (LLM provider select — keys are SERVER env vars, not browser-encrypted; price-source status), `src/lib/prices/*` adapters + a single daily Vercel cron (keepalive + weekly refresh), `/holdings` (Zerodha → instruments/holdings_snapshots with ISIN auto-mapping) + dashboard present value, `/calculators` (tax-regime, gate-verified slabs). AI assist remains deferred (`README.md`).
- **DONE — Money Manager enrichment:** household `.xlsx` matched to imported bank/CC txns (direction + exact paise within ±3 days) → improves `merchant`, appends one replaceable `MM:` `notes` line, applies the mapped Halan leaf only over an Uncategorized-Review row (else suggests). ENRICHMENT ONLY — never inserts (unmatched = deferred cash). Provenance via `enrichment_source`/`mm_row_ref` (migration `0007`). `src/lib/ingest/money-manager*.ts`, `/api/enrich/money-manager`, `/transactions` Review panel.
- **DONE — Google Pay statement enrichment:** the official GPay "Transaction statement" (PDF→markdown) as a SECOND enrichment format. Parser reconciles paise-exact to the stated Sent/Received totals; matcher routes by funding last-4 + UPI-ID-when-present (else amount+direction+window); self/family-token transfers → neutral parent-10. Replaceable `GPay:` notes line + generic `enrichment_ref` provenance (migration `0008`). `src/lib/ingest/parsers/google-pay-statement.ts`, `google-pay-category-map.ts`, `/api/enrich/google-pay-statement`, `/transactions` Review panel.
- **NEXT sub-pass:** AI assist (description cleanup + category suggestions; no money to LLM), statement-password browser encryption (`bank_profiles`), physical gold ingestion, §87A marginal relief. Anything beyond the current sub-pass goes in `README.md` "Deferred", not into code.

## Confirmed facts (hard-won — do not re-derive or "fix")

- **Money is integer paise everywhere.** `parseAmount` returns paise and THROWS on anything unclean. Never introduce a float into a money path. Format to rupees only at the view boundary (`src/lib/format.ts`).
- **Sign convention: `+` = inflow to the account, `−` = outflow.** Credit-card purchase is `−`, a bill payment *received* on the card is `+`. (No Sure-style inversion here — that was the previous project.)
- **Dedup = `sha256(account | ISO-date | amountPaise | normalizedDesc | occurrence)`**, unique per account in Postgres. Re-importing an overlapping period inserts nothing, by construction. `occurrence` disambiguates genuine same-day same-amount repeats within one statement.
- **Taxonomy: 276 names = 15 parents + 261 leaves.** `Uncategorized Review` is the only allowed fallback and lives under parent **`10 Transfers & Adjustments`** (not 15). Parent buckets are identified by their two-digit prefix; renaming the suffix must not break logic.
- **Format contracts are real and verified.** The five markdown statements each have ugly, specific quirks (Federal: 12 statements per file, five row shapes, combined "amt bal" cells; IDFC CC: same statement rendered 2–5× per file, unioned by content hash, `DR/CR` may be a separate cell; Suryoday: duplicated *interleaved* pages, ref-deduped, cycle-bucketed, boundary-day txns assigned by subset-sum so every Account Summary reconciles, payments print with empty Type + negative amount, "Details of Cashback Credited" is NOT money movement — skip). Full contract list in `README.md`. **If you touch a parser, the fixture is the spec; the gate is the judge.**

## Invariants (never violate without an explicit version bump — ask first)

- **No money value (amount, balance, date) ever passes through an LLM.** Deterministic parsing only. AI may clean `description_clean` and *suggest* a category; the human confirms. This is a hard wall.
- **Leakage is a tag, not a category.** The auto-categorizer must never assign a category whose parent is `14 Cash Leakage Watchlist` or `15 Review Buckets`. `loadRules` refuses such rules at load; the DB seeds `auto_assignable=false` for those leaves. Unknown vendor -> `Uncategorized Review`.
- **The verified parsers in `src/lib/ingest/parsers/` are precious.** They reconcile to the paisa. Do not "tidy" their imports. `next.config.mjs` carries a `webpack.extensionAlias` specifically so webpack follows their `.js`->`.ts` specifiers without editing them. Leave both alone.
- **RLS isolation:** every user-data table has `user_id` and an owner policy. Reference tables (`instruments`, `prices`, `price_sources`) are read-only to authenticated users, written by service role only.
- **Reporting is by transaction date + calendar month.** Statement periods exist for reconciliation only. Net-worth anchor per account = opening balance of its earliest imported statement (set automatically at commit).
- **Commit re-validates server-side.** `/api/commit` re-derives content hashes, re-checks categories against the taxonomy, and re-checks reconciliation. The client may only edit category/tags/include. Keep that boundary.
- **Pydantic-equivalent discipline:** the `wire.ts` shapes are the client/server contract; don't pass loose objects across `/api/*`.

## Architecture

```
Source statement (md/html/xlsx)
  -> src/lib/ingest/parsers/*        deterministic parse + per-row balance/reconciliation
  -> finalizeHashes (util.ts)        occurrence + content hash
  -> /api/import                     reconcile + rule-suggest categories (nothing persisted)
  -> import wizard (client)          human confirms category + leakage tag
  -> /api/commit                     re-validate, dedup-upsert, set anchor
  -> Supabase (RLS)                  transactions, imports, accounts, categories, vendor_rules
  -> /dashboard (server)             halan.ts aggregation -> net worth / cash flow / buckets / leakage
```

Pure logic (`ingest/`, `halan.ts`, `format.ts`) imports no React/Next and is runnable under `tsx`.
Framework code is confined to `src/app/` and `src/components/`.

## Commands

```bash
npm install
npm run verify          # THE GATE — parsers + Halan math
npm run typecheck       # tsc --noEmit
npm run build           # next build
npm run dev             # local dev (needs .env.local)
npm run data:generate   # regenerate src/lib/seed-data.ts from supabase/seed/*.csv|yaml (validated)
npm run seed:generate   # regenerate supabase/seed/seed.sql (validated)
```

## Stack (locked — justify any addition against this list)

Next.js 15 (App Router, webpack), React 19, TypeScript (strict, bundler resolution), Tailwind v3 +
CSS-variable theming, vendored shadcn-style primitives, Recharts, Framer Motion, `@supabase/ssr`,
Supabase (Postgres/Auth/RLS). Pure-logic deps: cheerio, xlsx, yaml. Nothing else without a reason.

## Gotchas

- **Next 15: `cookies()` is async.** The Supabase server client is `await createSupabaseServer()`. Don't make it sync.
- **Authed pages are `export const dynamic = "force-dynamic"`.** They read Supabase per request; static prerender would have no session. `next build` compiles them without executing DB calls — never put a Supabase call at module top-level.
- **Create Supabase clients inside functions/handlers**, never at module scope (prerender would run it with no env).
- **No `next/font/google`.** The build network is restricted; remote font fetch fails the build. Use the system font stack already in `globals.css`.
- **Recharts is client-only** (`"use client"`), sized parent div. The dense editable grids (import/review) use a **native grouped `<select>`**, not Radix Select — 276 options × hundreds of rows must stay fast.
- **Supabase upsert dedup:** `.upsert(rows, { onConflict: "account_id,content_hash", ignoreDuplicates: true }).select()` returns only the inserted rows; `duplicate = submitted − inserted`.
- **Free-tier Supabase pauses after ~1 week idle.** Monthly usage means it's asleep when you arrive until the keep-alive cron exists (next sub-pass). Flag, don't silently work around.

## How to work here

- Minimal version first; offer extensions as a follow-up, not inside the first code block.
- One sharp question when stuck, not five. The user has ADHD; option overload stalls momentum.
- No emojis, no flattery, no "great question." Pragmatic and direct.
- When you finish: run the gate, report the actual output, and stop. Don't keep adding.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
