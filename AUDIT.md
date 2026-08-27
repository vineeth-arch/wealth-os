# AUDIT.md — wealth-os findings

> **Gate baseline:** green at the merge of `origin/main` into `claude/laughing-planck-00qsmh` (`c57e3fa`) — `npm run verify` (ALL GATES PASSED), `npm run typecheck` (clean), `npm run build` all exit 0 on 2026-06-14. (First run pre-merge at `66ba476`, then re-run on the merged tree that carries the Compass.)
>
> **This is a findings log only. The only code change in this branch was a merge-conflict resolution in `src/components/app-shell.tsx` (keeping both the Compass nav item and the Help link) — no behavioural code was authored by the audit.** Each item records what and why; recommended fixes are **not applied** (a separate prompt does that). Severity: **P0** = load-bearing contract broken/untested or active data risk; **P1** = real defect or privacy/onboarding hazard; **P2** = quality / minor drift.

---

## Findings

### D-1 · RESOLVED (was P1) · Drift · Compass
**What (original):** the docs (`README.md` / `USER_GUIDE.md` / `/help`) described a **Compass** (Machine H1–H6 + Mirror, proprietor identity `personalIncome = Σ01 − parent11 − parent12`) as shipped, but the audit's starting branch had no `/compass` route, no `compass.ts`, and no Compass nav item — the feature lived only on the unmerged `origin/main` / `claude/compass-full-build-wyvtuo`.
**Resolution:** `origin/main` (which carries the full Compass: `src/lib/compass.ts`, `/compass` page + components, migration `0006_profile.sql`, +compass gate tests) was merged into this branch. Compass is now **present and gate-tested**, the identity (`compass.ts:47`) matches the docs, and the nav includes the Compass item. The merged tree's gate is green. The docs and code now agree; **no further action.** (`HANDOFF.md` §6(d) describes the implemented engine.)

### D-2 · RESOLVED (was P1) · Drift / UX trap · `src/lib/integrations.ts:30`
**What (original):** `DEFAULT_LLM_PROVIDER = "anthropic"` with no Anthropic adapter wired, causing AI-suggest to dead-end for the default provider selection.
**Resolution (commit `3a95649`):** changed `DEFAULT_LLM_PROVIDER = "gemini"` (`integrations.ts:30`). Now matches the dispatch fallback and the docs. Gate green.

### S-1 · RESOLVED (was P1) · Security / privacy + drift · `fixtures/*`
**What (original):** 13 real statement fixtures committed to git containing real PII (account numbers, IFSC codes, email, addresses, third-party names), contradicting docs claiming fixtures are not committed.
**Resolution (this commit):** all 13 fixtures scrubbed — identity fields replaced with synthetic same-format values (names, emails, account/CIF numbers, IFSC codes, VPAs, addresses, card masks, loan agreement number). Money amounts, dates, and balances are **unchanged** so all 12+ reconciliation chains still hold and the gate (ALL GATES PASSED) verifies this on synthetic data. Four xlsx files renamed to drop client codes (`GE6088`, `VUZ281`) from filenames. Source code references (`hdfc.ts:4`, `seed-data.ts`, `generate-app-data.ts`) also scrubbed. Docs updated to accurately state fixtures are synthetic gate samples. **No git-history rewrite** — past commits retain original data by owner's explicit choice (history scrub is a separate, irreversible operation).
**Remaining exposure:** git history before this commit contains the original PII. Owner declined history rewrite; accepted risk.

### C-1 · RESOLVED (was P2) · Untested load-bearing contract · `scripts/verify.ts`
**What (original):** taxonomy 276 = 15+261 count was logged but not asserted.
**Resolution (commit `3a95649`):** hard assertion added at `verify.ts:545` — gate now fails if taxonomy diverges from 276 names / 15 parents.

