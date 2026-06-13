# RUNBOOK — wealth-os deploy from zero

Linear. Each step has a check. Don't proceed past a red check.

## 0. Prerequisites
- Node 20+ (`node -v`), npm, git, the Supabase CLI (`supabase --version`), a Vercel account.
- Repo: `vineeth-arch/wealth-os`. Supabase project ref: `ouhcdhyxuzhgkploncmt`. Vercel: `wealth-os-omega`.

## 1. Get the code and prove it locally
```bash
gh repo clone vineeth-arch/wealth-os
cd wealth-os
npm install
npm run verify      # CHECK: exit 0, "ALL GATES PASSED" (30 PASS). If red, stop — do not deploy.
npm run build       # CHECK: green. (uses placeholder envs fine; dynamic routes don't hit the DB at build)
```

## 2. Schema -> Supabase
```bash
supabase login
supabase init                  # only if supabase/config.toml is absent
supabase link --project-ref ouhcdhyxuzhgkploncmt
supabase db push               # applies supabase/migrations/0001_init.sql
```
Alternative (no CLI db push): paste `supabase/migrations/0001_init.sql` into Supabase Studio -> SQL Editor -> Run.
CHECK: Studio -> Table editor shows `accounts, categories, transactions, imports, vendor_rules, instruments, holdings_snapshots, prices, price_sources, integrations, bank_profiles`. `price_sources` has 5 rows.

## 3. Local env + first run
```bash
cp .env.example .env.local
# fill from Supabase Studio -> Project Settings -> API:
#   NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY
#   SUPABASE_SERVICE_ROLE_KEY  (server-only; used by the price/keep-alive cron in the next pass)
npm run dev
```
- Open http://localhost:3000 -> create account.
- Supabase Auth note: for a solo instance, either disable "Confirm email" (Studio -> Authentication -> Providers -> Email) or confirm via the link. Magic link needs SMTP configured; password sign-in does not.
- In the app: **Accounts -> Set up my workspace.** CHECK: 276 categories, 6 accounts appear.
- **Import** -> pick the matching account -> drop that statement's markdown -> CHECK: green "Reconciled" banner -> Commit. Re-commit the same file -> CHECK: "0 inserted" (idempotent).
- **Dashboard** -> CHECK: net worth, cash-flow bars, buckets render.

  (Seeding alternative to the in-app button: `supabase/seed/seed.sql`, set `\set USER_ID '<your auth uid>'` first. The button is simpler.)

## 4. Deploy to Vercel
- Vercel -> New Project -> import `vineeth-arch/wealth-os` (framework auto-detects Next.js).
- Project Settings -> Environment Variables (Production + Preview): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
- Deploy. CHECK: build succeeds; visiting the domain redirects to `/login`.
- Supabase Studio -> Authentication -> URL Configuration: set **Site URL** to `https://wealth-os-omega.vercel.app` and add it (plus `http://localhost:3000`) to **Redirect URLs**. Without this, magic-link/email callback breaks.
- CHECK: sign in on the deployed domain, bootstrap if a fresh user, import a statement, dashboard renders.

## 5. Known operational item
- **Free-tier Supabase pauses after ~1 week idle.** Monthly usage = asleep on arrival. The weekly keep-alive cron lands in the next sub-pass (Vercel cron pinging a lightweight route). Until then, the first request after a pause wakes it (a few seconds).

## Rollback
- App: Vercel -> Deployments -> promote the previous green deployment.
- Schema: migrations are forward-only here; for a bad migration, write a new corrective migration. Do not hand-edit prod tables.
