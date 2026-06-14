import { createSupabaseServer } from "@/lib/supabase/server";
import { LLM_PROVIDERS } from "@/lib/integrations";
import { IntegrationsPanel } from "@/components/integrations-panel";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const supabase = await createSupabaseServer();
  const [{ data: integrations }, { data: priceSources }] = await Promise.all([
    supabase.from("integrations").select("kind,provider,status,meta"),
    supabase.from("price_sources").select("id,display_name,kind,enabled").order("id"),
  ]);

  // Server-side env-var presence — a boolean only. The key value never leaves the server.
  const llm = LLM_PROVIDERS.map((p) => ({
    id: p.id, label: p.label, models: [...p.models], available: Boolean(process.env[p.envVar]),
  }));

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          AI provider and price-source connections. LLM keys live as server environment variables — they
          never reach the browser or the database; this page only records which provider is active.
        </p>
      </div>
      <IntegrationsPanel
        llm={llm}
        integrations={(integrations ?? []) as IntegrationRow[]}
        priceSources={(priceSources ?? []) as PriceSourceRow[]}
      />
    </div>
  );
}

export interface IntegrationRow {
  kind: string;
  provider: string;
  status: "connected" | "not_connected" | "error";
  meta: { model?: string; active?: boolean } | null;
}
export interface PriceSourceRow {
  id: string;
  display_name: string;
  kind: string;
  enabled: boolean;
}
