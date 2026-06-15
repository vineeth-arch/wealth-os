# SURE_STRATEGY.md — complement, rebuild, or fork (the decision input)

> Reads on top of `SURE_AUDIT.md` (what Sure is) and `SURE_GAP.md` (what wealth-os lacks). This document does **not** decide — it lays out the three paths with honest costs, gives a recommendation **and what would flip it**, and ends with the single question that actually settles it. The decision is vn's.

The situation in one line: wealth-os already has **3 of the 4 screens** vn cares about (Transactions, Dashboard, categorization) **plus an irreplaceable specialist layer** (paise-exact Indian parsers behind a verification gate, the 276-name Halan taxonomy, Compass, loan amortization, India tax calculators). Sure already ships the **one screen wealth-os lacks (Budgets)** plus a more polished Reports/Dashboard — and a large surface wealth-os deliberately doesn't want (live sync, multi-user, AI/MCP). So the real question isn't "who has more features" — it's **which codebase vn wants to own**.

---

## The three paths

### A — Complement (status quo): keep both apps
Use **Sure** for budgets/reports/dashboard polish, **wealth-os** for parsing/Halan/Compass/calculators. Export between them as needed.
- **Effort:** ~0 (already how vn lives).
- **Key trade-off:** two apps, two data stores, two mental models, and **manual data movement** forever. The same transactions live in both; they drift. You maintain a Rails app *and* a Next.js app.
- **Best when:** the friction of two apps hasn't actually started costing you real time, and you don't want to commit build effort right now.

### B — Rebuild Sure's gap into wealth-os (Next.js), retire Sure
Build **only the MISSING/PARTIAL rows** from `SURE_GAP` — Budgets, a unified Reports page + period engine + export, the Sankey + balance-sheet widgets, transactions polish. **Not** "everything": wealth-os already has Transactions/Dashboard/categorization, and the budget *actuals* are nearly free because `src/lib/halan.ts` already does the spend aggregation.
- **Effort:** Budgets **L** + Reports **M–L** + dashboard widgets **M** + transactions polish **M**; recurring/splits as follow-ons. Realistically a **multi-week-to-a-couple-months** staged build, not "months of a mature Rails product" — because you are not rebuilding live sync, multi-user, or the AI stack.
- **Key trade-off:** you reimplement a mature product's budget/report/balance-sheet/cashflow UX in Next.js — real work, and you own the result. But you **keep the crown jewels in place** (the verified parsers, the gate, the taxonomy) and stay on one stack you already know.
- **Best when:** vn wants **one owned app, in TypeScript, import-only**, and is willing to build the gap.