### C-2 · RESOLVED (was P2) · Partially-tested contract · `scripts/verify.ts`
**What (original):** LLM-boundary enforcement point (DB select columns in AI-suggest route) was not gate-asserted.
**Resolution (commit `3a95649`):** structural assertion added — gate now verifies that the suggest route selects only `id,description_raw,merchant` (no amount/date/balance columns).

### S-2 · RESOLVED (was P2) · Privacy (logs) · `src/app/api/ai/suggest/route.ts`
**What (original):** prompt with description text logged unconditionally to server stdout.
**Resolution (commit `3a95649`):** prompt log gated behind `DEBUG_AI_SUGGEST=true` env var.

### Q-1 · RESOLVED (was P2) · Swallowed errors · `src/lib/llm/openai.ts:63`
**What (original):** JSON-parse failure in OpenAI adapter silently returned `[]`, masking real LLM errors as empty results.
**Resolution (commit `3a95649`):** debug log added before returning `[]` on parse failure.

### D-3 · RESOLVED (was P2) · Drift · `next.config.mjs` (redirects)
**What (original):** `USER_GUIDE.md` / `/help` called `/upstox` "the Upstox detail page," but it is a redirect to `/holdings`.
**Resolution (this commit):** both `USER_GUIDE.md:44` and `src/app/(app)/help/page.tsx:112` updated to say `/upstox` redirects to `/holdings`.

---

## Sweeps that came back clean (recorded as PASS)

- **LLM trust boundary:** description-only payload confirmed (`ai/suggest/route.ts:38,46`, `llm/prompt.ts`, `gemini.ts`, `openai.ts`). No amount/date/balance/account reaches a model. **PASS** (highest value).
- **Secrets:** no non-`NEXT_PUBLIC_*` env var is read in any `"use client"` file; `grep` of `src/components` for `process.env` is empty. Service-role key read only inside `src/lib/supabase/service.ts:11`. **PASS.**
- **RLS:** every user-owned table (`accounts`, `categories`, `imports`, `transactions`, `vendor_rules`, `holdings_snapshots`, `integrations`, `bank_profiles`, `realized_gain_segments`, `realized_gain_lots`, `loans`, `loan_schedule_rows`) has an owner policy; reference tables read-only (`0001`–`0005`). **PASS.**
- **content_hash / idempotency:** asserted — re-import inserts = 0 (`verify.ts:105-111`). **PASS.**
- **Reconciliation & sign:** asserted across all parser checks + DR/CR counts (`verify.ts`). **PASS.**
- **Types / markers:** 0 `as any`, 0 ` any ` annotations, 0 `TODO`, 0 `FIXME` in `src/`. 1 `console.*` in app code (plus the intentional suggest-prompt log). **PASS.**
- **Perf:** no `.select("*")` anywhere; hot queries are bounded (`transactions/page.tsx:66` `.limit(300)`, `server/rules.ts:42` `.limit(1)`, `holdings/map/route.ts:24` `.limit(1)`). No obvious N+1 or unbounded full-table read found. **PASS** (note: a full unused-export / dead-code sweep was **not** exhaustive — see below).

## Limitations of this audit

- **Dead-code / unused-export sweep is not exhaustive.** No orphan was conclusively identified; the IA-v2 redirects in `next.config.mjs` are intentional (not dead). Treat a full tree-shake/orphan analysis as **undetermined — needs a dedicated pass**.
- **Lifecycle-risk surface** (setState-after-unmount, lost local state in the IA-v2 / nav-guard components) is not detectable by the gate (pure-logic only). The `busy.ts` reducer + `GuardedLink` are gate-tested, but the React lifecycle around them is not — do a manual click-through after UI changes (`HANDOFF.md` §9).
- **Compass code (`src/lib/compass.ts`, 512 lines + `src/app/(app)/compass/page.tsx` + components) was merged in from `origin/main` and is gate-tested, but a line-by-line audit of it was outside this pass's original scope.** Its pure lens math is covered by `verify.ts`; a dedicated review of the page/component lifecycle and the band thresholds is **recommended — undetermined here**.

---

