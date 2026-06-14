import { createSupabaseServer } from "@/lib/supabase/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { UpstoxPanel } from "@/components/upstox-panel";

export const dynamic = "force-dynamic";

export default async function UpstoxPage() {
  const supabase = await createSupabaseServer();
  const { data: accountsRaw } = await supabase.from("accounts")
    .select("id,name").eq("institution", "UPSTOX").order("name");
  const accounts = (accountsRaw ?? []).map((a) => ({ id: a.id as string, name: a.name as string }));

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Upstox</h1>
        <p className="text-sm text-muted-foreground">
          Import Upstox dividend and tax (realized capital-gains) reports. Dividends post as income
          transactions; the tax report is stored as a realized-gains record for the tax view.
          Holdings live on the <span className="font-medium">Holdings</span> page.
        </p>
      </div>

      {accounts.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No Upstox account</CardTitle>
            <CardDescription>Set up your workspace first — it creates the Upstox account these reports import into.</CardDescription>
          </CardHeader>
          <CardContent />
        </Card>
      ) : (
        <UpstoxPanel accounts={accounts} />
      )}
    </div>
  );
}
