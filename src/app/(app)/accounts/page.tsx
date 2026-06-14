import { createSupabaseServer } from "@/lib/supabase/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BootstrapButton } from "@/components/bootstrap-button";
import { AccountsPanel, type AccountRow, type AccountFlowMap } from "@/components/accounts-panel";
import { MonthSelect } from "@/components/month-select";
import { loadDrillData } from "@/lib/server/load-drill";
import { accountPeriodFlow } from "@/lib/drilldown";

export const dynamic = "force-dynamic";

export default async function AccountsPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const supabase = await createSupabaseServer();
  const { data: accounts } = await supabase.from("accounts")
    .select("id,name,institution,kind,anchor_balance_paise,anchor_date,account_holder_name,account_number,ifsc,branch,account_type,upi_id")
    .order("name");
  const { count: catCount } = await supabase.from("categories").select("id", { count: "exact", head: true });

  // Each account's contribution to the dashboard for the selected month (inverse of the Pass 2 split).
  const { drillTxns, months } = await loadDrillData();
  const sp = await searchParams;
  const month = sp.month && months.includes(sp.month) ? sp.month : (months[months.length - 1] ?? "");
  const flowMap = accountPeriodFlow(drillTxns, month);
  const flows: AccountFlowMap = {};
  for (const [id, f] of flowMap) flows[id] = { inflowPaise: f.inflowPaise, outflowPaise: f.outflowPaise, count: f.count };

  const seeded = (catCount ?? 0) > 0 && (accounts?.length ?? 0) > 0;
  const rows: AccountRow[] = (accounts ?? []).map((a) => ({
    id: a.id as string,
    name: a.name as string,
    institution: a.institution as string,
    kind: a.kind as string,
    anchorBalancePaise: a.anchor_balance_paise as number | null,
    anchorDate: a.anchor_date as string | null,
    accountHolderName: (a.account_holder_name as string | null) ?? "",
    accountNumber: (a.account_number as string | null) ?? "",
    ifsc: (a.ifsc as string | null) ?? "",
    branch: (a.branch as string | null) ?? "",
    accountType: (a.account_type as string | null) ?? "",
    upiId: (a.upi_id as string | null) ?? "",
  }));

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Accounts</h1>
          <p className="text-sm text-muted-foreground">
            Your taxonomy ({catCount ?? 0} categories) and the accounts the converter emits to. Each card
            shows its inflow/outflow for the month and a copy-pastable block to share when receiving money.
          </p>
        </div>
        <MonthSelect months={months} value={month} />
      </div>

      {!seeded && (
        <Card>
          <CardHeader>
            <CardTitle>Set up your workspace</CardTitle>
            <CardDescription>Seeds the Monika Halan taxonomy (276 categories), the vendor rules, and your six canonical accounts. Idempotent — safe to run once.</CardDescription>
          </CardHeader>
          <CardContent><BootstrapButton /></CardContent>
        </Card>
      )}

      <AccountsPanel accounts={rows} flows={flows} month={month} />
    </div>
  );
}
