"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useBusy } from "@/components/busy-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Sparkles, FileUp, Loader2 } from "lucide-react";

type Source = "bhim" | "gpay";
interface EnrichResult { parsed: number; matched: number; ambiguous: number; unmatched: number; }

/** Enrich committed transactions with the real counterpart name from a UPI-app export. */
export function EnrichPanel() {
  const router = useRouter();
  const [source, setSource] = useState<Source>("bhim");
  const [file, setFile] = useState<File | null>(null);
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<EnrichResult | null>(null);
  const { begin, end } = useBusy();
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const accept = source === "gpay" ? ".md,.markdown,.txt,text/markdown" : ".html,.htm,text/html";
  const filePrompt = source === "gpay" ? "Choose a Google Pay .md export" : "Choose a BHIM .html export";

  async function upload() {
    if (!file) { setError("Choose a UPI export file."); return; }
    const id = begin("UPI enrich");
    setBusy(true); setError(null); setResult(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("source", source);
      const res = await fetch("/api/enrich", { method: "POST", body: fd });
      const json = await res.json();
      if (!mounted.current) return; // enrichment ran server-side; UI gone — skip the update
      if (!res.ok) { setError(json.error ?? "enrich failed"); return; }
      setResult(json as EnrichResult);
      router.refresh();
    } catch (e) {
      if (mounted.current) setError((e as Error).message);
    } finally {
      if (mounted.current) setBusy(false);
      end(id);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Sparkles className="h-5 w-5" /> Enrich from UPI export</CardTitle>
        <CardDescription>
          Attach the real counterpart name from a UPI-app export to matching bank transactions, by date
          and amount. Enrichment only — no transactions are added, no amounts change.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Source</label>
            <select value={source} onChange={(e) => { setSource(e.target.value as Source); setFile(null); setFileName(""); setResult(null); }}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring">
              <option value="bhim">BHIM UPI</option>
              <option value="gpay">Google Pay</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Export file ({source === "gpay" ? ".md" : ".html"})</label>
            <label className="flex h-10 cursor-pointer items-center gap-2 rounded-md border border-dashed border-input px-3 text-sm text-muted-foreground hover:bg-accent">
              <FileUp className="h-4 w-4" />
              <span className="truncate">{fileName || filePrompt}</span>
              <input type="file" accept={accept} className="hidden"
                onChange={(e) => { const f = e.target.files?.[0] ?? null; setFile(f); setFileName(f?.name ?? ""); }} />
            </label>
          </div>
        </div>
        <Button onClick={upload} disabled={busy || !file}>
          {busy ? <><Loader2 className="h-4 w-4 animate-spin" /> Matching…</> : "Upload & enrich"}
        </Button>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {result && (
          <div className="rounded-md border bg-muted/30 p-3 text-sm">
            <span className="font-medium">{result.parsed}</span> rows parsed ·{" "}
            <span className="font-medium text-income">{result.matched}</span> matched ·{" "}
            <span className="font-medium">{result.ambiguous}</span> ambiguous ·{" "}
            <span className="font-medium">{result.unmatched}</span> unmatched
          </div>
        )}
      </CardContent>
    </Card>
  );
}
