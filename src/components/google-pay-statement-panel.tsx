"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useBusy } from "@/components/busy-provider";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatINR, formatDate } from "@/lib/format";
import { Smartphone, FileUp, Loader2, ArrowLeftRight } from "lucide-react";

interface Recon {
  sentTotalPaise: number | null; receivedTotalPaise: number | null;
  parsedSentPaise: number; parsedReceivedPaise: number;
  sentDeltaPaise: number | null; receivedDeltaPaise: number | null; ok: boolean;
}
interface PreviewRow {
  txnId: string; merchant: string; mmLabel: string; bank: string;
  confidence: string; categoryApplied: string; categorySuggested: string; changed: boolean;
}
interface UnmatchedRow { txnDate: string; amountPaise: number; party: string; bank: string; }
interface GpayReport {
  mode: "preview" | "apply";
  parsed: number; matched: number; ambiguous: number; unmatched: number; applied: number;
  transferCount: number;
  reconciliation: Recon;
  byBank: Record<string, { matched: number; total: number }>;
  preview: PreviewRow[];
  unmatchedPreview: UnmatchedRow[];
  note?: string;
}

/**
 * Enrich committed bank/credit-card transactions from a Google Pay official "Transaction statement"
 * (.md). Upload → preview (reconciliation + per-bank match report) → confirm → apply. Enrichment only:
 * no transactions added, no amounts touched, `description_raw` immutable. Re-runnable and idempotent.
 */
