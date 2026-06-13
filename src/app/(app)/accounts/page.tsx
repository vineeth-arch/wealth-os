import { createSupabaseServer } from "@/lib/supabase/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BootstrapButton } from "@/components/bootstrap-button";
import { formatINR, formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function AccountsPage() {
  const supabase = await createSupabaseServer();
  const { data: accounts } = await supabase.from("accounts")
    .select("id,name,institution,kind,anchor_balance_paise,anchor_date").order("name");
  const { count: catCount } = await supabase.from("categories").select("id", { count: "exact", head: true });

  const seeded = (catCount ?? 0) > 0 && (accounts?.length ?? 0) > 0;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Accounts</h1>
        <p className="text-sm text-muted-foreground">Your taxonomy ({catCount ?? 0} categories) and the accounts the converter emits to.</p>
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

      <div className="grid gap-3 sm:grid-cols-2">
        {(accounts ?? []).map((a) => (
          <Card key={a.id}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">{a.name}</CardTitle>
                <Badge variant="secondary">{a.kind.replace("_", " ")}</Badge>
              </div>
              <CardDescription>{a.institution}</CardDescription>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              {a.anchor_balance_paise !== null
                ? <>Anchor {formatINR(a.anchor_balance_paise)} · {a.anchor_date ? formatDate(a.anchor_date) : "—"}</>
                : <>No anchor yet — set on first statement import.</>}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