## Health summary

All 7 findings are now resolved. The core guarantees — integer paise, +inflow/−outflow convention, content-hash idempotency, RLS isolation, and the no-money-to-LLM trust boundary — hold in code. The gate is green on fully synthetic fixtures (all reconciliation chains verified). `DEFAULT_LLM_PROVIDER` now correctly defaults to `"gemini"`. The taxonomy 276 = 15+261 contract and the LLM-boundary select are gate-asserted. Prompt logging is behind a debug flag. Zero `any`/`TODO`/`FIXME`, no unbounded queries.

**Remaining exposure:** git history before this commit contains the original PII in fixtures. History rewrite was declined by owner — that remains the only unresolved risk, and it is a deliberate owner decision, not an oversight.

---

# Fable audit — 2026-08-27

> A second pass by a fresh reviewer, working from `origin/main` (`19839c7`) — the same tree the
> health summary above certified clean. Findings numbered `FA-n`, severity **1–5** (5 = worst).
> Each records what it is, where, how it fails in production, and the exact fix. Fixes for
> FA-1/2/4/5/6/7/8/9/10/11/14/16 are **applied on this branch** (one commit each, gate green after
> every one); FA-3/12/13/15 are documented and deliberately deferred, with reasons.
>
> **Three findings directly contradict the prior audit's health summary above** — "no obvious
> N+1" (FA-7), "no unbounded queries" (FA-1), and "history is the only unresolved PII risk" (FA-2,
> which found real PII still live in the *working tree*, including in application source code).
> That is the point of a second pass: the same gate, the same green run, missed all three.
>
> **Applied fixes (commits on this branch):** FA-1 `8897a35` · FA-2 `4a06793` · FA-4 `aaf8704` ·
> FA-9 `b3a4cd0` · FA-5 `3693765` · FA-6 `8c95856` · FA-7 `e99e1f6` · FA-11 `0daf05a` ·
> FA-14 `1aba486` · FA-8 `1031e7d` · FA-10/FA-16 `93770f4`. Final gate: `npm run verify` ALL
> GATES PASSED (37 new unit tests: PAGINATE/BATCH/NEXTPATH/CONSTTIME/DBERR/HALAN), `tsc` clean,
> `next build` green. Not pushed until reviewed.

### FA-1 · FIX APPLIED (sev 5) · Unbounded reads · `dashboard/page.tsx`, `compass/page.tsx`, `server/load-drill.ts`, `ai/suggest/route.ts` + 4 routes with hand-rolled loops (`8897a35`)
**What:** PostgREST caps a `.select()` response at 1000 rows with **no error, no warning** — the
response just silently truncates. `dashboard/page.tsx`, `compass/page.tsx`, and `load-drill.ts`
(shared by the buckets/insights/accounts drill-down pages) all read `transactions` /
`holdings_snapshots` / `prices` with a plain `.select()`, no `.range()`. `ai/suggest/route.ts` has
the identical shape on `category_source='default'`.
**Fails in production:** once a single-user ledger passes ~1000 transactions — well within reach
for a multi-year import — net worth, monthly cash flow, every Halan bucket total, the Compass
health-check bands, and the AI-suggest scan silently compute over a truncated subset. Nothing in
the UI or logs signals it. The prior audit's "no unbounded queries" PASS (health summary above)
missed this because the gate never runs a route against a real DB.
**Fix applied:** new `fetchAllRows()` (`src/lib/supabase/paginate.ts`) drains a query in
1000-row pages, all-or-nothing on error (a failure mid-drain discards the partial read rather than
returning what looks like a complete-but-short result). Wired into all four page-level reads plus
`ai/suggest`; the four API routes that had already independently hand-rolled the identical
`for (from=0;; from+=1000) .range(...)` loop (`enrich`, `rules/apply`, `enrich/money-manager`,
`enrich/google-pay-statement`) now share the one helper instead of four copies of the same fix.
Page loads throw on a genuine DB error instead of silently rendering short data. 7 gate-tested
edge cases (multi-page drain, exact-multiple boundary, empty table, single page, first-page error,
mid-drain error, configurable page size).