export function GooglePayStatementPanel() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<GpayReport | null>(null);
  const [applied, setApplied] = useState(false);
  const { begin, end } = useBusy();
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  function pickFile(f: File | null) {
    setFile(f); setFileName(f?.name ?? ""); setReport(null); setApplied(false); setError(null);
  }

  async function run(mode: "preview" | "apply") {
    if (!file) { setError("Choose a Google Pay statement .md export."); return; }
    const id = begin(mode === "apply" ? "GPay enrich" : "GPay match");
    setBusy(true); setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("mode", mode);
      const res = await fetch("/api/enrich/google-pay-statement", { method: "POST", body: fd });
      const json = await res.json();
      if (!mounted.current) return;
      if (!res.ok) { setError(json.error ?? "enrich failed"); return; }
      setReport(json as GpayReport);
      if (mode === "apply") { setApplied(true); router.refresh(); }
    } catch (e) {
      if (mounted.current) setError((e as Error).message);
    } finally {
      if (mounted.current) setBusy(false);
      end(id);
    }
  }

  const changedCount = report ? report.preview.filter((p) => p.changed).length : 0;
  const r = report?.reconciliation;
  const delta = (d: number | null) => d === null ? "—" : d === 0 ? "exact" : formatINR(d, { sign: true });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Smartphone className="h-5 w-5" /> Enrich from Google Pay statement</CardTitle>
        <CardDescription>
          Match a Google Pay official <code>Transaction statement</code> (.md) to your imported
          transactions — routed by funding account (last-4) and the UPI Transaction ID where it appears
          in the bank narration, else by amount and date. Enrichment only; nothing is added to the ledger.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1 space-y-1.5">
            <label className="text-sm font-medium">Statement file (.md)</label>
            <label className="flex h-10 cursor-pointer items-center gap-2 rounded-md border border-dashed border-input px-3 text-sm text-muted-foreground hover:bg-accent">
              <FileUp className="h-4 w-4" />
              <span className="truncate">{fileName || "Choose a Google Pay statement .md export"}</span>
              <input type="file" accept=".md,.markdown,.txt,text/markdown" className="hidden"
                onChange={(e) => pickFile(e.target.files?.[0] ?? null)} />
            </label>
          </div>
          <Button onClick={() => run("preview")} disabled={busy || !file} variant="secondary">
            {busy && !applied ? <><Loader2 className="h-4 w-4 animate-spin" /> Matching…</> : "Scan & preview"}
          </Button>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        {report && (
          <div className="space-y-4">
            <div className="rounded-md border bg-muted/30 p-3 text-sm">
              <span className="font-medium">{report.parsed}</span> rows parsed ·{" "}
              <span className="font-medium text-income">{report.matched}</span> matched ·{" "}
              <span className="font-medium">{report.ambiguous}</span> ambiguous ·{" "}
              <span className="font-medium">{report.unmatched}</span> unmatched
              {report.mode === "apply" && <> · <span className="font-medium text-income">{report.applied}</span> written</>}
            </div>

            {report.note && <p className="text-sm text-muted-foreground">{report.note}</p>}

            {r && (
              <div className="rounded-md border p-3 text-sm">
                <div className="font-medium mb-1">Reconciliation vs statement totals</div>
                <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
                  <span>Sent: parsed {formatINR(r.parsedSentPaise)} vs stated {r.sentTotalPaise === null ? "—" : formatINR(r.sentTotalPaise)}</span>
                  <span className={r.sentDeltaPaise ? "text-destructive" : "text-income"}>Δ {delta(r.sentDeltaPaise)}</span>
                  <span>Received: parsed {formatINR(r.parsedReceivedPaise)} vs stated {r.receivedTotalPaise === null ? "—" : formatINR(r.receivedTotalPaise)}</span>
                  <span className={r.receivedDeltaPaise ? "text-destructive" : "text-income"}>Δ {delta(r.receivedDeltaPaise)}</span>
                </div>
              </div>
            )}

            {Object.keys(report.byBank).length > 0 && (
              <div className="rounded-md border p-3 text-sm">
                <div className="font-medium mb-1">Match coverage by funding account</div>
                <div className="flex flex-wrap gap-2 text-xs">
                  {Object.entries(report.byBank).sort((a, b) => b[1].total - a[1].total).map(([last4, c]) => (
                    <span key={last4} className="rounded-full border bg-muted/40 px-2.5 py-1">
                      …{last4}: <span className="font-medium">{c.matched}</span>/{c.total}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {report.transferCount > 0 && (
              <div className="flex items-start gap-2 rounded-md border bg-muted/20 p-3 text-sm">
                <ArrowLeftRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <span><span className="font-medium">{report.transferCount}</span> matched {report.transferCount === 1 ? "entry is a" : "entries are"} self / family-account transfer → mapped to a neutral parent-10 transfer (not income or spend).</span>
              </div>
            )}

            {report.preview.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium">{changedCount > 0 ? `${changedCount} change${changedCount === 1 ? "" : "s"} to apply` : "Already enriched — no changes"}</p>
                <div className="overflow-x-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Enriched merchant</TableHead>
                        <TableHead>Funding</TableHead>
                        <TableHead>Match</TableHead>
                        <TableHead>Category</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {report.preview.map((p) => (
                        <TableRow key={p.txnId} className={p.changed ? "" : "opacity-60"}>
                          <TableCell className="text-sm">{p.merchant || p.mmLabel || "—"}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{p.bank}</TableCell>
                          <TableCell className="text-xs">{p.confidence === "id" ? <Badge variant="secondary">UPI&nbsp;ID</Badge> : <span className="text-muted-foreground">amount</span>}</TableCell>
                          <TableCell className="text-xs">
                            {p.categoryApplied
                              ? <Badge variant="secondary">{p.categoryApplied}</Badge>
                              : p.categorySuggested
                                ? <span className="text-muted-foreground">suggests {p.categorySuggested}</span>
                                : <span className="text-muted-foreground">—</span>}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}

            {report.unmatchedPreview.length > 0 && (
              <details className="rounded-md border bg-muted/20 p-3 text-sm">
                <summary className="cursor-pointer font-medium">Unmatched Google Pay entries ({report.unmatched})</summary>
                <p className="mt-2 text-xs text-muted-foreground">
                  Didn&apos;t match an imported transaction — likely funded by an account you haven&apos;t imported
                  (e.g. Canara …8593), a timing gap, or cash-on-GPay. Importing these directly isn&apos;t supported.
                </p>
                <ul className="mt-2 space-y-1">
                  {report.unmatchedPreview.map((u, i) => (
                    <li key={i} className="flex justify-between gap-3 text-xs">
                      <span className="truncate text-muted-foreground">{formatDate(u.txnDate)} · {u.party} · {u.bank}</span>
                      <span className={u.amountPaise < 0 ? "" : "text-income"}>{formatINR(u.amountPaise, { sign: true })}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}

            {report.mode === "preview" && changedCount > 0 && (
              <Button onClick={() => run("apply")} disabled={busy}>
                {busy ? <><Loader2 className="h-4 w-4 animate-spin" /> Applying…</> : `Apply enrichment to ${changedCount} transaction${changedCount === 1 ? "" : "s"}`}
              </Button>
            )}
            {applied && <p className="text-sm text-income">Enrichment applied. Re-running is safe — it won&apos;t duplicate.</p>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
