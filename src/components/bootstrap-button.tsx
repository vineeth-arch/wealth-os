"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Sparkles } from "lucide-react";

export function BootstrapButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  async function run() {
    setBusy(true); setMsg(null);
    const res = await fetch("/api/bootstrap", { method: "POST" });
    const json = await res.json();
    setBusy(false);
    if (!res.ok) { setMsg(json.error ?? "failed"); return; }
    router.refresh();
  }
  return (
    <div className="space-y-2">
      <Button onClick={run} disabled={busy}><Sparkles className="h-4 w-4" />{busy ? "Setting up…" : "Set up my workspace"}</Button>
      {msg && <p className="text-sm text-destructive">{msg}</p>}
    </div>
  );
}
