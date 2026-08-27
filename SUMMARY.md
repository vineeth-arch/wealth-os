# SUMMARY.md — Fable audit of wealth-os (2026-08-27)

A second-pass, principal-engineer audit on branch `claude/determined-meitner-xj89lz` (restarted
from `origin/main` `19839c7` — this branch's prior work had already merged, so per the session's
own protocol it was reset to latest main rather than stacked on top of merged history). Full
detail — every finding with file:line, failure mode, and fix — is in `AUDIT.md` under "Fable
audit — 2026-08-27"; the system map is in `ARCHITECTURE.md`. This is the executive read.

The headline: the app's own gate (`npm run verify`) is excellent at what it covers (paise-exact
parsing, taxonomy, calculators) but **cannot touch the DB, the API routes, or the UI** — and every
severe defect found here lives in exactly that blind spot. The prior audit, working from the same
gate, signed off "no unbounded queries / no obvious N+1 / history is the only PII risk"; all three
were wrong. A second pair of eyes reading the runtime paths earned its keep.

---

## Findings by severity

| Sev | ID | Finding | Disposition |
|---|---|---|---|
| **5** | FA-1 | Un-paginated `transactions`/`holdings_snapshots`/`prices` reads → money silently truncated at PostgREST's 1000-row cap (dashboard, Compass, drill loader, AI-suggest) | **Fixed** |
| **4** | FA-2 | Real PII surviving in fixtures (doubled-glyph rendering artifact, plain text, masked-VPA suffix) AND hardcoded in application source code (`SPOUSE_NAME_TOKENS`) + three gate-test literals; `VERIFICATION.txt` stale with real UPI handles | **Fixed** |
| **4** | FA-3 | `xlsx@0.18.5` prototype-pollution / ReDoS CVEs | **Deferred** (see below) |
| **3** | FA-4 | `commit` parses body with no guard → unhandled 500 | **Fixed** |
| **3** | FA-5 | Commit "re-validates server-side"/"re-checks reconciliation" overstated in docstring + CLAUDE.md + README | **Fixed (doc-truth)** |
| **3** | FA-6 | Open redirect via unvalidated `?next=` in auth callback | **Fixed** |
| **3** | FA-7 | Per-row `await` N+1 in both statement-enrichment apply loops | **Fixed** |
| **3** | FA-8 | Bootstrap check-then-act race → partial-seed 500 | **Fixed** |
| **2** | FA-9 | Account lookups scoped by RLS alone, no `user_id` filter (4 routes) | **Fixed** |
| **2** | FA-10 | Missing index for the `category_source='default'` hot filter | **Fixed** (migration, owner-applied) |
| **2** | FA-11 | Holdings present-value rounding drift (per-holding round vs. round-once) | **Fixed** |
| **2-3** | FA-12 | Content-hash normalize-collision dedup edge | Deferred — protected invariant |
| **2** | FA-13 | Duplicate `imports` rows + non-atomic anchor update | Deferred — needs its own pass |
| **2** | FA-14 | Cron secret non-constant-time compare + no refresh overlap lock | **Fixed** (compare half); lock half documented, not changed |
| **1** | FA-15 | Dead scripts `diag-recon.ts`, `gen-mm-fixture.ts` | Deferred — **awaiting delete approval** |
| **1** | FA-16 | `0009` migration header mislabeled `0008` | **Fixed** |

Also recorded as **clean** (verified, not assumed): no committed secret keys, RLS owner policy on
every user table, the no-money-to-LLM wall, integer-paise float discipline, and no SQL/XSS
injection.

---

## What was fixed (12 commits, gate green after every one)

Each fix is one commit; the message explains *why*. Backing check noted per fix, honestly — the
gate cannot execute API routes here (no `.env.local`/DB in this container), so route wiring rests
on typecheck + `next build` + review, while every new pure helper carries real unit tests.

1. **FA-1 — pagination** (`8897a35`). New `src/lib/supabase/paginate.ts` `fetchAllRows()`
   (stable-order, all-or-nothing on error) drains `transactions`/`holdings_snapshots`/`prices` on
   `dashboard/page.tsx`, `compass/page.tsx`, `server/load-drill.ts`, and the `ai/suggest`
   uncategorized-transactions read; four API routes that had each hand-rolled the identical
   pagination loop (`enrich`, `rules/apply`, `enrich/money-manager`, `enrich/google-pay-statement`)
   now share the one helper. Pages throw on a genuine load error instead of rendering short data.
   *Backed by:* 7 `PAGINATE` unit tests + typecheck + build.
2. **FA-2 — PII scrub** (`4a06793`). Owner's real name — 12 doubled-glyph copies in a Federal
   fixture, plain text in a Google Pay fixture, ~170 partially-masked BHIM occurrences, AND
   hardcoded directly in `money-manager-category-map.ts`'s household-matcher constant plus three
   gate-test literals — replaced with synthetic equivalents; `VERIFICATION.txt` regenerated from
   the clean tree. Amounts/dates byte-identical, so every reconciliation chain still proves.
   *Backed by:* full gate re-run + repo-wide grep residue check (fixtures, source, xlsx binaries).
