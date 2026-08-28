# SUMMARY.md — Review flow usability + fable-audit + performance (Prompt 20)

Branch `claude/review-flow-fable-audit-g7bxmz` → `main`. This finishes an in-flight audit that never
made it into the repo, and fixes the six usability/performance/AI issues vn hit running the real
monthly review cycle. No Budgets/Option B work, no design reskin — this is purely making the app that
exists today usable.

**Environment note that shapes everything below:** this container has no `.env.local`/DB, and DB
access via the Supabase MCP was explicitly declined for this session. No pass in this prompt could be
click-through verified against a running app or a live database. Every fix below is backed by trace +
gate (`npm run verify && npm run typecheck && npm run build`, green after every commit) + reasoning —
never by "I clicked it and it worked." Each pass ends with an explicit manual checklist for vn.

---

## Branch reconciliation

The prompt assumed a `fable-audit` branch (off `sure-reference`) existed with findings FA-1..FA-16
already written up, possibly with FA-1 sitting uncommitted in the tree. **Neither exists.** Searched
every remote branch and the full commit history — no `fable-audit` branch, no `AUDIT.md` section
matching that name, no `src/lib/supabase/paginate.ts`, nothing. The audit work was never pushed from
wherever it happened.

Per the prompt's own fallback ("create one working branch off current `main`... re-apply FA-1..FA-7
from AUDIT.md — they're small and fully described"), this branch was created off `main` (51bf372,
already equal to `origin/main`) and FA-1/2/4/5/6/7 were **re-derived from scratch** using only the
prompt's own fix descriptions as a starting hypothesis — each one independently verified against the
actual code before being fixed. AUDIT.md now carries a `## Fable audit — 2026-08-27 (reconstructed)`
section documenting this. FA-3 (xlsx CVE) and FA-8..FA-16 are marked lost, not resolved — their
original text is unrecoverable and guessing 9 findings from one-line prompt summaries risked inventing
findings that were never real.

---

## Fable audit outcome

| Finding | Status | What |
|---|---|---|
| FA-1 | **Landed** | Several server reads (dashboard, Compass, drill-downs, AI-suggest dedup, holdings/loans/calculators, cron price refresh) issued unpaginated Supabase selects — silently truncated at 1000 rows. Extracted a pure `fetchAllRows()` helper and applied it everywhere, including the 3 other hand-rolled drains that had reinvented the same loop. |
| FA-2 | **Landed** | `VERIFICATION.txt` was a captured gate transcript generated from *pre*-scrub fixtures — still carried ~19 real personal UPI handles. Regenerated from current (already-scrubbed) fixtures; confirmed 0 occurrences of every known stale handle. Three phone-number VPAs remain because they're baked into a fixture that already passed the earlier S-1 scrub — flagged as a conflict for vn, not silently edited. |
| FA-3 | Deferred | `xlsx@0.18.5` CVE. Migrating parsers off it is nontrivial and out of scope here. |
| FA-4 | **Landed** | `commit/route.ts` was the only route without a `.catch(() => null)` guard on `request.json()` — malformed JSON threw an opaque 500 instead of a 400. |
| FA-5 | **Landed (docs only)** | `CLAUDE.md`/`README.md`/the commit docstring all claimed `/api/commit` "re-checks reconciliation" and gets amounts/dates "from the server-side parse." Neither is true — verified against the actual code and corrected in all four locations. Real behavior change (a server-side re-parse) is a follow-up, not applied this pass. |
| FA-6 | **Landed** | Open redirect in `auth/callback/route.ts` — an unvalidated `next` param let `next=//evil.com` escape off-origin immediately after session exchange. New `safeNextPath()` guard. |
| FA-7 | **Landed** | Serial per-row `await` loops in the two enrichment apply routes → bounded-concurrency `runBounded()` (chunks of 10, explicit partial-apply count on failure). |
| FA-8..16 | **Lost** | Original findings text doesn't exist anywhere in this repo's history. Not re-derived — flagged for vn if the original audit survives elsewhere. |

---

## The six usability/performance fixes

