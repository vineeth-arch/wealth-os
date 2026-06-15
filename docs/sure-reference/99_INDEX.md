# Sure reference — index

Clean-room reference docs extracted from **Sure** (`we-promise/sure`) to serve as the **source spec for the wealth-os Option B build** (Budgets · Reports · Dashboard · Balance Sheet). See `SURE_STRATEGY.md` (repo root) for why Option B (rebuild in Next.js) was chosen over forking Sure.

## Pinned source

| | |
|---|---|
| Repo | `https://github.com/we-promise/sure` |
| Commit (pinned) | `b0b0dc866deaa79cca9f1aa649480e5d408ad28d` |
| Sure version (`.sure-version`) | `0.7.2-alpha.6` |
| Stack | Rails 8.1 · Ruby 3.4.7 · Hotwire (Turbo/Stimulus) · D3 · PostgreSQL · AGPL-3.0 |
| Clone location (scratch, **outside** wealth-os) | `/tmp/sure-audit` (depth-1) |
| Extraction date | 2026-06-15 |

All `path:line` pointers in these docs are relative to the Sure repo root at the pinned commit, and were **re-read from source during this extraction run** — not taken from the earlier `SURE_AUDIT.md` (which is a prior audit summary, treated as a lead only). Where the prior audit disagreed with source, the source wins; corrections are noted in the relevant doc.

## The clean-room rule (restated)

Sure is **AGPL-3.0**; wealth-os is deliberately kept off AGPL. These docs therefore contain **reverse-engineered formulas, schema shapes, and algorithms rewritten in wealth-os's own terms** (integer paise · `+`=inflow · `user_id` · the 276-name Halan taxonomy · TypeScript-flavoured pseudocode) — **not Sure's source code**. Sure files are cited as `path:line` pointers for traceability only. No Sure source file, method body, class, or large verbatim chunk is copied into this repo; illustrative fragments are ≤ ~3 lines where a precise formula needs one. If a future task needs more detail, read the pinned Sure source directly — do not paste it here.

## Document map → which Option B phase consumes it

| Doc | Covers | Consumed by build phase |
|---|---|---|
| `00_PORTING_GUIDE.md` | Cross-cutting Sure→wealth-os translation (money, sign, ledger, tenancy, category, kinds/exclusions) | **All phases** — read first, every time |
| `01_BUDGETS.md` | Budget + budget-category model, on-track/allocation math, copy-previous | **Phase B1 — Budgets** |
| `02_REPORTS.md` | Period engine, income-statement metrics, CSV/Sheets export | **Phase B2 — Reports** |
| `03_DASHBOARD.md` | Dashboard section model + the cashflow **Sankey** algorithm, outflows donut, net-worth line | **Phase B3 — Dashboard** |
| `04_BALANCE_SHEET.md` | Net worth = assets − liabilities, classification groups, net-worth series | **Phase B3 — Balance-sheet dashboard section** |
| `05_UX_SHELL.md` *(optional)* | Icon rail + account-tree sidebar, period picker, drag-reorder, **privacy-blur** | **Phase B4 — cosmetic UX parity (optional)** |
| `06_TRANSACTIONS.md` | **Ledger backlog**, four sections: Quick-Categorize & Rules, Splits, Bulk-edit & Search, Import-revert | **Post-Option-B backlog** |
| `07_RECURRING.md` | Recurring detection (Welford variance, day-cluster), next-date, upcoming | **Post-Option-B backlog (L)** |

## Backlog ranking (post-Option-B)

Once Budgets → Reports → Dashboard/Balance-Sheet land, the highest-value extras (ranked by value × fit for an import-only single-user INR app):

1. **Quick-Categorize wizard** — `06_TRANSACTIONS.md` §1 — **S**, top pick (collapses the review→categorize ritual).
2. **Transaction splits** — `06_TRANSACTIONS.md` §2 — **M** (accuracy).
3. **Recurring / upcoming** — `07_RECURRING.md` — **L** (forward-looking; biggest "wow").
4. **Bulk-edit + search** — `06_TRANSACTIONS.md` §3 — **M**.
5. **Import revert** — `06_TRANSACTIONS.md` §4 — **M**.
6. **Privacy-blur** — `05_UX_SHELL.md` §6 — **S** (standalone afternoon).

Recommended build sequence: **Quick-Categorize → splits → recurring.** Out of scope (not gaps): live sync, multi-user, AI assistant/MCP, multi-currency — see `00_PORTING_GUIDE.md`.

## How to use these in a build prompt

Each surface doc follows the same 5-section shape: **What it is → Sure data model → The math/algorithm (numbered) → UI/UX shape → ★ wealth-os build notes**. A build prompt should cite the doc + the numbered rule (e.g. "implement `01_BUDGETS.md` rules 3–6", or "`06_TRANSACTIONS.md` §2") rather than re-deriving Sure. The **★ build notes** section is the translation layer (which migration, which `src/lib/*` module, what to reuse, which `verify.ts` tests) — that is what makes each doc a spec-precursor, not just Sure documentation.
