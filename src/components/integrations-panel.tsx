"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { IntegrationStatus } from "@/lib/integrations";
import type { IntegrationRow, PriceSourceRow } from "@/app/(app)/settings/page";
import { Bot, LineChart } from "lucide-react";

interface LlmDisplay { id: string; label: string; models: string[]; available: boolean }

function StatusBadge({ status }: { status: IntegrationStatus }) {
  if (status === "connected") return <Badge variant="success">connected</Badge>;
  if (status === "error") return <Badge variant="destructive">error</Badge>;
  return <Badge variant="secondary">not connected</Badge>;
}

export function IntegrationsPanel({ llm, integrations, priceSources }: {
  llm: LlmDisplay[];
  integrations: IntegrationRow[];
  priceSources: PriceSourceRow[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const llmRow = (id: string) => integrations.find((r) => r.kind === "llm" && r.provider === id);
  const activeLlm = integrations.find((r) => r.kind === "llm" && r.meta?.active);
  const psRow = (id: string) => integrations.find((r) => r.kind === "price_source" && r.provider === id);

  async function post(body: unknown, key: string) {
    setBusy(key); setError(null);
    const res = await fetch("/api/integrations", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) { setError(json.error ?? "request failed"); return; }
    router.refresh();
  }
  async function disconnect(kind: string, provider: string, key: string) {
    setBusy(key); setError(null);
    const res = await fetch("/api/integrations", {
      method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, provider }),
    });
    const json = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) { setError(json.error ?? "request failed"); return; }
    router.refresh();
  }

  return (
    <div className="space-y-6">
      {error && <p className="text-sm text-destructive">{error}</p>}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Bot className="h-5 w-5" /> AI provider</CardTitle>
          <CardDescription>
            Status reflects whether the provider&apos;s key is set on the server. Pick the active provider and
            model used for description cleanup &amp; category suggestions (no money values are ever sent to an LLM).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {llm.map((p) => {
            const row = llmRow(p.id);
            const status: IntegrationStatus = p.available ? "connected" : "not_connected";
            const isActive = activeLlm?.provider === p.id;
            const model = row?.meta?.model ?? p.models[0];
            return (
              <div key={p.id} className="flex flex-wrap items-center justify-between gap-3 border-b py-2 last:border-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{p.label}</span>
                  <StatusBadge status={status} />
                  {isActive && <Badge>active</Badge>}
                </div>
                <div className="flex items-center gap-2">
                  <select
                    className="h-9 rounded-md border border-input bg-background px-2 text-sm disabled:opacity-50"
                    value={model}
                    disabled={!p.available || busy !== null}
                    onChange={(e) => post({ kind: "llm", provider: p.id, model: e.target.value, active: isActive }, `m-${p.id}`)}
                  >
                    {p.models.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                  {isActive ? (
                    <Button variant="outline" size="sm" disabled={busy !== null}
                      onClick={() => disconnect("llm", p.id, `d-${p.id}`)}>Deactivate</Button>
                  ) : (
                    <Button size="sm" disabled={!p.available || busy !== null}
                      onClick={() => post({ kind: "llm", provider: p.id, model, active: true }, `a-${p.id}`)}>
                      {busy === `a-${p.id}` ? "…" : "Set active"}
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
          {!llm.some((p) => p.available) && (
            <p className="text-xs text-muted-foreground">
              No provider key detected. Set e.g. <code>ANTHROPIC_API_KEY</code> in the server environment to connect.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><LineChart className="h-5 w-5" /> Price sources</CardTitle>
          <CardDescription>Keyless market-data sources for NAV/equity/gold price refresh.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {priceSources.map((ps) => {
            const row = psRow(ps.id);
            const status: IntegrationStatus = row?.status ?? "not_connected";
            const connected = status === "connected";
            return (
              <div key={ps.id} className="flex flex-wrap items-center justify-between gap-3 border-b py-2 last:border-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{ps.display_name}</span>
                  <Badge variant="outline" className="text-[10px]">{ps.kind}</Badge>
                  <StatusBadge status={status} />
                </div>
                {connected ? (
                  <Button variant="outline" size="sm" disabled={busy !== null}
                    onClick={() => disconnect("price_source", ps.id, `d-${ps.id}`)}>Disconnect</Button>
                ) : (
                  <Button size="sm" disabled={busy !== null}
                    onClick={() => post({ kind: "price_source", provider: ps.id, status: "connected" }, `c-${ps.id}`)}>
                    {busy === `c-${ps.id}` ? "…" : "Connect"}
                  </Button>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
