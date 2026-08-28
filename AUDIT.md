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

---

## Fable audit — 2026-08-27 (reconstructed)

> **Provenance note:** a prior session reported running a "fable-audit" pass with findings FA-1..FA-16
> on a branch named `fable-audit` (off `sure-reference`). That branch, its commits, and its findings
> text do not exist anywhere in this repository or any of its remotes — searched across every branch
> and the full commit history. The work was never pushed. The findings below are **re-derived from
> scratch** against the current tree by a follow-up session (Prompt 20), using only the fix
> descriptions carried in that prompt as a starting hypothesis, each one independently verified
> against the actual code before being fixed. Treat this section as a fresh audit, not a recovered one.
> The original FA-3, FA-8..FA-16 findings are unrecoverable — flagged below as lost, not resolved.

### FA-1 · RESOLVED · SEV-5 (money truncation) · unpaginated Supabase reads
**What:** Supabase caps a `.select()` at 1000 rows. Several server reads — the dashboard, Compass
(feeds the whole H1-H6 machine + net-worth series), the shared drill-down loader (`accounts`,
`insights/[metric]`, `buckets/[bucket]`), AI-suggest's dedup query, holdings/loans/calculators pages,
and the cron price refresh — issued a single unpaginated `.select()` over `transactions`,
`holdings_snapshots`, `prices`, `loan_schedule_rows`, `realized_gain_segments`, or `instruments`. Past
1000 rows in any of these tables, the page would silently compute over a truncated slice — wrong net
worth, wrong Compass bands, wrong AI-suggest coverage — with no error surfaced anywhere.
**Fix:** extracted the one correct hand-rolled drain (`api/enrich/route.ts`) into a pure
`fetchAllRows()` helper (`src/lib/supabase/paginate.ts`) and applied it to every read above plus the 3
other hand-rolled drains that had independently reinvented the same loop (money-manager enrichment,
Google Pay statement enrichment, `rules/apply`). Left the intentional 300-row cap on `/transactions`
Review untouched. verify.ts gained a `PAGINATE` section (pure range/stop/error tests + source-grep that
every call site uses the helper).
**Check:** gate (verify + typecheck + build), all green.

