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
