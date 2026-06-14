import { createSupabaseServer } from "@/lib/supabase/server";
import { SEED_CATEGORIES } from "@/lib/seed-data";
import { LoansPanel, type LoanRecord, type AccountOption, type ImportedScheduleRow } from "@/components/loans-panel";

export const dynamic = "force-dynamic";

export default async function LoansPage() {
  const supabase = await createSupabaseServer();
  const { data: loansRaw } = await supabase.from("loans")
    .select("id,name,kind,principal_paise,annual_rate_pct,tenure_months,start_date,account_id,emi_category,source")
    .order("created_at", { ascending: true });
  const { data: accountsRaw } = await supabase.from("accounts").select("id,name").order("name");
  // Stored actual rows for imported loans — their irregular installments are the source of truth.
  const { data: scheduleRaw } = await supabase.from("loan_schedule_rows")
    .select("loan_id,instl_no,due_date,instl_paise,principal_paise,interest_paise,os_principal_paise")
    .order("instl_no", { ascending: true });

  const scheduleByLoan = new Map<string, ImportedScheduleRow[]>();
  for (const r of scheduleRaw ?? []) {
    const list = scheduleByLoan.get(r.loan_id as string) ?? [];
    list.push({
      instlNo: r.instl_no as number,
      dueDate: r.due_date as string,
      instlPaise: Number(r.instl_paise),
      principalPaise: Number(r.principal_paise),
      interestPaise: Number(r.interest_paise),
      osPrincipalPaise: Number(r.os_principal_paise),
    });
    scheduleByLoan.set(r.loan_id as string, list);
  }

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
    source: ((l.source as string | null) ?? "computed") as "computed" | "imported",
    scheduleRows: scheduleByLoan.get(l.id as string) ?? [],
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
