import Link from "next/link";
import { createSupabaseServer } from "@/lib/supabase/server";
import { ImportWizard } from "@/components/import-wizard";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

export default async function ImportPage() {
  const supabase = await createSupabaseServer();
  const { data: accounts } = await supabase.from("accounts")
    .select("id,name,institution,kind").order("name");
  const { data: cats } = await supabase.from("categories").select("id,name,parent_id");

  const byId = new Map((cats ?? []).map((c) => [c.id as string, c.name as string]));
  const categories = (cats ?? []).map((c) => ({
    name: c.name as string,
    parent: c.parent_id ? byId.get(c.parent_id as string) ?? null : null,
  }));

  if (!accounts || accounts.length === 0) {
    return (
      <div className="mx-auto max-w-2xl">
        <Card>
          <CardHeader>
            <CardTitle>Set up your workspace first</CardTitle>
            <CardDescription>You need accounts and the taxonomy before importing.</CardDescription>
          </CardHeader>
          <CardContent><Button asChild><Link href="/accounts">Go to Accounts</Link></Button></CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Import</h1>
        <p className="text-sm text-muted-foreground">
          Drop a markdown statement. It is parsed and reconciled server-side; categorize, then commit. Re-importing the same period is a no-op.
        </p>
      </div>
      <ImportWizard accounts={accounts} categories={categories} />
    </div>
  );
}