3. **FA-4 — commit body guard** (`aaf8704`). `request.json().catch(() => null)` + the existing 400.
4. **FA-9 — account `user_id` scoping** (`b3a4cd0`). Explicit filter on all 4 account lookups.
5. **FA-5 — doc-truth** (`3693765`). Docstring, CLAUDE.md invariant, and README now state precisely
   what commit does and does not re-validate. No behavior change.
6. **FA-6 — open redirect** (`8c95856`). Pure `safeNextPath()` admits only same-origin paths.
   *Backed by:* 10 `NEXTPATH` unit tests.
7. **FA-7 — enrichment N+1** (`e99e1f6`). New `runBounded()` (limit 20, stop-on-first-error)
   replaces the per-row await loops in both enrichment apply paths; the `.in()`-grouping trick the
   BHIM route uses doesn't transfer here since every row's payload differs. *Backed by:* 4 `BATCH`
   unit tests.
8. **FA-11 — present-value rounding** (`0daf05a`). `halan.ts:holdingsValue` sums unrounded and
   rounds once instead of per-holding. *Backed by:* a `HALAN` test proving the old code would
   round 50.5+50.5 to 102 instead of the correct 101.
9. **FA-14 — constant-time cron secret** (`1aba486`). `constantTimeEqual()` hashes both sides
   before `crypto.timingSafeEqual`, closing a byte-at-a-time timing leak. *Backed by:* 6
   `CONSTTIME` unit tests.
10. **FA-8 — bootstrap race** (`1031e7d`). A lost seeding race (`23505` unique_violation on the
    very constraint that makes it idempotent) now reports success, via `isUniqueViolation()`.
    *Backed by:* 5 `DBERR` unit tests.
11. **FA-10 + FA-16 — index + comment fix** (`93770f4`). Additive migration
    `0010_category_source_index.sql` for the `ai/suggest`/`ai/apply` hot filter, plus the trivial
    `0009` header-comment correction folded into the same commit.

Net gate delta: **+37 unit tests** (PAGINATE/BATCH/NEXTPATH/CONSTTIME/DBERR/HALAN), still
`ALL GATES PASSED`, `tsc` clean, `next build` green after every single commit.

---

## Deliberately left, and why

- **FA-3 `xlsx` CVE (sev 4 nominal).** The patched SheetJS is not on npm, the stack is locked, and
  swapping the parser risks the precious broker/MM reconciliation. In-context exposure is low
  (single user, import-only, own files). Right fix is a dedicated, gate-verified migration pass —
  refactor #2.
- **FA-5 enforcement.** Corrected the *docs* but did **not** start rejecting non-reconciling
  commits or re-parse the source server-side: the former can block legitimate partial imports; the
  latter is an architecture change. Both are invariant-level calls for the owner — refactor #1.
- **FA-12 (hash-collision dedup edge).** `CLAUDE.md`'s "Confirmed facts" section lists this exact
  hash formula as hard-won and explicitly **"do not re-derive or 'fix'"** without a version-bump
  conversation. This is the one finding this audit will not touch unasked, full stop.
- **FA-13 (duplicate `imports` rows / non-atomic anchor).** Touches commit's write shape and what
  "the same import" even means — needs its own fixtures and reasoning, not a mechanical patch
  riding on everything else.
- **FA-14's overlap lock.** Only the timing-unsafe compare was fixed. A skipped Sunday just means
  stale prices until next week, and a double-run is already safe because `refreshPrices` upserts
  idempotently — low enough risk that adding lock state wasn't worth a schema change here.
- **FA-15 dead scripts.** Deletion needs owner approval (the task says ask before deleting) — see
  below.

---

## The three refactors that pay off most next

1. **Make the commit trust boundary real.** Re-parse the source (or a signed import token)
   server-side in `/api/commit` so amounts/dates/reconciliation are server-authoritative, not
   client-echoed (FA-5). This is the one place the app's core promise — deterministic, reconciled
   money — is only enforced by convention.
2. **Get off `xlsx@0.18.5`.** Move to a patched SheetJS build or a maintained fork and re-prove the
   broker/Money-Manager parsers through the gate (FA-3). Removes the only known-CVE dependency on a
   user-upload path.
3. **Give the gate a runtime tier.** Every severe defect here (FA-1 pagination, FA-5 boundary,
   FA-8/FA-9 race/RLS gaps) was invisible to `verify.ts` because it never runs a route or the DB. A
   thin integration harness — spin the handlers against a seeded Postgres, assert
   pagination/authz/reconciliation — would have caught FA-1 mechanically. The current gate proves
   the *pure core*; the money is increasingly in the *wiring*.

---

## One open decision for the owner

**FA-15:** `scripts/diag-recon.ts` and `scripts/gen-mm-fixture.ts` are wired to nothing (no
`package.json` script, no CI, no import — each only mentions its own run command in its own header
comment). They look like leftover dev utilities and are safe to delete, but per the audit's ground
rules I did not remove them. Say the word and they go in a one-line commit.

**Also worth 20 minutes whenever convenient:** apply migration `0010_category_source_index.sql`
(FA-10) — it's additive and safe, but migrations are human-applied in this project, so it sits
unapplied until you run it.

_No changes on this branch were pushed until reviewed._
