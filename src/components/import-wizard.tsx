"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { formatINR, formatDate } from "@/lib/format";
import type { ImportResponse, WireStatement, CommitRequest } from "@/lib/ingest/wire";
import { CheckCircle2, AlertTriangle, FileUp, Loader2 } from "lucide-react";

type Account = { id: string; name: string; institution: string; kind: string };
type Category = { name: string; parent: string | null };

interface RowState { categoryName: string; tags: string[]; included: boolean; }
interface StmtState { stmt: WireStatement; rows: RowState[]; }

const LEAKAGE = "leakage";

function ReconBanner({ s }: { s: WireStatement }) {
  const r = s.reconciliation;
  const ok = r.ok;
  return (
    <div className={cn("flex items-start gap-2 rounded-md border p-3 text-sm",
      ok ? "border-income/30 bg-income/10" : "border-destructive/30 bg-destructive/10")}>
      {ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 text-income" /> : <AlertTriangle className="mt-0.5 h-4 w-4 text-destructive" />}
      <div className="space-y-0.5">
        <div className="font-medium">{ok ? "Reconciled" : "Reconciliation failed"} · {s.transactions.length} transactions</div>
        <div className="text-muted-foreground">
          {r.openingPaise !== null && <>opening {formatINR(r.openingPaise)} · </>}
          {r.closingPaise !== null && <>closing {formatINR(r.closingPaise)} · </>}
          parsed Σ {formatINR(r.parsedSumPaise)}
        </div>
        <div className="text-xs text-muted-foreground">{r.detail}</div>
        {s.warnings.map((w, i) => <div key={i} className="text-xs text-muted-foreground">⚠ {w}</div>)}
      </div>
    </div>
  );
}

/** Native grouped select — fast for hundreds of options across many rows. */
function CategorySelect({ value, options, onChange }: { value: string; options: Category[]; onChange: (v: string) => void }) {
  const groups = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const c of options) {
      const g = c.parent ?? "—";
      if (!m.has(g)) m.set(g, []);
      m.get(g)!.push(c.name);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [options]);
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}
      className="h-8 w-full max-w-[16rem] rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-2 focus:ring-ring">
      {groups.map(([g, names]) => (
        <optgroup key={g} label={g}>
          {names.sort().map((n) => <option key={n} value={n}>{n}</option>)}
        </optgroup>
      ))}
    </select>
  );
}

