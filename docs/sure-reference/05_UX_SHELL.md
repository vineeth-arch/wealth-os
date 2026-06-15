# 05 — UX shell (optional, Phase B4 cosmetic parity)

> Optional. wealth-os's existing 7-item nav (`src/components/app-shell.tsx`) already works; this captures Sure's shell only if you want closer visual parity. Restated in wealth-os terms. Sure pointers `path:line` at `b0b0dc86…`, re-read this run.

## 1. What it is

Sure's frame: a slim left **icon rail**, a collapsible **account-tree sidebar** (Assets / Debts / All tabs, group totals + sparklines), the main content, and an optional right AI panel. The signature element is the always-visible account tree.

## 2. Sure data model

Pure view layer — `app/views/layouts/application.html.erb` (the 3–4 column shell) + `app/views/accounts/_account_sidebar_tabs.html.erb` (the account tree). The tree's tabs are a `DS::Tabs` with `session_key: "account_sidebar_tab"` (`_account_sidebar_tabs.html.erb:14`) and three buttons — `all` / `asset` / `liability` (`:16-18`); each panel renders `family.balance_sheet.assets.account_groups` (resp. liabilities) via `accounts/_accountable_group` (`:34-36`).

## 3. The structure / algorithm (numbered)

1. **Tabs**: All / Assets / Debts, active tab persisted in session (→ wealth-os: a cookie or `profile.data`).
2. **Per tab**: list `accountable_group` disclosures from the balance sheet (`04_BALANCE_SHEET.md` classification): Assets tab = asset groups, Debts tab = liability groups, All = both.
3. **Group disclosure**: header = group name + **group total** + lazy **sparkline**; expands to per-account rows (logo, name, sync state, subtype, balance, sparkline) + a "New …" action.
4. **Other shell affordances**: a global **period picker**, **drag-reorder** of dashboard sections, and a **privacy-blur** toggle that masks all money values.

## 4. UI/UX shape

Left icon rail (~84px) → collapsible sidebar (≤320px, the account tree) → main → optional right panel. Mobile collapses the sidebar to a drawer + bottom nav.

## 5. ★ wealth-os build notes

- **Lowest priority** — do this only after Budgets/Reports/Dashboard land. The current `app-shell.tsx` 7-item nav is functional; an account-tree sidebar is a nice-to-have, not a gap.
- If built: drive the tree from the **balance-sheet classification** in `04_BALANCE_SHEET.md` (assets = `kind ∈ {bank, broker, asset_snapshot}`, liabilities = `credit_card` + `loans`); reuse `accountBalances()` / `holdingsValue()` for group totals.
- **Privacy-blur** is cheap and genuinely useful (a CSS blur toggle over money spans); consider pulling it forward independently of the rest of the shell.
- Persist the active tab + privacy state in `profile.data` (`0006_profile.sql`) — no new migration.