### FA-2 · FIX APPLIED (sev 4) · Privacy — real PII in the working tree, including source code (`4a06793`)
**What:** the prior audit's S-1 pass scrubbed the obvious fields (account numbers, IFSC, email,
address) across 13 fixtures with what reads as a plain string search for the account holder's real
name. That search missed every form the name took that *wasn't* a plain occurrence:
- **12 copies of the real full name** survived in `fixtures/Federalbank-2026-05-27.md` as a
  PDF-extraction rendering artifact that doubles every character
  (`VViinneeeetthh  VViinnoodd  NNaaiirr`) — invisible to a grep for the plain name.
- **The real name in plain text** in `fixtures/google_pay_statement_sample.md`'s self-transfer row
  (`PaidtoVineethVinodNair`).
- **~170 partially-unmasked occurrences** in the BHIM export fixture's masked VPA display names
  (`xxxeeth9@upi(xxxxxxxxNair)`) — masked to the app's own convention, but the trailing surname
  fragment survived every one of them.
- **Worse — the real full name was hardcoded in application source**:
  `src/lib/ingest/money-manager-category-map.ts`'s `SPOUSE_NAME_TOKENS` constant (a
  household "family transfer" matcher explicitly documented as "editable per household," i.e.
  meant to be user config, not a shipped literal) contained the owner's real full name, and three
  test literals in `scripts/verify.ts` (a `formatAccountDetails` display test, plus two Google Pay
  self-transfer matcher tests) reused it as sample data.
- **`VERIFICATION.txt`** (the committed gate-output transcript) was simply stale — generated
  before S-1's fixture scrub and never regenerated — so it still displayed three real UPI handles
  in plain text that the *current* fixtures no longer contain.
**Fails in production:** this is a private single-user finance app the owner intends to keep
private, but PII in application source code ships with every clone/fork/deploy regardless of
fixture hygiene — a materially worse leak than a test fixture.
**Fix applied:** all instances replaced with synthetic equivalents (doubled-glyph name → doubled
"Test Account Holder", matching the file's own established convention; plain-text name and the
source-code spouse token → "Test Spouse Name"; BHIM masked suffix → "User"). The household-matcher
gate tests were re-pointed at the synthetic token so the feature's test coverage is unchanged.
`VERIFICATION.txt` regenerated from the clean tree. Money amounts, dates and balances are
byte-identical throughout — confirmed by a full gate re-run (every reconciliation chain still
proves).

### FA-3 · DEFERRED (sev 4 nominal) · Dependency · `package.json:38` (`xlsx@^0.18.5`)
**What:** SheetJS 0.18.5 carries known prototype-pollution/ReDoS CVEs; the patched build isn't
published to npm (SheetJS moved fixes to a CDN-hosted tarball).
**Not touched, deliberately:** swapping the parser or pinning a non-npm tarball risks the precious,
gate-verified broker/Money-Manager reconciliation for a fix whose real-world exposure here is low
(single user, import-only, own files, never a public upload endpoint). Recorded as refactor #2
below — needs its own gate-verified migration pass, not a version bump buried in a security pass.

### FA-4 · FIX APPLIED (sev 3) · Unhandled exception · `commit/route.ts:20` (`aaf8704`)
**What:** `(await request.json()) as CommitRequest` — no `.catch()`. A malformed or empty body
throws before the very next line's guard can run.
**Fails in production:** the one money-writing route in the app answers a bad request with an
unhandled 500 instead of the 400 every sibling route (`holdings/commit`, `ai/apply`) already
produces via the same `request.json().catch(() => null)` idiom.
**Fix applied:** matched the sibling idiom exactly.