export function ImportWizard({ accounts, categories }: { accounts: Account[]; categories: Category[] }) {
  const router = useRouter();
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [fileName, setFileName] = useState<string>("");
  const [file, setFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statements, setStatements] = useState<StmtState[] | null>(null);
  const [committing, setCommitting] = useState(false);
  const [result, setResult] = useState<{ inserted: number; duplicate: number; statements: number } | null>(null);

  async function parse() {
    if (!file || !accountId) { setError("Pick an account and a file."); return; }
    setParsing(true); setError(null); setResult(null); setStatements(null);
    const fd = new FormData();
    fd.append("file", file);
    fd.append("accountId", accountId);
    const res = await fetch("/api/import", { method: "POST", body: fd });
    const json = await res.json();
    setParsing(false);
    if (!res.ok) { setError(json.error ?? "import failed"); return; }
    const data = json as ImportResponse;
    setStatements(data.results.map((s) => ({
      stmt: s,
      rows: s.transactions.map((t) => ({ categoryName: t.suggestedCategory, tags: [], included: true })),
    })));
  }

  function setRow(si: number, ri: number, patch: Partial<RowState>) {
    setStatements((prev) => {
      if (!prev) return prev;
      const next = prev.slice();
      const rows = next[si].rows.slice();
      rows[ri] = { ...rows[ri], ...patch };
      next[si] = { ...next[si], rows };
      return next;
    });
  }
  function toggleLeakage(si: number, ri: number) {
    const has = statements![si].rows[ri].tags.includes(LEAKAGE);
    const tags = has ? statements![si].rows[ri].tags.filter((t) => t !== LEAKAGE) : [...statements![si].rows[ri].tags, LEAKAGE];
    setRow(si, ri, { tags });
  }

  async function commit() {
    if (!statements) return;
    setCommitting(true); setError(null);
    const payload: CommitRequest = {
      accountId,
      statements: statements.map((st) => ({
        periodStart: st.stmt.periodStart,
        periodEnd: st.stmt.periodEnd,
        openingPaise: st.stmt.reconciliation.openingPaise,
        closingPaise: st.stmt.reconciliation.closingPaise,
        expectedDeltaPaise: st.stmt.reconciliation.expectedDeltaPaise,
        fileName,
        institution: st.stmt.institution,
        rows: st.rows.filter((r) => r.included).map((r, i) => {
          const t = st.stmt.transactions[st.rows.indexOf(r)] ?? st.stmt.transactions[i];
          return {
            txnDate: t.txnDate, amountPaise: t.amountPaise, balanceAfterPaise: t.balanceAfterPaise,
            descriptionRaw: t.descriptionRaw, refNo: t.refNo, nativeType: t.nativeType, subAccount: t.subAccount,
            categoryName: r.categoryName, tags: r.tags,
          };
        }),
      })),
    };
    const res = await fetch("/api/commit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const json = await res.json();
    setCommitting(false);
    if (!res.ok) { setError(json.error ?? "commit failed"); return; }
    setResult(json);
    setStatements(null);
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle>1 · Upload</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Account</label>
              <Select value={accountId} onValueChange={setAccountId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.name} · {a.institution}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Statement file (.md)</label>
              <label className="flex h-10 cursor-pointer items-center gap-2 rounded-md border border-dashed border-input px-3 text-sm text-muted-foreground hover:bg-accent">
                <FileUp className="h-4 w-4" />
                <span className="truncate">{fileName || "Choose a markdown file"}</span>
                <input type="file" accept=".md,.markdown,.txt,text/markdown,text/plain" className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0] ?? null; setFile(f); setFileName(f?.name ?? ""); }} />
              </label>
            </div>
          </div>
          <Button onClick={parse} disabled={parsing || !file}>
            {parsing ? <><Loader2 className="h-4 w-4 animate-spin" /> Parsing…</> : "Parse & reconcile"}
          </Button>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </CardContent>
      </Card>

      {result && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><CheckCircle2 className="h-5 w-5 text-income" /> Committed</CardTitle>
            <CardDescription>{result.statements} statement(s): {result.inserted} inserted, {result.duplicate} already present (no-ops).</CardDescription>
          </CardHeader>
        </Card>
      )}

      {statements && (
        <>
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">2 · Review &amp; categorize</h2>
            <Button onClick={commit} disabled={committing}>
              {committing ? <><Loader2 className="h-4 w-4 animate-spin" /> Committing…</> : "Commit all"}
            </Button>
          </div>
          {statements.map((st, si) => (
            <Card key={si}>
              <CardHeader className="space-y-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">
                    {st.stmt.periodStart ? `${formatDate(st.stmt.periodStart)} → ` : ""}{st.stmt.periodEnd ? formatDate(st.stmt.periodEnd) : "statement"}
                  </CardTitle>
                  <Badge variant={st.stmt.reconciliation.ok ? "success" : "destructive"}>
                    {st.stmt.reconciliation.ok ? "reconciled" : "check"}
                  </Badge>
                </div>
                <ReconBanner s={st.stmt} />
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[92px]">Date</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead className="w-[16rem]">Category</TableHead>
                      <TableHead className="w-[84px]">Leakage</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {st.stmt.transactions.map((t, ri) => {
                      const rs = st.rows[ri];
                      const leak = rs.tags.includes(LEAKAGE);
                      return (
                        <TableRow key={ri} className={cn(!rs.included && "opacity-40")}>
                          <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{formatDate(t.txnDate)}</TableCell>
                          <TableCell className="max-w-[22rem] truncate text-xs" title={t.descriptionRaw}>{t.descriptionRaw}</TableCell>
                          <TableCell className={cn("whitespace-nowrap text-right text-xs font-medium", t.amountPaise < 0 ? "text-destructive" : "text-income")}>
                            {formatINR(t.amountPaise, { sign: true })}
                          </TableCell>
                          <TableCell>
                            <CategorySelect value={rs.categoryName} options={categories} onChange={(v) => setRow(si, ri, { categoryName: v })} />
                          </TableCell>
                          <TableCell>
                            <button onClick={() => toggleLeakage(si, ri)}
                              className={cn("rounded-full px-2 py-0.5 text-xs font-medium transition-colors",
                                leak ? "bg-leakage/20 text-leakage" : "bg-muted text-muted-foreground hover:bg-leakage/10")}>
                              {leak ? "leakage" : "tag"}
                            </button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ))}
        </>
      )}
    </div>
  );
}
