"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { formatINR, formatDate } from "@/lib/format";
import type { HoldingView } from "@/app/(app)/holdings/page";
import { CheckCircle2, AlertTriangle, FileUp, Loader2 } from "lucide-react";

type Account = { id: string; name: string };
interface HoldingRow { symbol: string; isin: string; assetClass: string; sectorOrType: string; qty: number; avgPricePaise: number | null; lastPricePaise: number }
interface Snapshot { asOf: string | null; rows: HoldingRow[]; investedPaise: number | null; presentPaise: number | null; reconciliationOk: boolean; warnings: string[] }

export function HoldingsPanel({ accounts, holdings }: { accounts: Account[]; holdings: HoldingView[] }) {
  const router = useRouter();
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Snapshot | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function parse() {
    if (!file || !accountId) { setError("Pick the Zerodha account and a file."); return; }
    setBusy(true); setError(null); setDone(null); setPreview(null);
    const fd = new FormData(); fd.append("file", file); fd.append("accountId", accountId);
    const res = await fetch("/api/holdings/import", { method: "POST", body: fd });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setError(json.error ?? "import failed"); return; }
    setPreview(json.snapshot as Snapshot);
  }

  async function commit() {
    if (!preview) return;
    setBusy(true); setError(null);
    const res = await fetch("/api/holdings/commit", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountId, asOf: preview.asOf, rows: preview.rows }),
    });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setError(json.error ?? "commit failed"); return; }
    setDone(`${json.upserted} holding(s) saved as of ${json.asOf}${json.unmapped?.length ? ` · ${json.unmapped.length} need a price mapping` : ""}.`);
    setPreview(null);
    router.refresh();
  }

  const unmapped = holdings.filter((h) =>
    h.assetClass === "mutual_fund" ? !h.amfiSchemeCode : !h.yahooSymbol);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle>Import Zerodha holdings</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Account</label>
              <Select value={accountId} onValueChange={setAccountId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Holdings workbook (.xlsx)</label>
              <label className="flex h-10 cursor-pointer items-center gap-2 rounded-md border border-dashed border-input px-3 text-sm text-muted-foreground hover:bg-accent">
                <FileUp className="h-4 w-4" />
                <span className="truncate">{fileName || "Choose an .xlsx file"}</span>
                <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0] ?? null; setFile(f); setFileName(f?.name ?? ""); }} />
              </label>
            </div>
          </div>
          <Button onClick={parse} disabled={busy || !file}>
            {busy ? <><Loader2 className="h-4 w-4 animate-spin" /> Parsing…</> : "Parse & reconcile"}
          </Button>
          {error && <p className="text-sm text-destructive">{error}</p>}
          {done && <p className="flex items-center gap-2 text-sm text-income"><CheckCircle2 className="h-4 w-4" />{done}</p>}
        </CardContent>
      </Card>

      {preview && (
        <Card>
          <CardHeader className="space-y-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Preview · {preview.rows.length} holdings · as of {preview.asOf ? formatDate(preview.asOf) : "unknown"}</CardTitle>
              <Badge variant={preview.reconciliationOk ? "success" : "destructive"}>{preview.reconciliationOk ? "reconciled" : "check"}</Badge>
            </div>
            <CardDescription>
              {preview.investedPaise !== null && <>invested {formatINR(preview.investedPaise)} · </>}
              {preview.presentPaise !== null && <>present {formatINR(preview.presentPaise)}</>}
            </CardDescription>
            {preview.warnings.map((w, i) => <div key={i} className="flex items-center gap-2 text-xs text-muted-foreground"><AlertTriangle className="h-3 w-3" />{w}</div>)}
          </CardHeader>
          <CardContent className="space-y-3">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Instrument</TableHead><TableHead>ISIN</TableHead>
                <TableHead className="text-right">Qty</TableHead><TableHead className="text-right">Avg</TableHead><TableHead className="text-right">Last</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {preview.rows.map((r) => (
                  <TableRow key={r.isin}>
                    <TableCell className="text-xs"><span className="font-medium">{r.symbol}</span> <Badge variant="outline" className="ml-1 text-[10px]">{r.assetClass}</Badge></TableCell>
                    <TableCell className="text-xs text-muted-foreground">{r.isin}</TableCell>
                    <TableCell className="text-right text-xs">{r.qty}</TableCell>
                    <TableCell className="text-right text-xs">{r.avgPricePaise === null ? "—" : formatINR(r.avgPricePaise)}</TableCell>
                    <TableCell className="text-right text-xs">{formatINR(r.lastPricePaise)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Button onClick={commit} disabled={busy}>{busy ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving…</> : "Commit snapshot"}</Button>
          </CardContent>
        </Card>
      )}

      {holdings.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Current holdings</CardTitle>
            <CardDescription>Latest snapshot per account.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow>
                <TableHead>Instrument</TableHead><TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Last</TableHead><TableHead className="text-right">Value</TableHead><TableHead>Price map</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {holdings.map((h) => {
                  const mapped = h.assetClass === "mutual_fund" ? h.amfiSchemeCode : h.yahooSymbol;
                  return (
                    <TableRow key={h.isin}>
                      <TableCell className="text-xs"><span className="font-medium">{h.symbol || h.name}</span> <Badge variant="outline" className="ml-1 text-[10px]">{h.assetClass}</Badge></TableCell>
                      <TableCell className="text-right text-xs">{h.qty}</TableCell>
                      <TableCell className="text-right text-xs">{formatINR(h.lastPricePaise)}</TableCell>
                      <TableCell className="text-right text-xs font-medium">{formatINR(Math.round(h.qty * h.lastPricePaise))}</TableCell>
                      <TableCell>{mapped ? <Badge variant="success" className="text-[10px]">{mapped}</Badge> : <Badge variant="secondary" className="text-[10px]">unmapped</Badge>}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {unmapped.length > 0 && <MappingForm rows={unmapped} onSaved={() => router.refresh()} />}
    </div>
  );
}

function MappingForm({ rows, onSaved }: { rows: HoldingView[]; onSaved: () => void }) {
  const [vals, setVals] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save(h: HoldingView) {
    const v = (vals[h.isin] ?? "").trim();
    if (!v) return;
    setBusy(h.isin); setError(null);
    const body = h.assetClass === "mutual_fund" ? { isin: h.isin, amfiSchemeCode: v } : { isin: h.isin, yahooSymbol: v };
    const res = await fetch("/api/holdings/map", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const json = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) { setError(json.error ?? "save failed"); return; }
    onSaved();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base"><AlertTriangle className="h-4 w-4 text-leakage" /> Confirm price mappings</CardTitle>
        <CardDescription>Couldn&apos;t auto-resolve these. MF → AMFI scheme code; equity/SGB → Yahoo symbol (e.g. <code>TCS.NS</code>).</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && <p className="text-sm text-destructive">{error}</p>}
        {rows.map((h) => (
          <div key={h.isin} className="flex flex-wrap items-center gap-2 border-b py-2 last:border-0">
            <span className="min-w-[10rem] text-sm font-medium">{h.symbol || h.name}</span>
            <span className="text-xs text-muted-foreground">{h.isin}</span>
            <Input
              className={cn("h-8 max-w-[12rem] text-xs")}
              placeholder={h.assetClass === "mutual_fund" ? "AMFI scheme code" : "Yahoo symbol"}
              value={vals[h.isin] ?? ""}
              onChange={(e) => setVals((s) => ({ ...s, [h.isin]: e.target.value }))}
            />
            <Button size="sm" disabled={busy !== null} onClick={() => save(h)}>{busy === h.isin ? "…" : "Save"}</Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
