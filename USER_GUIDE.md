# wealth-os — User Guide & FAQ

_Last updated: 2026-06-14. Reflects IA v2 (the 7-item nav + drill-downs), the AI categorizer, and the Money Box Compass._

Your private, import-only wealth dashboard. You feed it bank / card / broker statements; it reconciles them to the paisa, sorts every transaction into your Monika Halan taxonomy, and shows net worth, cash flow, spending, leakage — and now the **Compass**, which tells you whether your money is healthy (the Machine) and whether your spending is buying a better life (the Mirror). Single user, your own Supabase + Vercel.

**Two rules that define everything:**
- **Import-only** — data exists only after you import a statement. No statement = empty screen. Nothing is auto-pulled from your banks; you control what goes in.
- **Reconcile-or-show** — a statement's own opening → closing arithmetic must match its transactions before it's trusted. A green "Reconciled" banner means the numbers are provably correct.

---

## The monthly ritual (the whole point — about 10 minutes)

1. **Export** last month's statements (bank, credit card) as **markdown (.md)**. PDFs are converted to markdown *outside* the app first (e.g. MarkItDown). See the Statement Intake SOP for the per-institution steps.
2. **Transactions → Import** → pick the matching account → drop the file → **Parse & reconcile**.
3. Confirm the green **Reconciled** banner (opening + Σ transactions = closing).
4. **Categorize.** Most rows are pre-filled — first by your **vendor rules**, then you run **AI-suggest** for the rest (it proposes a category from the description; you confirm). Hand-fix the long tail. Tag impulse/regret spends as **leakage**. Anything you're unsure of stays **Uncategorized Review**.
5. **Commit.** (Re-importing the same period later inserts nothing — safe.)
6. **Transactions → Review** → clear anything still in Uncategorized Review.
7. **Read the Compass**, then the **Dashboard**.

**First time only:** Accounts → **Set up my workspace** (one-time seed of the 276 categories, your vendor rules, and your accounts).

**Critical for accuracy — categorize transfers as transfers.** Money moving between your own accounts, **credit-card bill payments**, and money you send to your broker to invest are **Transfers (parent 10)** — not income or spend. If a ₹50k transfer to Zerodha sits in "spend," every ratio on the dashboard and Compass is wrong. This is the single most important habit.

---

## The pages

The nav is seven items; a few pages have drill-down sub-views you reach by clicking a number.

| Page | What it does |
|---|---|
| **Dashboard** | Net worth (cash + investments), monthly cash flow (income / spend / invest), spend by Halan bucket, leakage watchlist, account balances, review-queue count. Click any tile/number to drill in. |
| **Transactions** | The hub, three tabs: **Import** (upload → reconcile → categorize → commit), **Review** (your committed rows — recategorize, tag leakage, run AI-suggest; autosaves), **Rules** (your vendor→category rules + re-run-rules). Account filter across all three. |
| **Compass** | **The Machine** (Halan health checks H1–H6) + **The Mirror** (Housel reflection). See "Reading the Compass" below. |
| **Accounts** | Your accounts, each one's anchor balance and month contribution, and the one-time "Set up my workspace". |
| **Holdings** | Import **Zerodha** and **Upstox** holdings (xlsx) → present value. Upstox also brings dividends and realized gains. Map any "unmapped" symbol so live prices attach. |
| **Loans** | Your loans with amortization + prepayment what-ifs (reduce-tenure vs reduce-EMI), and — where you imported a lender repayment schedule — the **actual** schedule, not a recomputed one. |
| **Calculators** | A tabbed hub: **emergency fund**, **retirement / FIRE + withdrawal**, **Human Life Value** (insurance cover), **SIP / step-up + goal corpus**, **capital gains**, and **old-vs-new tax regime**. |
| **Settings** | Which **LLM provider** (Gemini / OpenAI) and price sources are active. Stores the choice only — keys live in the server env, never here. |

**Drill-downs:** `/insights/<metric>` (income · spend · invest · leakage · net) and `/buckets/<NN>` (any of the 15 parent buckets) show the contributing transactions with by-account provenance, a trend, and inline editing. `/upstox` is the Upstox detail page.

---

## Reading the Compass

The Compass is **pure math on your categorized data** — no AI touches any number. Because you're a sole proprietor, it treats your money as **one pool seen through two lenses, split by category, not by account.** Your true personal income = all income − business costs (parent 11) − tax (parent 12). Every ratio uses a **trailing multi-month average** (income is lumpy), and the window is shown on screen.

**The Machine — "is my money healthy?"** Six checks, each a number with a red/amber/green band and one next action:
- **H1 Cash-flow ratios** — save rate (target ≥20%), EMI/debt load (≤25–30%), living cost (≤50%).
- **H2 Emergency fund** — months of runway from **cash + savings only** (not investments); target **6 months** given lumpy income.
- **H3 Protection** — whether term + health premiums are actually flowing; links to the HLV calculator to check the cover amount.
- **H4 Investing consistency** — did you invest **every** month, or skip some (the SIP-discipline check)?
- **H5 Allocation / concentration** — your largest holding as % of the portfolio, plus the asset-class split where your holdings are tagged.
- **H6 Net-worth trajectory + leakage** — net worth direction (needs ≥2 months of history) and total leakage as % of spend.

