"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useBusy } from "@/components/busy-provider";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatINR, formatDate } from "@/lib/format";
import { FileSpreadsheet, FileUp, Loader2, AlertTriangle } from "lucide-react";

interface PreviewRow {
  txnId: string;
  description: string;
  currentMerchant: string;
  newMerchant: string;
  mmLabel: string;
  categoryApplied: string;
  categorySuggested: string;
  changed: boolean;
}
interface UnmatchedRow { loggedAt: string; amountPaise: number; category: string; label: string; }
interface MmReport {
  mode: "preview" | "apply";
  parsed: number;
  matched: number;
  ambiguous: number;
  unmatched: number;
  applied: number;
  sipFlagged: number;
  preview: PreviewRow[];
  unmatchedPreview: UnmatchedRow[];
  note?: string;
}

/**
 * Enrich committed bank/credit-card transactions from a Money Manager (.xlsx) export. Upload → preview
 * the match report → confirm → apply. Enrichment only: no transactions added, no amounts touched,
 * `description_raw` immutable. Re-runnable and idempotent.
 */
export function MoneyManagerPanel() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<MmReport | null>(null);
  const [applied, setApplied] = useState(false);
  const { begin, end } = useBusy();
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  function pickFile(f: File | null) {
    setFile(f); setFileName(f?.name ?? ""); setReport(null); setApplied(false); setError(null);
  }

  async function run(mode: "preview" | "apply") {
    if (!file) { setError("Choose a Money Manager .xlsx export."); return; }
    const id = begin(mode === "apply" ? "MM enrich" : "MM match");
    setBusy(true); setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("mode", mode);
      const res = await fetch("/api/enrich/money-manager", { method: "POST", body: fd });
      const json = await res.json();
      if (!mounted.current) return;
      if (!res.ok) { setError(json.error ?? "enrich failed"); return; }
      setReport(json as MmReport);
      if (mode === "apply") { setApplied(true); router.refresh(); }
    } catch (e) {
      if (mounted.current) setError((e as Error).message);
    } finally {
      if (mounted.current) setBusy(false);
      end(id);
    }
  }

  const changedCount = report ? report.preview.filter((p) => p.changed).length : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><FileSpreadsheet className="h-5 w-5" /> Enrich from Money Manager</CardTitle>
        <CardDescription>
          Match a Money Manager <code>.xlsx</code> export to your imported transactions by date and amount,
          then attach her richer merchant note and (where the row is still uncategorized) the mapped
          category. Enrichment only — nothing is added to the ledger and no amounts change.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1 space-y-1.5">
            <label className="text-sm font-medium">Export file (.xlsx)</label>
            <label className="flex h-10 cursor-pointer items-center gap-2 rounded-md border border-dashed border-input px-3 text-sm text-muted-foreground hover:bg-accent">
              <FileUp className="h-4 w-4" />
              <span className="truncate">{fileName || "Choose a Money Manager .xlsx export"}</span>
              <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden"
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

            {report.sipFlagged > 0 && (
              <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                <span>
                  <span className="font-medium">{report.sipFlagged}</span> matched {report.sipFlagged === 1 ? "entry maps" : "entries map"} to
                  {" "}<span className="font-medium">SIP Mutual Fund</span> (Invest-it). Verify these aren&apos;t also counted via a
                  broker/holdings import, or the invest outflow double-counts.
                </span>
              </div>
            )}

            {report.preview.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium">{changedCount > 0 ? `${changedCount} change${changedCount === 1 ? "" : "s"} to apply` : "Already enriched — no changes"}</p>
                <div className="overflow-x-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Transaction</TableHead>
                        <TableHead>Enriched merchant</TableHead>
                        <TableHead>Category</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {report.preview.map((p) => (
                        <TableRow key={p.txnId} className={p.changed ? "" : "opacity-60"}>
                          <TableCell className="max-w-[18rem] truncate text-xs text-muted-foreground" title={p.description}>{p.description || "—"}</TableCell>
                          <TableCell className="text-sm">{p.newMerchant || p.mmLabel || "—"}</TableCell>
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
                <summary className="cursor-pointer font-medium">Unmatched Money Manager entries ({report.unmatched})</summary>
                <p className="mt-2 text-xs text-muted-foreground">
                  Didn&apos;t match an imported transaction — likely cash, a timing gap, or an account you haven&apos;t imported.
                  Importing these as cash is not supported yet.
                </p>
                <ul className="mt-2 space-y-1">
                  {report.unmatchedPreview.map((u, i) => (
                    <li key={i} className="flex justify-between gap-3 text-xs">
                      <span className="truncate text-muted-foreground">{formatDate(u.loggedAt)} · {u.category} · {u.label || "—"}</span>
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
