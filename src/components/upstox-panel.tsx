"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatINR, formatDate } from "@/lib/format";
import { CheckCircle2, AlertTriangle, FileUp, Loader2 } from "lucide-react";

type Account = { id: string; name: string };

interface DivRow { txnDate: string; amountPaise: number; descriptionRaw: string; refNo: string | null; categoryName: string }
interface TaxLot { segment: string; scrip: string; isin: string; qty: number; buyDate: string; sellDate: string; totalPlPaise: number; shortTermPaise: number; longTermPaise: number }
interface TaxSegment { segment: string; grossPlPaise: number; netPlPaise: number; chargesPaise: number; shortTermPaise: number; longTermPaise: number; speculationPaise: number; lots: TaxLot[] }
interface TaxReport { financialYear: string; segments: TaxSegment[]; reconciliationOk: boolean; warnings: string[] }
interface TaxPreview { accountId: string; fileName: string; report: TaxReport }
interface DivPreview {
  accountId: string; fileName: string; totalDividendPaise: number; reconciliationOk: boolean;
  warnings: string[]; periodStart: string | null; periodEnd: string | null;
  rows: Array<DivRow & { balanceAfterPaise: null; nativeType: string; subAccount: null; tags: string[] }>;
}

export function UpstoxPanel({ accounts }: { accounts: Account[] }) {
  return (
    <div className="space-y-6">
      <DividendCard accounts={accounts} />
      <TaxReportCard accounts={accounts} />
    </div>
  );
}

function DividendCard({ accounts }: { accounts: Account[] }) {
  const router = useRouter();
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<DivPreview | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function parse() {
    if (!file || !accountId) { setError("Pick the Upstox account and a dividend file."); return; }
    setBusy(true); setError(null); setDone(null); setPreview(null);
    const fd = new FormData(); fd.append("file", file); fd.append("accountId", accountId);
    const res = await fetch("/api/upstox/dividends/import", { method: "POST", body: fd });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setError(json.error ?? "import failed"); return; }
    setPreview(json as DivPreview);
  }

  async function commit() {
    if (!preview) return;
    setBusy(true); setError(null);
    const res = await fetch("/api/commit", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accountId,
        statements: [{
          periodStart: preview.periodStart, periodEnd: preview.periodEnd,
          openingPaise: null, closingPaise: null,
          expectedDeltaPaise: preview.totalDividendPaise,
          fileName: preview.fileName, institution: "UPSTOX",
          rows: preview.rows,
        }],
      }),
    });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setError(json.error ?? "commit failed"); return; }
    setDone(`${json.inserted} dividend(s) saved · ${json.duplicate} duplicate(s) skipped.`);
    setPreview(null);
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Import Upstox dividends</CardTitle>
          <CardDescription>Each event posts as a <span className="font-medium">Dividend Income</span> inflow. Re-importing is idempotent.</CardDescription>
        </CardHeader>
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
              <label className="text-sm font-medium">Dividend report (.xlsx)</label>
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
              <CardTitle className="text-base">Preview · {preview.rows.length} dividends · total {formatINR(preview.totalDividendPaise)}</CardTitle>
              <Badge variant={preview.reconciliationOk ? "success" : "destructive"}>{preview.reconciliationOk ? "reconciled" : "check"}</Badge>
            </div>
            {preview.warnings.map((w, i) => <div key={i} className="flex items-center gap-2 text-xs text-muted-foreground"><AlertTriangle className="h-3 w-3" />{w}</div>)}
          </CardHeader>
          <CardContent className="space-y-3">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Date</TableHead><TableHead>Description</TableHead><TableHead className="text-right">Amount</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {preview.rows.map((r, i) => (
                  <TableRow key={`${r.refNo}-${r.txnDate}-${i}`}>
                    <TableCell className="text-xs">{formatDate(r.txnDate)}</TableCell>
                    <TableCell className="text-xs">{r.descriptionRaw}</TableCell>
                    <TableCell className="text-right text-xs font-medium text-income">{formatINR(r.amountPaise)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Button onClick={commit} disabled={busy}>{busy ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving…</> : "Commit dividends"}</Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function TaxReportCard({ accounts }: { accounts: Account[] }) {
  const router = useRouter();
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<TaxPreview | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function parse() {
    if (!file || !accountId) { setError("Pick the Upstox account and a tax report file."); return; }
    setBusy(true); setError(null); setDone(null); setPreview(null);
    const fd = new FormData(); fd.append("file", file); fd.append("accountId", accountId);
    const res = await fetch("/api/upstox/tax/import", { method: "POST", body: fd });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setError(json.error ?? "import failed"); return; }
    setPreview(json as TaxPreview);
  }

  async function commit() {
    if (!preview) return;
    setBusy(true); setError(null);
    const res = await fetch("/api/upstox/tax/commit", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountId, report: preview.report }),
    });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setError(json.error ?? "commit failed"); return; }
    setDone(`FY ${json.financialYear}: ${json.segments} segment(s), ${json.lots} closed lot(s) saved.`);
    setPreview(null);
    router.refresh();
  }

  const populated = preview?.report.segments.filter((s) => s.lots.length > 0) ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Import Upstox tax report (realized gains)</CardTitle>
        <CardDescription>Per-segment realized P&amp;L, charges, and closed (matched buy↔sell) lots with the ST/LT split. Stored for the capital-gains / tax view.</CardDescription>
      </CardHeader>
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
            <label className="text-sm font-medium">Tax report (.xlsx)</label>
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

        {preview && (
          <div className="space-y-3 rounded-md border p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">FY {preview.report.financialYear} · realized gains</span>
              <Badge variant={preview.report.reconciliationOk ? "success" : "destructive"}>{preview.report.reconciliationOk ? "reconciled" : "check"}</Badge>
            </div>
            {preview.report.warnings.map((w, i) => <div key={i} className="flex items-center gap-2 text-xs text-muted-foreground"><AlertTriangle className="h-3 w-3" />{w}</div>)}
            <Table>
              <TableHeader><TableRow>
                <TableHead>Segment</TableHead><TableHead className="text-right">Lots</TableHead>
                <TableHead className="text-right">Gross</TableHead><TableHead className="text-right">Charges</TableHead>
                <TableHead className="text-right">Net</TableHead><TableHead className="text-right">ST / LT</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {populated.map((s) => (
                  <TableRow key={s.segment}>
                    <TableCell className="text-xs capitalize">{s.segment}</TableCell>
                    <TableCell className="text-right text-xs">{s.lots.length}</TableCell>
                    <TableCell className="text-right text-xs">{formatINR(s.grossPlPaise)}</TableCell>
                    <TableCell className="text-right text-xs">{formatINR(s.chargesPaise)}</TableCell>
                    <TableCell className="text-right text-xs font-medium">{formatINR(s.netPlPaise)}</TableCell>
                    <TableCell className="text-right text-xs">{formatINR(s.shortTermPaise)} / {formatINR(s.longTermPaise)}</TableCell>
                  </TableRow>
                ))}
                {populated.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-xs text-muted-foreground">No realized gains in this report.</TableCell></TableRow>}
              </TableBody>
            </Table>
            <Button onClick={commit} disabled={busy}>{busy ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving…</> : "Commit realized gains"}</Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