### 1. Review-save legibility (★ the #1 fix)
**Symptom:** categorising a row didn't visibly register; the Uncategorised count never moved.
**Root cause (traced, not guessed):** the save *did* persist correctly. But `review-table.tsx`'s local
row state was seeded once from server props and never re-synced — nothing called `router.refresh()`
after a write, so the grid just sat there showing stale data. Separately, the dashboard's "Review
queue" tile used a completely different (and wrong) formula — every untagged row in the whole
parent-10 bucket — than the review panel's own count (a client count of the actual Uncategorized
Review leaf). Two sources of truth that could never agree.
**Fix:** one shared `countUncategorized()` server helper feeding both the panel and the dashboard tile;
an in-flight-edit overlay + a props-driven re-sync effect so `router.refresh()` never reverts an edit
still in flight; failed writes now revert and surface an inline error instead of being silently
swallowed (`if (!error) flashSaved` used to discard the error entirely). Also virtualized the grid
(`@tanstack/react-virtual`) and lazy-mounted the category picker — up to 300 rows × a 276-option
`<select>` was ~83k DOM nodes, the other half of "very very slow."
**Backing:** gate + source-grep (verify TAG `REVIEW`). Manual checklist: categorise a row → green check,
count drops by 1, badge flips to "you"; reload → it stuck; AI-apply updates the grid without a manual
reload; scrolling 300 rows is smooth.

### 2. Category picker: real search + parent context
**Root cause:** no search existed anywhere — the native `<select>`'s browser type-ahead is prefix-only
and resets after ~1s, useless against 276 names. The 15 parent buckets were also selectable via a stray
"—" optgroup.
**Fix:** a shared `CategoryPicker` (pure `filterCategoryOptions()` matching leaf name OR parent bucket
name) rendering each result under a parent-bucket header — the "which bucket is this in" context vn
asked for. Parents are no longer individually selectable (a deliberate behavior change — flagging it
here). Migrated the review table and the dashboard drill-down rows; left the lower-volume
`rules-manager`/`import-wizard`/`ai-suggest-panel` pickers on the old component (follow-up).
**Backing:** gate + pure filter/grouping tests + source-grep (verify TAG `CATPICKER`).

### 3. Same-day transaction context
**Root cause:** no date-window query existed anywhere in the codebase to support "what else happened
that day."
**Fix:** a small calendar-search toggle per row opens a floating, read-only panel (mirroring the
category picker's mechanism, not an extra table row, so it doesn't disturb the virtualizer's per-row
height tracking) showing that account's transactions in a ±2-day window — bounded by construction
(one account, a 50-row cap), browser Supabase client, RLS-scoped.
**Backing:** gate + `addDaysISO` boundary tests (month/year/leap-day) + source-grep (verify TAG
`TXN-CONTEXT`).

### 4. Visible account filter on /transactions
**Root cause:** the filter already worked via `?account=`, but had no visible control on the page
itself — only a deep-link from `/accounts`. Tab switching also silently dropped the param
(`transactions-tabs.tsx` rewrote the URL to a bare `?tab=X` on every switch).
**Fix:** fixed the tab-switch param loss; added a visible `AccountSelect` dropdown pushing the exact
same `?account=` param the existing deep-link already sets — one source of truth.
**Backing:** gate + source-grep (verify TAG `TX-FILTER`).

### 5. AI category assist never fires
**Root cause chain:** only `gemini`/`openai` have a wired adapter. A stored `anthropic`/`openrouter`
provider (or a missing env key) makes the route return `{disabled:true, reason}` — but the panel
rendered that reason as plain muted-grey text, visually identical to success. `.env.example` actively
pointed at `ANTHROPIC_API_KEY` first and called AI assist "deferred" (both wrong); the Settings page's
own no-key hint repeated the same wrong provider.
**Fix:** a loud, destructive-toned alert with a direct Settings link whenever AI-suggest is disabled;
corrected `.env.example` (leads with the wired providers, documents `DEBUG_AI_SUGGEST`/
`GEMINI_MODEL`/`OPENAI_MODEL`, drops the stale `/integrations` path and "deferred" claim); corrected
the Settings no-key hint. No Anthropic adapter added (logged as a follow-up) — this pass makes every
dead-end visible rather than wiring a third provider. The description-only hard wall is untouched.
**Backing:** gate + source-grep (verify TAG `AI-STATE`). **vn must additionally**: set
`GEMINI_API_KEY` (Vercel env + `.env.local`), open `/settings` and confirm Gemini is the active
provider, then confirm AI-suggest returns a real suggestion.

