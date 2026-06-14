import { createSupabaseServer } from "@/lib/supabase/server";
import { SEED_CATEGORIES } from "@/lib/seed-data";
import { LoansPanel, type LoanRecord, type AccountOption } from "@/components/loans-panel";

export const dynamic = "force-dynamic";

export default async function LoansPage() {
  const supabase = await createSupabaseServer();
  const { data: loansRaw } = await supabase.from("loans")
    .select("id,name,kind,principal_paise,annual_rate_pct,tenure_months,start_date,account_id,emi_category")
    .order("created_at", { ascending: true });
  const { data: accountsRaw } = await supabase.from("accounts").select("id,name").order("name");

  const loans: LoanRecord[] = (loansRaw ?? []).map((l) => ({
    id: l.id as string,
    name: l.name as string,
    kind: l.kind as string,
    principalPaise: Number(l.principal_paise),
    annualRatePct: Number(l.annual_rate_pct),
    tenureMonths: l.tenure_months as number,
    startDate: l.start_date as string,
    accountId: (l.account_id as string | null) ?? null,
    emiCategory: (l.emi_category as string | null) ?? null,
  }));
  const accounts: AccountOption[] = (accountsRaw ?? []).map((a) => ({ id: a.id as string, name: a.name as string }));
  // EMI taxonomy leaves under parent "05 Debt & Credit" — informational reference only.
  const emiCategories = SEED_CATEGORIES
    .filter((c) => c.parent === "05 Debt & Credit" && c.name.includes("EMI"))
    .map((c) => c.name)
    .sort();

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Loans</h1>
        <p className="text-sm text-muted-foreground">
          Track loans, see the reducing-balance amortization schedule, and model a prepayment what-if.
          Balances are entered manually — they are not pulled from statements.
        </p>
      </div>
      <LoansPanel loans={loans} accounts={accounts} emiCategories={emiCategories} />
    </div>
  );
}