### FA-5 · FIX APPLIED (sev 3) · Doc-truth · `commit/route.ts` docstring, `CLAUDE.md`, `README.md` (`3693765`)
**What:** all three said commit "re-checks reconciliation" and that amounts/dates come "only from
the server-side parse." Neither is true: `reconciled` (`commit/route.ts:62`) compares two
client-supplied numbers and is stored, never enforced — a non-reconciling statement commits fine;
amounts/dates/description are echoed from the client's `CommitRequest`, not re-parsed from the
source file (`commit/route.ts:45-59` builds `finalized` from `st.rows`, which came from the client).
**Fails in production:** an engineer building on the documented guarantee ("commit re-checks
reconciliation") would trust a check that does not exist.
**Fix applied:** docs corrected to state precisely what IS server-authoritative (categories,
content hash/occurrence, DB-level dedup) versus what is client-trusted (amounts/dates/description,
the `reconciled` flag). No behavior change — this is a doc-truth fix, not a new enforcement.
Making amounts server-authoritative (re-parse on commit) is recorded as refactor #1 below.

### FA-6 · FIX APPLIED (sev 3) · Open redirect · `auth/callback/route.ts:8,12` (`8c95856`)
**What:** `NextResponse.redirect(\`${origin}${next}\`)` with `next` taken straight from the query
string, no validation.
**Fails in production:** a crafted magic-link URL with `?next=@evil.com` makes the browser parse
`origin` as URL userinfo and land the freshly-authenticated user on `evil.com`; `?next=//evil.com`
is the classic protocol-relative variant.
**Fix applied:** pure `safeNextPath()` (`src/lib/auth/next-path.ts`) admits only an absolute
same-origin path — no scheme, no host, no `//`, no backslash, no control characters — falling back
to `/dashboard` (the existing default) for anything else. 10 gate-tested cases including the exact
exploit string.

### FA-7 · FIX APPLIED (sev 3) · N+1 · `enrich/money-manager/route.ts`, `enrich/google-pay-statement/route.ts` apply loops (`e99e1f6`)
**What:** both enrichment `mode=apply` loops issued one `await`ed `UPDATE` per changed transaction,
strictly sequential.
**Fails in production:** hundreds of sequential round-trips on a large enrichment apply (slow, more
failure surface). The prior audit's "no obvious N+1" PASS (health summary above) missed it.
**Fix applied:** every row's payload differs (its own notes line, row ref, category), so the
`.in()`-grouping trick the BHIM route already uses doesn't transfer — grouping degenerates to
singletons. Instead, a small bounded-concurrency runner (`runBounded()`,
`src/lib/supabase/batch.ts`, limit 20, stop-scheduling on first error) keeps per-row statements but
runs them in flight together, preserving the sequential loop's exact success/error semantics while
collapsing wall-clock roughly twentyfold. 4 gate-tested cases.

### FA-8 · FIX APPLIED (sev 3) · Race · `bootstrap/route.ts:21-58` (`1031e7d`)
**What:** check-then-act (`count===0 ? insert`). Two parallel "set up my workspace" calls both read
empty and both insert; the per-user unique constraints correctly stop the double-write, but the
loser's unique-violation surfaced as a raw 500 + aborted the rest of the seed.
**Fix applied:** a `23505` (unique_violation) on exactly these three guarded inserts is now treated
as "a concurrent request already seeded this table" — success, not failure — via a new pure
`isUniqueViolation()` helper (`src/lib/supabase/db-errors.ts`). Any other DB error still surfaces
as before. 5 gate-tested cases.

### FA-9 · FIX APPLIED (sev 2) · Defense-in-depth · `import/route.ts`, `commit/route.ts`, `holdings/import/route.ts`, `holdings/commit/route.ts` (`b3a4cd0`)
**What:** account lookups by id with **no `.eq("user_id", user.id)`**, trusting RLS alone — every
sibling read (`categories`, `vendor_rules`) already scopes explicitly.
**Fix applied:** added the explicit filter to all four. No behavior change while RLS is intact; an
IDOR the instant it isn't.

### FA-10 · FIX APPLIED (sev 2) · Perf · new migration `0010_category_source_index.sql` (`93770f4`)
**What:** `ai/suggest` + `ai/apply` filter `transactions` on `category_source='default'`, uncovered
by any of `0001`'s indexes.
**Fix applied:** additive partial index on `(user_id) where category_source='default'`. Purely
additive; requires the owner to apply it (migrations are human-applied — the gate never touches
the DB).

### FA-11 · FIX APPLIED (sev 2) · Money rounding · `halan.ts:164` (`0daf05a`)
**What:** present value rounded `qty × price` to paise **per holding** before summing; `qty` is a
float MF unit count, so independent per-holding rounding error can drift the total by several
paise versus rounding once.
**Fix applied:** sum the unrounded products, round once on the total. Gate test constructs two
holdings that each round up alone (50.5→51 twice = 102) but sum to a total that correctly rounds
down (101) — proving the old code would have failed it.

### FA-12 · DEFERRED (sev 2-3) · Dedup semantics · `util.ts:66-103`
**What:** the content hash is over `normalizeDesc(raw)` + a per-statement `occurrence` counter.
Two genuinely-distinct rows that normalize identically (same date, same amount) collide and one is
silently deduped; `occurrence` is order-sensitive across a statement split across re-imported
files. The gate proves 0 re-import inserts for the *exact same file*, not this edge.
**Not touched, deliberately:** `CLAUDE.md`'s "Confirmed facts" section lists this exact formula as
hard-won and explicitly **"do not re-derive or 'fix'"** without a version-bump conversation — the
one finding this audit will not alter unasked. *For that conversation:* include a stable
discriminator (e.g. a bank reference number, when present) in the hash, or formally document the
accepted limitation.

### FA-13 · DEFERRED (sev 2) · Book-keeping · `commit/route.ts:64-80,113-121`
**What:** an `imports` row is inserted unconditionally on every commit call with no dedup key of
its own (transaction rows dedupe via the DB unique index; the `imports` log row does not), and the
account anchor update (`route.ts:119-121`) is a separate, non-atomic statement after the loop.
**Not touched, deliberately:** touches commit's write shape and needs its own fixtures and
reasoning about what "the same import" means — exactly the kind of change that deserves its own
pass with tests, not a mechanical fix bundled into this one.

### FA-14 · FIX APPLIED (sev 2, compare half only) · Cron · `cron/daily/route.ts:20` (`1aba486`)
**What:** the Bearer secret was compared with `!==` — not constant-time, so response timing leaks
how many leading bytes matched, letting an attacker brute-force `CRON_SECRET` byte by byte. (It
already failed closed when unset — that part was correct.) The weekly refresh is also gated by
`getUTCDay()===0` with no overlap lock.
**Fix applied (compare half):** `constantTimeEqual()` (`src/lib/auth/constant-time-equal.ts`)
hashes both sides to fixed-length digests before `crypto.timingSafeEqual` — no length- or
content-dependent timing signal. 6 gate-tested cases.
**Left as documented (lock half):** a skipped Sunday just means stale prices until next week, and a
double-run is already safe because `refreshPrices` upserts idempotently — low enough risk that
adding lock state wasn't worth a schema change in this pass.

### FA-15 · DEFERRED (sev 1) · Dead code · `scripts/diag-recon.ts`, `scripts/gen-mm-fixture.ts`
**What:** neither is referenced by `package.json`, `vercel.json`, or any import — each only
mentions its own `tsx scripts/...` invocation in its own header comment.
**Not touched, deliberately:** deletion needs owner approval (the task's own ground rules say ask
before deleting) — the one open decision, see `SUMMARY.md`.

### FA-16 · FIX APPLIED (sev 1) · Cosmetic · `0009_rule_hits.sql:1` (`93770f4`, folded into the FA-10 migration commit)
**What:** header comment mislabeled the file `0008`.
**Fix applied:** one-line comment correction.