### 6. Performance
**Cannot measure live** (no env in this container) — backed by query-shape reduction + paise-exact
equivalence proofs, not a benchmark.
- Migration `0011` adds three indexes for currently-unindexed hot filters: `(user_id,
  category_source)` (ai/suggest + rules/apply), `(user_id, id)` (every `fetchAllRows()` drain's sort
  key), `(account_id, txn_date desc)` (the account-filtered Review query + the Pass-3 date window).
- A DB-side aggregation RPC (with fallback) for the dashboard: two deliberately minimal SQL functions
  — plain `GROUP BY category_id/account_id + SUM`, no category-hierarchy logic in SQL at all, so all
  the actual Halan classification stays in the already-gate-tested TypeScript. The dashboard tries the
  RPCs first; on ANY error (most likely: migration not yet applied) it falls back to the FA-1
  paginated drain, unchanged.
- Review-grid virtualization + lazy picker mounting (see Pass 1) is half the perf story.

**Honest caveat, repeated because it matters for a money app:** the RPC SQL was authored and reviewed
but never executed against a live Postgres instance. The fallback only catches RPC *errors*, not a
wrong-but-non-erroring result. `verify.ts`'s `HALAN-AGG` section proves the JS reconstruction math is
paise-exact equivalent to the already-tested raw-row path (a synthetic dataset run through both paths,
plus hand-computed spot checks) — that de-risks the *logic*, but the actual SQL execution still needs
vn's manual paise-exact comparison after applying the migration. **If the numbers ever disagree, the
safe move is to not apply (or `DROP FUNCTION`) the two aggregation functions — the three indexes are
independent and safe regardless.**

---

## Follow-ups (ranked)

1. **Server-side re-parse at commit** (FA-5) — close the real trust-boundary gap: amounts/dates
   currently come from the request body, not a server-side re-parse; `reconciled` is computed from
   client-supplied numbers and never enforced. Also add the missing `auto_assignable` guard other
   write paths already apply.
2. **Extend DB-side aggregation** to Compass/insights/buckets drill pages if the dashboard RPC proves
   out — right now only the dashboard has it; the drill pages still drain.
3. **Migrate off `xlsx@0.18.5`** (FA-3 — known CVE, parser-dependent, needs careful fixture
   revalidation).
4. **Per-category picker descriptions** — the parent-bucket subtitle is the cheap 80% win; a one-line
   description per leaf (261 to author) would close the rest of the "what is this category" gap.
5. **Migrate the remaining pickers** (`rules-manager`, `import-wizard`, `ai-suggest-panel`) to the
   shared `CategoryPicker`.
6. **Lift the /transactions 300-row cap** + add date/amount filters, per `docs/sure-reference/06_TRANSACTIONS.md`.
7. **A real Anthropic adapter** if vn wants a third working provider (currently catalog-only).
8. **FA-8..FA-16** — re-derive if the original audit text surfaces from outside this repo.

---

## What vn needs to do

**Apply migration 0011** (`supabase/migrations/0011_transactions_indexes.sql`) in the Supabase SQL
editor. It's additive-only (indexes + two new functions); nothing existing changes shape. After
applying, **compare dashboard numbers before and after** — they must be byte-identical (same rupee
strings) and match `/insights` and `/buckets`. If anything disagrees, drop the two functions
(`dashboard_category_month_totals`, `dashboard_account_balances`) and the app falls straight back to
the proven drain path; the indexes are safe to keep regardless.

**Set `GEMINI_API_KEY`** (Vercel env + local `.env.local`) and confirm Gemini is the active provider
on `/settings` for AI-suggest to work at all.

**Manual click-through checklist** (nothing in this list was live-verified in this session):
- [ ] Categorise a row on `/transactions?tab=review` → green check, count drops by 1, reload sticks.
- [ ] Dashboard "Review queue" tile shows the exact same number as the review panel header.
- [ ] Type a leaf fragment and a parent term into the category picker — both filter correctly.
- [ ] Expand "±2d" context on an ambiguous row → same-account siblings appear.
- [ ] Pick a bank on `/transactions` → list filters, URL updates; the `/accounts` deep-link still
      pre-sets the dropdown; switching tabs doesn't lose the filter.
- [ ] Trigger AI-suggest with no/misconfigured provider → a loud red alert with a Settings link
      (never quiet grey text); after setting `GEMINI_API_KEY` and selecting Gemini → real suggestions.
- [ ] Review grid scrolls smoothly at 100–300 rows.
- [ ] Apply migration 0011, confirm dashboard/insights/buckets numbers are unchanged, paise-exact.