### FA-2 · RESOLVED · Privacy · `VERIFICATION.txt`
**What:** `VERIFICATION.txt` (a captured `npm run verify` transcript at repo root) was generated on
2026-06-13 from the fixtures **before** the `97ec4b5` PII scrub, and was never regenerated after. It
still carried ~19 personal UPI handles (including the repo owner's own), real balances/amounts, 12-digit
UPI reference numbers, and named counterparties — none of which exist in the current (already-scrubbed)
fixtures.
**Fix:** regenerated the file verbatim from a fresh `npm run verify` run against the current synthetic
fixtures (same format: 2-line date header + raw gate stdout). Confirmed 0 occurrences of every known
stale handle (`vineethnair98@oksbi`, `vineethnair-1@fifederal`, `nirmiti26mehta@*`, the old phone number,
etc.) — all of them were absent from every current fixture too, so nothing in this file was ever load-
bearing. No git-history rewrite (matches the S-1 precedent: prior commits keep the original data by the
owner's explicit earlier decision).
**Conflict surfaced, not silently resolved:** three phone-number VPAs (`7021571839@ibl`,
`9137533196-2@ibl`, `Q810011518@ybl`) are still present because they are baked into the current, already
S-1-scrubbed fixture `fixtures/Federalbank-2026-05-27.md` verbatim — editing the fixture risks its
reconciliation hashes and is out of this pass's scope. These may or may not be real numbers; flagging
for vn to decide whether a follow-up fixture re-scrub is warranted.
**Check:** grep, gate.

### FA-3 · DEFERRED (not re-derived) · `xlsx@0.18.5` CVE
Original finding lost (see provenance note). `package.json` currently pins `xlsx@0.18.5`, which has
known prototype-pollution/ReDoS advisories upstream. Migrating off it is nontrivial (parsers depend on
its exact behavior against real fixtures) and out of scope for this prompt. Logged as a top follow-up.

### FA-4 · RESOLVED · Robustness · `src/app/api/commit/route.ts`
**What:** `commit/route.ts` was the only route in the codebase calling `await request.json()` without a
`.catch(() => null)` guard — malformed/empty JSON threw unhandled, surfacing as an opaque 500 instead of
a client-facing 400. All 16 other routes already use the guarded idiom.
**Fix:** `const body = (await request.json().catch(() => null)) as CommitRequest | null;` +
`if (!body || !Array.isArray(body.statements)) return 400`.
**Check:** gate; grep (verify.ts `SAFE-NEXT-PATH` section, ridden together with FA-6).

### FA-5 · RESOLVED (docs only) · Doc-truth · commit trust-boundary claim
**What:** `CLAUDE.md`, `README.md`, the `commit/route.ts` docstring, and a `wire.ts` comment all claimed
`/api/commit` "re-checks reconciliation" and that "amounts/dates come from the server-side parse." In
truth: `/api/commit` re-derives content hashes and re-checks category *existence* (correct), but
`reconciled` is computed from a **client-supplied** `expectedDeltaPaise` against **client-supplied**
amounts, is only recorded on the `imports` row, and never gates the write — and amounts/dates come
straight from the request body, not from any server-side re-parse (there is no re-parse; `/api/import`
computes a parse result that is never persisted or compared against). This is a real trust-boundary gap,
not just a doc typo.
**Fix (docs only, no behavior change per this pass's scope):** corrected all four locations to state the
truth plainly, and additionally noted that commit skips the `auto_assignable` (Leakage/Review) guard that
every other write path (`ai/apply`, `rules/apply`, both enrich routes) applies.
**Follow-up (not applied this pass):** implement a real server-side re-parse at commit time so amounts/
dates cannot be client-forged, and add the missing `auto_assignable` guard. Logged as top follow-up #1.
**Check:** manual doc review; gate (no code path changed, so verify/typecheck/build are unaffected but
still run to prove nothing broke).

### FA-6 · RESOLVED · SEV: security (open redirect) · `src/app/auth/callback/route.ts`
**What:** the auth callback built `NextResponse.redirect(`${origin}${next}`)` from an **unvalidated**
`next` search param, immediately after exchanging the auth code for a session. `next=//evil.com/x`
parses as protocol-relative and redirects off-site at the worst possible moment (session cookie already
set). `next=/\evil.com` and scheme-prefixed variants are the other shapes.
**Fix:** pure `safeNextPath(next, fallback)` (`src/lib/safe-path.ts`) — must start with a single `/`,
rejects `//`, backslashes, and `://`; wired into the callback route.
**Check:** verify.ts `SAFE-NEXT-PATH` section (accepts real in-app paths, rejects every escape shape
tried) + gate.

### FA-7 · RESOLVED · Reliability/latency · serial per-row enrichment writes
**What:** the apply-mode write loops in the money-manager and Google Pay statement enrichment routes
were `for (const w of plan) { await supabase...update(...) }` — strictly serial, one round-trip per
changed row, no rollback on a mid-loop failure (partial-apply with an opaque count), and the dominant
latency cost on a few thousand matched rows.
**Fix:** bounded-concurrency `runBounded()` helper (`src/lib/concurrency.ts`) — chunks of 10 concurrent
updates via `Promise.all`, stops after the first failing chunk, returns an explicit `completed` count.
Per-row payloads genuinely differ (unique `notes`/`mm_row_ref`/`enrichment_ref` per row, conditional
`merchant`/`category_id` keys), so `.in()`-style value-grouping (the pattern used elsewhere in this
codebase for uniform updates) does not apply here — concurrency, not batching, is the correct fix.
**Check:** verify.ts `CONCURRENCY` section (chunking, stop-on-first-failure, completed-count) + gate.

### FA-8 .. FA-16 · LOST (not re-derivable)
The original findings text for FA-8 through FA-16 (and the original wording of FA-15/FA-16, referenced
by this prompt as "dead scripts" and "a header typo") does not exist anywhere in this repository. No
branch, commit, stash, or reflog entry carries it. Re-guessing 9 findings' worth of prior audit work from
a one-line prompt summary each ("dead scripts", "header typo") risks inventing findings that were never
real, which is a worse outcome than leaving them undone. **Not applied. Flagged for vn**: if the original
audit output survives outside this repo (a chat transcript, a local file), re-supply it and these can be
landed properly; otherwise treat this as a fresh gap to re-audit from scratch in a future pass.

---

## Health summary

All 7 findings are now resolved. The core guarantees — integer paise, +inflow/−outflow convention, content-hash idempotency, RLS isolation, and the no-money-to-LLM trust boundary — hold in code. The gate is green on fully synthetic fixtures (all reconciliation chains verified). `DEFAULT_LLM_PROVIDER` now correctly defaults to `"gemini"`. The taxonomy 276 = 15+261 contract and the LLM-boundary select are gate-asserted. Prompt logging is behind a debug flag. Zero `any`/`TODO`/`FIXME`, no unbounded queries.

**Remaining exposure:** git history before this commit contains the original PII in fixtures. History rewrite was declined by owner — that remains the only unresolved risk, and it is a deliberate owner decision, not an oversight.
