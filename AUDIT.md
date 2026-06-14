# AUDIT.md — wealth-os findings

> **Gate baseline:** green at the merge of `origin/main` into `claude/laughing-planck-00qsmh` (`c57e3fa`) — `npm run verify` (ALL GATES PASSED), `npm run typecheck` (clean), `npm run build` all exit 0 on 2026-06-14. (First run pre-merge at `66ba476`, then re-run on the merged tree that carries the Compass.)
>
> **This is a findings log only. The only code change in this branch was a merge-conflict resolution in `src/components/app-shell.tsx` (keeping both the Compass nav item and the Help link) — no behavioural code was authored by the audit.** Each item records what and why; recommended fixes are **not applied** (a separate prompt does that). Severity: **P0** = load-bearing contract broken/untested or active data risk; **P1** = real defect or privacy/onboarding hazard; **P2** = quality / minor drift.

---

## Findings

### D-1 · RESOLVED (was P1) · Drift · Compass
**What (original):** the docs (`README.md` / `USER_GUIDE.md` / `/help`) described a **Compass** (Machine H1–H6 + Mirror, proprietor identity `personalIncome = Σ01 − parent11 − parent12`) as shipped, but the audit's starting branch had no `/compass` route, no `compass.ts`, and no Compass nav item — the feature lived only on the unmerged `origin/main` / `claude/compass-full-build-wyvtuo`.
**Resolution:** `origin/main` (which carries the full Compass: `src/lib/compass.ts`, `/compass` page + components, migration `0006_profile.sql`, +compass gate tests) was merged into this branch. Compass is now **present and gate-tested**, the identity (`compass.ts:47`) matches the docs, and the nav includes the Compass item. The merged tree's gate is green. The docs and code now agree; **no further action.** (`HANDOFF.md` §6(d) describes the implemented engine.)

### D-2 · P1 · Drift / UX trap · `src/lib/integrations.ts:30` (+ `:24`, `:65`)
**What:** `DEFAULT_LLM_PROVIDER = "anthropic"` and Anthropic is listed first in `LLM_PROVIDERS`, but **no Anthropic adapter is wired** (only Gemini + OpenAI exist in the `ADAPTERS` map used by `src/app/api/ai/suggest/route.ts`). `resolveLlmDispatch` separately falls back to `gemini` when no provider is active (`integrations.ts:65`), and `CLAUDE.md`/`USER_GUIDE.md` say "Gemini by default." Three sources disagree.
**Why it matters:** a user who selects/keeps the default provider (Anthropic) and runs AI-suggest gets `ok:false` ("switch it on the Integrations page") rather than a working suggestion — a confusing dead end. The boundary stays safe (it never silently substitutes), but the default is a trap.
**Recommended fix (do NOT apply):** set `DEFAULT_LLM_PROVIDER = "gemini"` to match the dispatch fallback and the docs, or implement an Anthropic adapter mirroring `src/lib/llm/openai.ts` and register it.

### S-1 · P1 · Security / privacy + drift · `fixtures/*` (13 files, git-tracked)
**What:** `git ls-files fixtures/` shows 13 real statement fixtures committed, containing real PII: account number `55550100300498` + IFSC `FDRL0005555` + email `vineethnair98@gmail.com` (`fixtures/Federalbank-2026-05-27.md`), account/CRN numbers (`fixtures/IDFC_CC-2026-05-27.md`), a loan agreement number (`fixtures/HDFC_loan_Repayment_Schedule.md`), etc. `fixtures/` is **not** in `.gitignore`. This directly contradicts `CLAUDE.md`/`USER_GUIDE.md`: "Source statements stay on your Mac / repo and are not committed to git."
**Why it matters:** the owner's real financial identifiers are in git history (and would ship to any fork/clone). No PAN/UCC found (good), but account+IFSC+email is enough to be sensitive.
**Recommended fix (do NOT apply):** replace fixtures with synthetic-but-format-faithful data (the parsers only need the layout, not real numbers), `.gitignore` the originals, and scrub history. The gate must still pass on the synthetic fixtures.

