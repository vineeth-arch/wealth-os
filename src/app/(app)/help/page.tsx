export const dynamic = "force-dynamic";

export const metadata = { title: "Help & User Guide — wealth-os" };

function H2({ children }: { children: React.ReactNode }) {
  return <h2 className="mt-10 mb-3 text-xl font-semibold text-foreground">{children}</h2>;
}
function H3({ children }: { children: React.ReactNode }) {
  return <h3 className="mt-6 mb-2 text-base font-semibold text-foreground">{children}</h3>;
}
function P({ children }: { children: React.ReactNode }) {
  return <p className="mb-3 text-sm text-muted-foreground leading-relaxed">{children}</p>;
}
function Li({ children }: { children: React.ReactNode }) {
  return <li className="text-sm text-muted-foreground leading-relaxed">{children}</li>;
}
function Strong({ children }: { children: React.ReactNode }) {
  return <strong className="font-semibold text-foreground">{children}</strong>;
}
function Code({ children }: { children: React.ReactNode }) {
  return <code className="rounded bg-secondary px-1 py-0.5 text-xs font-mono text-foreground">{children}</code>;
}

export default function HelpPage() {
  return (
    <div className="mx-auto max-w-3xl pb-16">
      <h1 className="mb-1 text-2xl font-bold tracking-tight text-foreground">User Guide & FAQ</h1>
      <p className="mb-8 text-xs text-muted-foreground">Last updated: 2026-06-14 · Reflects IA v2 (7-item nav + drill-downs), AI categorizer, and Money Box Compass.</p>

      <P>
        Your private, import-only wealth dashboard. You feed it bank / card / broker statements; it
        reconciles them to the paisa, sorts every transaction into your Monika Halan taxonomy, and shows
        net worth, cash flow, spending, leakage — and now the <Strong>Compass</Strong>, which tells you
        whether your money is healthy (the Machine) and whether your spending is buying a better life (the
        Mirror). Single user, your own Supabase + Vercel.
      </P>

      <div className="mb-8 rounded-lg border bg-secondary/40 px-5 py-4 text-sm">
        <p className="mb-2 font-semibold text-foreground">Two rules that define everything</p>
        <ul className="space-y-1 list-disc pl-5">
          <Li><Strong>Import-only</Strong> — data exists only after you import a statement. No statement = empty screen. Nothing is auto-pulled from your banks; you control what goes in.</Li>
          <Li><Strong>Reconcile-or-show</Strong> — a statement&apos;s own opening → closing arithmetic must match its transactions before it&apos;s trusted. A green &ldquo;Reconciled&rdquo; banner means the numbers are provably correct.</Li>
        </ul>
      </div>

      {/* Monthly ritual */}
      <H2>The monthly ritual (the whole point — about 10 minutes)</H2>
      <ol className="mb-4 space-y-2 list-decimal pl-5">
        <Li><Strong>Export</Strong> last month&apos;s statements (bank, credit card) as <Strong>markdown (.md)</Strong>. PDFs are converted to markdown <em>outside</em> the app first (e.g. MarkItDown). See the Statement Intake SOP for the per-institution steps.</Li>
        <Li><Strong>Transactions → Import</Strong> → pick the matching account → drop the file → <Strong>Parse &amp; reconcile</Strong>.</Li>
        <Li>Confirm the green <Strong>Reconciled</Strong> banner (opening + Σ transactions = closing).</Li>
        <Li><Strong>Categorize.</Strong> Most rows are pre-filled — first by your <Strong>vendor rules</Strong>, then you run <Strong>AI-suggest</Strong> for the rest (it proposes a category from the description; you confirm). Hand-fix the long tail. Tag impulse/regret spends as <Strong>leakage</Strong>. Anything you&apos;re unsure of stays <Strong>Uncategorized Review</Strong>.</Li>
        <Li><Strong>Commit.</Strong> (Re-importing the same period later inserts nothing — safe.)</Li>
        <Li><Strong>Transactions → Review</Strong> → clear anything still in Uncategorized Review.</Li>
        <Li><Strong>Read the Compass</Strong>, then the <Strong>Dashboard</Strong>.</Li>
      </ol>
      <P><Strong>First time only:</Strong> Accounts → <Strong>Set up my workspace</Strong> (one-time seed of the 276 categories, your vendor rules, and your accounts).</P>
      <div className="mb-6 rounded-lg border border-amber-500/30 bg-amber-500/10 px-5 py-4 text-sm">
        <p className="font-semibold text-foreground mb-1">Critical for accuracy — categorize transfers as transfers</p>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Money moving between your own accounts, <Strong>credit-card bill payments</Strong>, and money you send to your broker to invest are <Strong>Transfers (parent 10)</Strong> — not income or spend. If a ₹50k transfer to Zerodha sits in &ldquo;spend,&rdquo; every ratio on the dashboard and Compass is wrong. This is the single most important habit.
        </p>
      </div>

      {/* Pages */}
      <H2>The pages</H2>
      <P>The nav is seven items; a few pages have drill-down sub-views you reach by clicking a number.</P>
      <div className="mb-6 overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-secondary/60">
              <th className="px-4 py-2.5 text-left font-semibold text-foreground w-36">Page</th>
              <th className="px-4 py-2.5 text-left font-semibold text-foreground">What it does</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            <tr>
              <td className="px-4 py-2.5 font-medium text-foreground align-top">Dashboard</td>
              <td className="px-4 py-2.5 text-muted-foreground">Net worth (cash + investments), monthly cash flow (income / spend / invest), spend by Halan bucket, leakage watchlist, account balances, review-queue count. Click any tile/number to drill in.</td>
            </tr>
            <tr>
              <td className="px-4 py-2.5 font-medium text-foreground align-top">Transactions</td>
              <td className="px-4 py-2.5 text-muted-foreground">The hub, three tabs: <Strong>Import</Strong> (upload → reconcile → categorize → commit), <Strong>Review</Strong> (your committed rows — recategorize, tag leakage, run AI-suggest; autosaves), <Strong>Rules</Strong> (your vendor→category rules + re-run-rules). Account filter across all three.</td>
            </tr>
            <tr>
              <td className="px-4 py-2.5 font-medium text-foreground align-top">Compass</td>
              <td className="px-4 py-2.5 text-muted-foreground"><Strong>The Machine</Strong> (Halan health checks H1–H6) + <Strong>The Mirror</Strong> (Housel reflection). See &ldquo;Reading the Compass&rdquo; below.</td>
            </tr>
            <tr>
              <td className="px-4 py-2.5 font-medium text-foreground align-top">Accounts</td>
              <td className="px-4 py-2.5 text-muted-foreground">Your accounts, each one&apos;s anchor balance and month contribution, and the one-time &ldquo;Set up my workspace&rdquo;.</td>
            </tr>
            <tr>
              <td className="px-4 py-2.5 font-medium text-foreground align-top">Holdings</td>
              <td className="px-4 py-2.5 text-muted-foreground">Import <Strong>Zerodha</Strong> and <Strong>Upstox</Strong> holdings (xlsx) → present value. Upstox also brings dividends and realized gains. Map any &ldquo;unmapped&rdquo; symbol so live prices attach.</td>
            </tr>
            <tr>
              <td className="px-4 py-2.5 font-medium text-foreground align-top">Loans</td>
              <td className="px-4 py-2.5 text-muted-foreground">Your loans with amortization + prepayment what-ifs (reduce-tenure vs reduce-EMI), and — where you imported a lender repayment schedule — the <Strong>actual</Strong> schedule, not a recomputed one.</td>
            </tr>
            <tr>
              <td className="px-4 py-2.5 font-medium text-foreground align-top">Calculators</td>
              <td className="px-4 py-2.5 text-muted-foreground">A tabbed hub: <Strong>emergency fund</Strong>, <Strong>retirement / FIRE + withdrawal</Strong>, <Strong>Human Life Value</Strong> (insurance cover), <Strong>SIP / step-up + goal corpus</Strong>, <Strong>capital gains</Strong>, and <Strong>old-vs-new tax regime</Strong>.</td>
            </tr>
            <tr>
              <td className="px-4 py-2.5 font-medium text-foreground align-top">Settings</td>
              <td className="px-4 py-2.5 text-muted-foreground">Which <Strong>LLM provider</Strong> (Gemini / OpenAI) and price sources are active. Stores the choice only — keys live in the server env, never here.</td>
            </tr>
          </tbody>
        </table>
      </div>
      <P><Strong>Drill-downs:</Strong> <Code>/insights/&lt;metric&gt;</Code> (income · spend · invest · leakage · net) and <Code>/buckets/&lt;NN&gt;</Code> (any of the 15 parent buckets) show the contributing transactions with by-account provenance, a trend, and inline editing. <Code>/upstox</Code> is the Upstox detail page.</P>

      {/* Compass */}
      <H2>Reading the Compass</H2>
      <P>
        The Compass is <Strong>pure math on your categorized data</Strong> — no AI touches any number.
        Because you&apos;re a sole proprietor, it treats your money as <Strong>one pool seen through two lenses,
        split by category, not by account.</Strong> Your true personal income = all income − business costs
        (parent 11) − tax (parent 12). Every ratio uses a <Strong>trailing multi-month average</Strong> (income
        is lumpy), and the window is shown on screen.
      </P>

      <H3>The Machine — &ldquo;is my money healthy?&rdquo;</H3>
      <P>Six checks, each a number with a red/amber/green band and one next action:</P>
      <ul className="mb-4 space-y-1.5 list-disc pl-5">
        <Li><Strong>H1 Cash-flow ratios</Strong> — save rate (target ≥20%), EMI/debt load (≤25–30%), living cost (≤50%).</Li>
        <Li><Strong>H2 Emergency fund</Strong> — months of runway from <Strong>cash + savings only</Strong> (not investments); target <Strong>6 months</Strong> given lumpy income.</Li>
        <Li><Strong>H3 Protection</Strong> — whether term + health premiums are actually flowing; links to the HLV calculator to check the cover amount.</Li>
        <Li><Strong>H4 Investing consistency</Strong> — did you invest <Strong>every</Strong> month, or skip some (the SIP-discipline check)?</Li>
        <Li><Strong>H5 Allocation / concentration</Strong> — your largest holding as % of the portfolio, plus the asset-class split where your holdings are tagged.</Li>
        <Li><Strong>H6 Net-worth trajectory + leakage</Strong> — net worth direction (needs ≥2 months of history) and total leakage as % of spend.</Li>
      </ul>

      <H3>The Mirror — &ldquo;is my spending buying a better life?&rdquo;</H3>
      <P>The deliberate counterweight to the Machine:</P>
      <ul className="mb-4 space-y-1.5 list-disc pl-5">
        <Li><Strong>Freedom ratio</Strong> — months you could fund your life with <Strong>zero income</Strong> (uses total liquid net worth incl. investments — broader than H2&apos;s cash-only buffer).</Li>
        <Li><Strong>Lifestyle-creep</Strong> — is spend growing faster than income?</Li>
        <Li><Strong>Enjoyment floor</Strong> — if you&apos;re saving very hard and spending almost nothing on &ldquo;wants,&rdquo; a gentle nudge that you can afford to enjoy more.</Li>
        <Li><Strong>A 7-question reflection checklist</Strong> — for monthly/quarterly thought, not scoring.</Li>
      </ul>
      <P>The Machine pushes &ldquo;save more&rdquo;; the Mirror asks &ldquo;are you actually living a life you can afford?&rdquo; Holding both is the point.</P>

      {/* Can / Cannot */}
      <H2>What you CAN do</H2>
      <ul className="mb-6 space-y-1.5 list-disc pl-5">
        <Li>Import bank + credit-card statements (markdown), reconciled to the paisa; import Zerodha + Upstox holdings (xlsx).</Li>
        <Li>Categorize into the full Halan taxonomy — vendor rules first, then <Strong>AI-suggest</Strong> (description-only), then hand-fix; tag leakage.</Li>
        <Li>See net worth, cash flow, spend buckets, leakage, account balances, with drill-downs.</Li>
        <Li>Read the <Strong>Compass</Strong> (Machine + Mirror) and run the <Strong>calculators</Strong> (emergency fund, retirement/FIRE, HLV, SIP/goal, capital gains, tax regime).</Li>
        <Li>Track loans with prepayment what-ifs and your real lender schedule.</Li>
        <Li>Re-import freely — duplicates are ignored by content hash.</Li>
      </ul>

      <H2>What you CANNOT do (yet, or by design)</H2>
      <ul className="mb-6 space-y-1.5 list-disc pl-5">
        <Li><Strong>No live bank/broker pull</Strong> — you import statements yourself (deliberate: keeps data reconciled and owned).</Li>
        <Li><Strong>No in-app PDF parsing</Strong> — convert to markdown first.</Li>
        <Li><Strong>No per-trade buy/sell ledger from Upstox</Strong> — holdings + dividends + realized gains only; the true trade book is a separate export, deferred.</Li>
        <Li><Strong>No physical/digital gold, PF/PPF/FD, or CAS/eCAS feeds yet</Strong> — only demat holdings via Zerodha + Upstox.</Li>
        <Li><Strong>No full-ledger export screen</Strong> — Review shows recent rows; use the Supabase Table Editor for everything.</Li>
        <Li><Strong>Single user only.</Strong></Li>
      </ul>

      {/* Key concepts */}
      <H2>Key concepts (worth knowing once)</H2>
      <ul className="mb-6 space-y-2 list-disc pl-5">
        <Li><Strong>Reconciliation</Strong> — opening + Σ transactions must equal closing. Green = trustworthy.</Li>
        <Li><Strong>Content-hash dedup</Strong> — re-importing an overlapping period inserts nothing. Safe to re-run.</Li>
        <Li><Strong>Category vs leakage</Strong> — <em>category</em> = what money was for (Food Delivery). <em>Leakage</em> = a <Strong>tag</Strong> you add to impulse/regret spends; never auto-assigned. A coffee is &ldquo;Cafes&rdquo;; a regretted 11pm coffee is &ldquo;Cafes&rdquo; + <Code>leakage</Code>.</Li>
        <Li><Strong>Transfers (parent 10)</Strong> — own-account moves, CC bill payments, and money sent to invest are transfers; they&apos;re income/spend-neutral. Mis-tagging these is the #1 way to corrupt every number.</Li>
        <Li><Strong>The proprietor lens</Strong> — one mixed pool; the Personal vs Business split is <Strong>by category</Strong>, never by which account holds the money. There is no &ldquo;business account&rdquo; flag.</Li>
        <Li><Strong>Uncategorized Review</Strong> — the safe fallback. The app never guesses a category outright; AI only <em>suggests</em> and you confirm.</Li>
        <Li><Strong>Anchor balance</Strong> — net worth starts from the opening balance of your earliest imported statement, then flows forward. Import your oldest statement first for an accurate base.</Li>
        <Li><Strong>Integer paise</Strong> — all money stored exactly; no floating-point drift.</Li>
        <Li><Strong>Migrations are applied by you</Strong> — the build/deploy being green does <Strong>not</Strong> mean a new DB migration ran. When a new feature ships with a migration, apply it in the Supabase SQL editor (your agent gives you the link + SQL), then redeploy if needed.</Li>
      </ul>

      {/* FAQ */}
      <H2>FAQ</H2>
      <div className="space-y-5">
        {[
          {
            q: "Why didn't everything auto-categorize?",
            a: <>Vendor rules only match vendors they already know; new UPI strings fall back rather than guess. Run <Strong>AI-suggest</Strong> for the unknowns (it proposes from the description; you confirm, and each confirm can save a rule), then hand-fix the rest. Next month catches far more automatically.</>,
          },
          {
            q: "Can AI categorize for me, and is it private?",
            a: <>Yes — AI-suggest sends only the <Strong>description text</Strong> (never amounts, dates, or balances) to your chosen model (Gemini by default; OpenAI if you set its key) and suggests a category you confirm. A free-tier key is enough.</>,
          },
          {
            q: "I selected OpenAI but it still uses Gemini.",
            a: <>OpenAI only runs if <Code>OPENAI_API_KEY</Code> is set in the <Strong>Vercel server env</Strong> and you&apos;ve redeployed. If it&apos;s missing you&apos;ll see a clear &ldquo;key not set&rdquo; message — it won&apos;t silently fall back. Gemini works without any of this.</>,
          },
          {
            q: 'Everything imported as "Uncategorized Review." Will Commit error?',
            a: <>No — it&apos;s a valid category. Commit is safe; fix later in Review. Until fixed, those rows behave like transfers and don&apos;t show in income/spend/invest.</>,
          },
          {
            q: "Will re-importing duplicate my data?",
            a: <>No. It&apos;s idempotent by content hash — re-import the same file and 0 rows are inserted.</>,
          },
          {
            q: "My statement is a PDF.",
            a: <>Convert it to markdown first (MarkItDown or similar), then import the .md. The app doesn&apos;t parse PDFs by design.</>,
          },
          {
            q: "Where do I see ALL my data, not just recent rows?",
            a: <>Supabase dashboard → Table Editor, or the SQL Editor for any query. The in-app Review is capped on purpose.</>,
          },
          {
            q: "Holdings import failed.",
            a: <>Set <Code>SUPABASE_SERVICE_ROLE_KEY</Code> in Vercel → Environment Variables, then redeploy once. Holdings write shared reference data via the service client; bank imports don&apos;t need it.</>,
          },
          {
            q: "A Compass number looks wrong.",
            a: <>Almost always a categorization issue — most often a transfer (own-account move, CC bill payment, or money sent to invest) sitting in income or spend. Fix it in Review and re-check. The Compass is only as honest as the buckets underneath it. Also watch <Strong>dividend double-counting</Strong>: if Upstox already booked a dividend and the matching bank credit is also income, mark the bank credit as a transfer.</>,
          },
          {
            q: 'The Compass says "needs more history" / "categorize first."',
            a: <>Net-worth trend needs ≥2 months of imported statements; the ratios need categorized data. Both fill in as you run the monthly ritual — they&apos;re labels, not errors.</>,
          },
          {
            q: "How is my data protected?",
            a: <>Your own Supabase project with row-level security — only your logged-in account reads your rows. Source statements stay on your Mac / repo and are not committed to git. LLM keys live in the server env, never in the browser or the database.</>,
          },
          {
            q: "How often do I use this?",
            a: <>Monthly: import last month&apos;s statements, categorize, read the Compass and dashboard. Hands-free between sessions.</>,
          },
        ].map(({ q, a }) => (
          <div key={q} className="rounded-lg border bg-card px-5 py-4">
            <p className="mb-1.5 font-semibold text-foreground text-sm">{q}</p>
            <p className="text-sm text-muted-foreground leading-relaxed">{a}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