### C — Fork Sure (Rails), port wealth-os's specialist layer into it, retire wealth-os
Take Sure (which already ships budgets/reports/dashboard) and add wealth-os's layer: the Halan taxonomy lens, Compass, the Indian-bank parsers + enrichers, the calculators.
- **Effort:** budgets/reports/dashboard come **free**, but you must **port the most precious, hardest-won code into Ruby** — the paise-exact parsers that *reconcile to the paisa under a gate*, plus Halan/Compass/calculators — and you **lose the TypeScript verification harness** (`npm run verify`) that currently proves they're correct. Plus: inherit **AGPLv3**, maintain a **fork against a fast-moving 131-model upstream**, and live in Rails/Hotwire.
- **Key trade-off:** the prompt is right that forking is *often* the cheapest route to "one app with everything" — **but that assumes the specialist layer is thin.** Here it is the opposite: the specialist layer is the expensive, verified, irreplaceable part. Re-deriving the parsers in Ruby and losing the gate is the single biggest risk in this whole analysis (the project's worst historical defect was a silently broken parser; the gate is the defense).
- **Best when:** vn decides the **Rails ecosystem itself** is the prize — i.e. you actually want live bank sync, multi-user, and the AI assistant/MCP, all of which Sure already has and which are out-of-scope/expensive to add to wealth-os.

---

## AGPLv3 (read once, then mostly stop worrying)
Sure is **AGPL-3.0** (`LICENSE`). Copying Sure's *code* into wealth-os (path C, or lifting Sure source in path B) puts the result under AGPLv3. For **personal self-hosting this is irrelevant** — AGPL obligations trigger on **distribution / offering it as a network service to others**. It only matters if vn ever distributes wealth-os or runs it as a service for other people. Path B done as a **clean reimplementation from the spec in `SURE_AUDIT.md`** (not copy-pasting Sure code) keeps wealth-os under its own license; the budget *math* and *UX patterns* are not themselves copyrightable, the specific code is. Path C is inherently AGPLv3.

---

## Recommendation

**Lean B — rebuild the gap into wealth-os — *if* vn is ready to commit to owning the Next.js app long-term. Until that commitment is real, A (status quo) is the correct zero-cost holding pattern, not a failure.**

Why B over C, specifically for this project:
1. wealth-os already has 3 of the 4 screens and the **verified parsers + gate** — path C throws that verification away by porting parsers to Ruby. That's the wrong code to re-derive.
2. The remaining gap (Budgets, Reports, two widgets) is **bounded and additive**, and Budgets — the marquee gap — is **L not XL** because `halan.ts` already supplies the actuals and the Halan tree already supplies the hierarchy.
3. One stack, one data store, no export drift, no AGPL entanglement (clean-room reimplementation).

Why not C by default: it's only cheaper if you *want* the rest of Rails-Sure (live sync, multi-user, AI/MCP). If you don't, you're paying to maintain a 131-model fork and re-verify your parsers in a language without your gate.

Why A is still legitimate: if the two-app friction isn't actually hurting yet, B's build cost may not be worth paying this quarter. A → B is a fine sequence; you lose nothing by staging.

**What would flip the recommendation:**
- → **C** if vn wants **live bank feeds, multi-user, or the AI assistant/MCP** as first-class features. Sure has them; adding them to wealth-os is out of scope by design.
- → **A (stay)** if vn isn't ready to commit build time — keep using Sure for budgets/reports and revisit when the friction bites.
- → **B becomes urgent** if vn wants Halan-taxonomy-native budgets/reports (Sure's generic categories can't express the 276-leaf lens or the leakage tag the way wealth-os does).

---

## The single deciding question

**Which codebase does vn want to *own* for the next decade — the Next.js wealth-os, or a Rails fork of Sure — or keep running two?**

Everything else (effort, AGPL, which features) follows from that one answer. If the answer is "the Next.js app," it's B. If it's "the Rails app, because I want sync/multi-user/AI too," it's C. If it's "I don't want to choose yet," it's A.

---

## If the lean is B — the phased build order (each is its own future prompt)

Do **not** build this as one mega-feature. Stage it; each phase ends at something the gate or a reconciliation can check.

1. **Phase B1 — Budgets** (the headline gap, highest value).
   *Scope:* migration (`budgets`, `budget_categories`, bigint-paise targets) → on-track engine layered on `halan.ts` (`bucketTotals`/`monthlyCashFlow`, excluding transfers/invest/assets like `BUDGET_EXCLUDED_KINDS`) → targets editor + budget ring + over/on-track rows → month nav (reuse `month-select.tsx`) + copy-previous. *Check:* allocated + available-to-allocate reconcile; actuals equal the dashboard's spend-by-bucket for the same month.

2. **Phase B2 — Reports.**
   *Scope:* a **period abstraction** (Monthly/Quarterly/YTD/Custom) generalizing the current month-only model → a unified reports page (P&L by parent/leaf with subcategory rollup + period-over-period %) reusing `drilldown.ts` → **CSV export** (and optional print). *Check:* report totals equal `halan.ts` aggregates for the same range; CSV sums match on a fixture month.

3. **Phase B3 — UX polish (dashboard widgets).**
   *Scope:* the **cashflow Sankey** (data free from `bucketTotals`) and the **asset/liability balance-sheet widget** (classify by account `kind` + `loans`), plus a net-worth line. *Check:* balance-sheet assets − liabilities equals `accountBalances().netWorthPaise`; Sankey link sums equal income/spend totals.

Recurring/upcoming and splits/transfer-pairing are **separate, later** prompts (each its own L/M), not part of the first parity push.