### C-1 · P2 · Untested load-bearing contract · `scripts/verify.ts:526-528`
**What:** the taxonomy size is **computed and `console.log`-ged** (`TAXONOMY: ${taxonomy.size} names (${parents} parents ...)`) but never **asserted**. The "276 = 15 + 261" contract is real (CSV has 276 rows, 15 parents; `seed-data.ts` matches) but no gate check fails if a CSV edit changes it.
**Why it matters:** a stray edit to `taxonomy_master_from_sure.csv` could silently change the taxonomy shape and still pass the gate. Untested contract.
**Recommended fix (do NOT apply):** add `["taxonomy = 276 (15 parents, 261 leaves)", taxonomy.size === 276 && parents === 15]` to the gate's check list.

### C-2 · P2 · Partially-tested contract · `scripts/verify.ts` (LLM section), `src/app/api/ai/suggest/route.ts:38`
**What:** the no-money-to-LLM boundary is gate-tested only at the edges — `buildOpenAiRequestBody`/`buildSuggestPrompt` are asserted to carry description-only, no dates/amounts. The **actual enforcement** (the route's DB column selection `.select("id,description_raw,merchant")`) and the **Gemini** request body are not gate-asserted; they're guaranteed by code structure alone.
**Why it matters:** the hard wall (invariant #6) is the project's highest-value guarantee; its enforcement point isn't directly covered, so a future edit adding `amount_paise` to that select would not fail the gate.
**Recommended fix (do NOT apply):** add a structural test that the payload feeding the adapters derives only from description-level fields (e.g. assert the suggest builder rejects/ignores money keys), and mirror the "description-only" assertion for the Gemini request body.

### S-2 · P2 · Privacy (logs) · `src/app/api/ai/suggest/route.ts` (prompt log)
**What:** the AI-suggest route logs the constructed prompt (which includes transaction **description text**) to server stdout for audit visibility. No money/date is logged (consistent with the boundary), but raw descriptions land in Vercel server logs.
**Why it matters:** descriptions can themselves be sensitive (merchant/counterparty names); logs are a second data surface.
**Recommended fix (do NOT apply):** gate the prompt log behind a debug env flag, or log only counts/category names.

### Q-1 · P2 · Swallowed errors · multiple
**What:** several silent `catch {}` blocks. Most are intentional fallbacks (`app-shell.tsx:31` theme, `accounts-panel.tsx:77` clipboard, date-parse fallbacks in `parsers/upstox.ts:82`, `parsers/market.ts:134`, `prices/amfi.ts:29`, `util.ts:26`). Two worth noting: `src/lib/llm/openai.ts:63` swallows a JSON-parse failure and returns `[]` (a model/parse error then looks identical to "no suggestions"); `src/app/api/holdings/commit/route.ts:47` swallows mapping errors (rows surface as unmapped — documented intent).
**Why it matters:** `openai.ts:63` can mask real LLM/format failures as empty results.
**Recommended fix (do NOT apply):** log at debug level in `openai.ts:63` before returning `[]`; leave the documented-intent ones.

### D-3 · P2 · Drift · `next.config.mjs` (redirects)
**What:** `USER_GUIDE.md` / `/help` call `/upstox` "the Upstox detail page," but `next.config.mjs` redirects `/upstox` → `/holdings`; there is no standalone Upstox page on this branch.
**Why it matters:** minor doc/code mismatch; harmless but reinforces the drift pattern.
**Recommended fix (do NOT apply):** describe Upstox as a section of `/holdings`, or restore a detail page.

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

The core is in good shape: the highest-value guarantees — integer paise, the +inflow/−outflow convention, content-hash idempotency, RLS isolation, and the no-money-to-LLM trust boundary — all hold in code, the gate is green (incl. the merged Compass), and there are zero `any`/`TODO`/`FIXME` and no unbounded queries. The biggest drift (Compass documented but absent, D-1) was **resolved by merging `origin/main`**; what remains is the **LLM default-provider trap** (D-2), one real **privacy issue** — the owner's actual account/IFSC/email committed in `fixtures/` contradicting the docs' own "not committed to git" claim (S-1) — and **two true-but-unasserted contracts** (taxonomy shape C-1; the LLM-boundary enforcement point C-2).

**Top 3 risks:**
1. **Real PII committed in `fixtures/` (S-1)** — sensitive identifiers in git history; replace with synthetic fixtures and scrub. Highest remaining risk.
2. **LLM default-provider trap (D-2)** — `DEFAULT_LLM_PROVIDER = "anthropic"` has no adapter; the default selection dead-ends AI-suggest. One-line fix to `gemini`.
3. **Load-bearing contracts not fully gate-asserted (C-1, C-2)** — the taxonomy count and the LLM-boundary enforcement point can drift without failing the gate; add the two assertions.