**The Mirror — "is my spending buying a better life?"** The deliberate counterweight to the Machine:
- **Freedom ratio** — months you could fund your life with **zero income** (uses total liquid net worth incl. investments — broader than H2's cash-only buffer).
- **Lifestyle-creep** — is spend growing faster than income?
- **Enjoyment floor** — if you're saving very hard and spending almost nothing on "wants," a gentle nudge that you can afford to enjoy more.
- **A 7-question reflection checklist** — for monthly/quarterly thought, not scoring.

The Machine pushes "save more"; the Mirror asks "are you actually living a life you can afford?" Holding both is the point.

---

## What you CAN do
- Import bank + credit-card statements (markdown), reconciled to the paisa; import Zerodha + Upstox holdings (xlsx).
- Categorize into the full Halan taxonomy — vendor rules first, then **AI-suggest** (description-only), then hand-fix; tag leakage.
- See net worth, cash flow, spend buckets, leakage, account balances, with drill-downs.
- Read the **Compass** (Machine + Mirror) and run the **calculators** (emergency fund, retirement/FIRE, HLV, SIP/goal, capital gains, tax regime).
- Track loans with prepayment what-ifs and your real lender schedule.
- Re-import freely — duplicates are ignored by content hash.

## What you CANNOT do (yet, or by design)
- **No live bank/broker pull** — you import statements yourself (deliberate: keeps data reconciled and owned).
- **No in-app PDF parsing** — convert to markdown first.
- **No per-trade buy/sell ledger from Upstox** — holdings + dividends + realized gains only; the true trade book is a separate export, deferred.
- **No physical/digital gold, PF/PPF/FD, or CAS/eCAS feeds yet** — only demat holdings via Zerodha + Upstox.
- **No full-ledger export screen** — Review shows recent rows; use the Supabase Table Editor for everything.
- **Single user only.**

---

## Key concepts (worth knowing once)
- **Reconciliation** — opening + Σ transactions must equal closing. Green = trustworthy.
- **Content-hash dedup** — re-importing an overlapping period inserts nothing. Safe to re-run.
- **Category vs leakage** — *category* = what money was for (Food Delivery). *Leakage* = a **tag** you add to impulse/regret spends; never auto-assigned. A coffee is "Cafes"; a regretted 11pm coffee is "Cafes" + `leakage`.
- **Transfers (parent 10)** — own-account moves, CC bill payments, and money sent to invest are transfers; they're income/spend-neutral. Mis-tagging these is the #1 way to corrupt every number.
- **The proprietor lens** — one mixed pool; the Personal vs Business split is **by category**, never by which account holds the money. There is no "business account" flag.
- **Uncategorized Review** — the safe fallback. The app never guesses a category outright; AI only *suggests* and you confirm.
- **Anchor balance** — net worth starts from the opening balance of your earliest imported statement, then flows forward. Import your oldest statement first for an accurate base.
- **Integer paise** — all money stored exactly; no floating-point drift.
- **Migrations are applied by you** — the build/deploy being green does **not** mean a new DB migration ran. When a new feature ships with a migration, apply it in the Supabase SQL editor (your agent gives you the link + SQL), then redeploy if needed.

---

## FAQ

**Why didn't everything auto-categorize?**
Vendor rules only match vendors they already know; new UPI strings fall back rather than guess. Run **AI-suggest** for the unknowns (it proposes from the description; you confirm, and each confirm can save a rule), then hand-fix the rest. Next month catches far more automatically.

**Can AI categorize for me, and is it private?**
Yes — AI-suggest sends only the **description text** (never amounts, dates, or balances) to your chosen model (Gemini by default; OpenAI if you set its key) and suggests a category you confirm. A free-tier key is enough.

**I selected OpenAI but it still uses Gemini.**
OpenAI only runs if `OPENAI_API_KEY` is set in the **Vercel server env** and you've redeployed. If it's missing you'll see a clear "key not set" message — it won't silently fall back. Gemini works without any of this.

**Everything imported as "Uncategorized Review." Will Commit error?**
No — it's a valid category. Commit is safe; fix later in Review. Until fixed, those rows behave like transfers and don't show in income/spend/invest.

**Will re-importing duplicate my data?**
No. It's idempotent by content hash — re-import the same file and 0 rows are inserted.

**My statement is a PDF.**
Convert it to markdown first (MarkItDown or similar), then import the .md. The app doesn't parse PDFs by design.

**Where do I see ALL my data, not just recent rows?**
Supabase dashboard → Table Editor, or the SQL Editor for any query. The in-app Review is capped on purpose.

**Holdings import failed.**
Set `SUPABASE_SERVICE_ROLE_KEY` in Vercel → Environment Variables, then redeploy once. Holdings write shared reference data via the service client; bank imports don't need it.

**A Compass number looks wrong.**
Almost always a categorization issue — most often a transfer (own-account move, CC bill payment, or money sent to invest) sitting in income or spend. Fix it in Review and re-check. The Compass is only as honest as the buckets underneath it. Also watch **dividend double-counting**: if Upstox already booked a dividend and the matching bank credit is also income, mark the bank credit as a transfer.

**The Compass says "needs more history" / "categorize first."**
Net-worth trend needs ≥2 months of imported statements; the ratios need categorized data. Both fill in as you run the monthly ritual — they're labels, not errors.

**How is my data protected?**
Your own Supabase project with row-level security — only your logged-in account reads your rows. Source statements stay on your Mac / repo and are not committed to git. LLM keys live in the server env, never in the browser or the database.

**How often do I use this?**
Monthly: import last month's statements, categorize, read the Compass and dashboard. Hands-free between sessions.
