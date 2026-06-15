# 03 — Dashboard (cashflow Sankey, outflows donut, net-worth line)

> Read `00_PORTING_GUIDE.md` first. Restated in wealth-os terms (paise, `+`=inflow, `user_id`, 276 taxonomy). Sure pointers `path:line` at `b0b0dc86…`, re-read this run. Balance-sheet section is in `04_BALANCE_SHEET.md`.

## 1. What it is

A reorderable stack of dashboard sections: a **cashflow Sankey** (income → Cash-Flow hub → expenses → surplus), an **outflows donut** (spend by category), an **investment summary**, a **net-worth line**, and a **balance sheet**. Sections collapse and drag-reorder, persisted per user.

## 2. Sure data model

No dashboard tables. The dashboard reads `IncomeStatement` net totals + `BalanceSheet` (see `04`). Section order/collapse persists on the **user** (`dashboard_section_order`, a user pref — `pages_controller.rb build_dashboard_sections`). Charts are bespoke **D3** Stimulus controllers: `sankey_chart_controller.js` (uses `d3-sankey`), `donut_chart_controller.js`, `time_series_chart_controller.js`.

## 3. The math / algorithm (numbered)

### Cashflow Sankey — the prize (`pages_controller.rb:148-235`)

The output is a `{ nodes, links }` graph for `d3-sankey`. Node = `{ id, name, value, percentage, color }`; link = `{ source, target, value, color, percentage }` (source/target are node **indices**). Build it (in paise; `value` is paise, `percentage` is 0–100):

1. **Inputs**: per-parent net income + net spend for the period, and per-leaf nets. In wealth-os, get these from `bucketTotals()` (`src/lib/halan.ts`) for parents and `src/lib/drilldown.ts` for leaves — **do not recompute from raw rows**. `total_income = Σ net-income parents`, `total_expense = Σ net-spend parents` (porting guide §2/§6 for sign + exclusion).
2. **Central hub** (`:164`): one node `"Cash Flow"`, `value = total_income`, `percentage = 100`.
3. **Net leaves per parent** (`build_net_subcategories:204-235`): for each leaf, `net = spend − income`; keep `|net|` with `direction = net>0 ? spend : income`; skip zero. A leaf whose net direction is **opposite** its parent's appears on the *other* side of the diagram.
4. **Income side (inbound)** (`:170-179`): links flow **leaf → parent → Cash-Flow**. Each income parent links to the hub with `value = parent net inflow`; its income leaves link into it.
5. **Expense side (outbound)** (`:182-191`): links flow **Cash-Flow → parent → leaf**. Each spend parent receives from the hub with `value = parent net spend`; its leaves receive from it.
6. **Surplus/Deficit** (`:193-199`): `net = total_income − total_expense`; if `net > 0`, add a `"Surplus"` node + link `Cash-Flow → Surplus` with `value = net`, `percentage = net / total_income × 100`. (Symmetric deficit handling if you want the negative case.)
7. **Percentages**: each node/link carries its share of the relevant side's total (`value / total × 100`).

**Rendering algorithm** (for React + `d3-sankey`, mirroring `sankey_chart_controller.js`): run the `d3-sankey` layout over `{nodes, links}`; draw links as `d3.linkHorizontal` curved paths with a source→target color gradient and width ∝ value; draw nodes as rounded rects; on hover, highlight a link's connected nodes and fade the rest; click a parent node to zoom into its leaves; click a node/link to navigate to the filtered transactions. **Recharts cannot render a Sankey** — `d3-sankey` (or `@visx/sankey`) is required.

### Outflows donut (`donut_chart_controller.js`)
8. Spend-by-parent for the period (`bucketTotals` outflows), sorted desc; donut segments colored by category, center shows total outflow; hover swaps the center to the segment amount; click → filtered transactions. wealth-os already shows this as **bars** (`src/components/dashboard/spend-buckets.tsx`); donut is cosmetic.

### Net-worth line (`time_series_chart_controller.js`)
9. A `{ date, value }` series over the period (see `04_BALANCE_SHEET.md` rule for `net_worth_series`), drawn as a D3 line with a split-color gradient + tooltip.

## 4. UI/UX shape

- A period picker at the top (turbo-frame reload).
- Sections are **collapsible + drag-reorderable** (mouse/touch/keyboard), order + collapsed-state persisted per user.
- Sankey section: fixed height, an expand-to-fullscreen control, an "Add Transaction" empty state.
- Every chart has hover tooltips and click-through to filtered transactions.

## 5. ★ wealth-os build notes

**Module `src/lib/sankey.ts`** (pure, paise): `buildCashflowSankey(period): { nodes, links }` implementing rules 1–7, consuming `bucketTotals()` + `drilldown.ts` leaf nets. Keep it framework-free (testable under `tsx`).

**Client component**: a `"use client"` chart in `src/components/charts.tsx` (or a sibling) using **`d3-sankey`**. ⚠ **Stack-lock note (CLAUDE.md):** Recharts — the locked chart lib — has no Sankey, so this needs a new dep (`d3-sankey` + `d3-shape`, or `@visx/sankey`). Flag it for the build prompt to approve as a justified addition; it is the minimal way to get a Sankey.

**Section order/collapse persistence — reuse, don't migrate:** there is already a per-user **`profile`** table with a `data jsonb` column (`supabase/migrations/0006_profile.sql`, shape `{checklist, asOf, …}`). Store `dashboardSectionOrder` / `collapsedSections` there rather than a new table.

**Net-worth series**: wealth-os has no stored time series; build it by replaying txns cumulatively against the anchor (reuse `accountBalances()` logic in `src/lib/halan.ts`, evaluated at each period step). See `04_BALANCE_SHEET.md`.

**Reuse / never-hardcode**: parents via `SPEND_CLASSES` + `classifyParent` (`halan.ts`), leaves + names via `parentByCatId` (`server/load-drill.ts`) — no category-name string literals.

**`verify.ts` tests:**
- rule 6: on a fixture period, `Σ income-side link values into hub = total_income`; `Σ hub-outbound expense link values = total_expense`; `surplus = total_income − total_expense` (paise-exact).
- rule 1: Sankey parent totals equal `bucketTotals()` for the same period (the Sankey must not invent a parallel aggregation).
- rule 3: a leaf with net opposite its parent lands on the correct side.
