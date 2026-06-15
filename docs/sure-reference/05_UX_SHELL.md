# 05 — UX shell (optional, Phase B4 cosmetic parity)

> Optional. wealth-os's existing 7-item nav (`src/components/app-shell.tsx`) already works; this captures Sure's shell only if you want closer visual parity. Restated in wealth-os terms. Sure pointers `path:line` at `b0b0dc86…`, re-read this run.

## 1. What it is

Sure's frame: a slim left **icon rail**, a collapsible **account-tree sidebar** (Assets / Debts / All tabs, group totals + sparklines), the main content, and an optional right AI panel. The signature element is the always-visible account tree.

## 2. Sure data model

Pure view layer — `app/views/layouts/application.html.erb` (the 3–4 column shell) + `app/views/accounts/_account_sidebar_tabs.html.erb` (the account tree). The tree's tabs are a `DS::Tabs` with `session_key: "account_sidebar_tab"` (`_account_sidebar_tabs.html.erb:14`) and three buttons — `all` / `asset` / `liability` (`:16-18`); each panel renders `family.balance_sheet.assets.account_groups` (resp. liabilities) via `accounts/_accountable_group` (`:34-36`).

## 3. The structure / algorithm (numbered)

1. **Tabs**: All / Assets / Debts, active tab persisted in session (→ wealth-os: a cookie or `profile.data`).
2. **Per tab**: list `accountable_group` disclosures from the balance sheet (`04_BALANCE_SHEET.md` classification): Assets tab = asset groups, Debts tab = liability groups, All = both.
3. **Group disclosure** (`accounts/_accountable_group.html.erb`): a `DS::Disclosure` whose summary = chevron + group name (`animate-pulse` while syncing) + **group total** (`format_money(...) privacy-sensitive`, `:15`) + a **lazy sparkline** via `turbo_frame_tag … src: accountable_sparkline_path(group.key), loading: "lazy"` with a 10 s `turbo-frame-timeout` (`:16`). Expands to per-account rows (logo, name, sync pulse, subtype, `balance … privacy-sensitive` `:45`, lazy per-account sparkline `:46`) + a "New …" action.
4. **Other shell affordances**: a global **period picker**, **drag-reorder** of dashboard sections, and a **privacy-blur** toggle (full spec in §6).

## 4. UI/UX shape

Left icon rail (~84px) → collapsible sidebar (≤320px, the account tree) → main → optional right panel. Mobile collapses the sidebar to a drawer + bottom nav.

## 5. ★ wealth-os build notes

- **Lowest priority** — do this only after Budgets/Reports/Dashboard land. The current `app-shell.tsx` 7-item nav is functional; an account-tree sidebar is a nice-to-have, not a gap.
- If built: drive the tree from the **balance-sheet classification** in `04_BALANCE_SHEET.md` (assets = `kind ∈ {bank, broker, asset_snapshot}`, liabilities = `credit_card` + `loans`); reuse `accountBalances()` / `holdingsValue()` for group totals.
- **Privacy-blur** (§6) is cheap and genuinely useful — pull it forward independently of the rest of the shell.
- Persist the active sidebar tab in `profile.data` (`0006_profile.sql`); persist privacy state in **`localStorage`** (matches Sure — no DB round-trip, no migration). The right **AI panel** is out of scope (the no-money-to-LLM wall).

## 6. Privacy-blur toggle (the cheap win — build first)

A header toggle that blurs every money value (screenshots, screen-sharing). **UI-only — no schema, no formula.** Effort **S**.

**Sure** (`app/javascript/controllers/privacy_mode_controller.js`):
1. Sensitive elements carry a `privacy-sensitive` class (e.g. every `format_money(...)`); CSS blurs them when active.
2. The toggle adds/removes a `privacy-mode` class on `document.documentElement` (`:23-28`).
3. State persists in **`localStorage["privacyMode"]`** (`:13,:19`) — not the DB.
4. No flash-of-unblurred-content: a tiny synchronous `<head>` script pre-applies the class on first paint (`_privacy_mode_check.html.erb`).

**★ wealth-os build notes:**
- A small `"use client"` toggle in `src/components/app-shell.tsx` flipping a `privacy-mode` class on `<html>`; a CSS rule blurs `.privacy-sensitive`. Apply that class inside the `formatINR`/`formatINRCompact` render path (`src/lib/format.ts` consumers) so coverage is automatic.
- State in `localStorage`; optional 3-line inline `<head>` script in the root layout to pre-apply (mind Next.js hydration).
- **Verify at runtime, not the gate** (per CLAUDE.md's UI-verification rule): a 2-minute click-through toggling blur across `/dashboard` and `/transactions`.
