"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useBusy } from "@/components/busy-provider";
import { usePassphrase } from "@/components/passphrase-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { formatINR, formatDate } from "@/lib/format";
import type { ImportResponse, WireStatement, CommitRequest } from "@/lib/ingest/wire";
import { ACCEPT_ATTR, ConvertError, convertErrorMessage, detectSourceKind, isMarkdown, isPdf } from "@/lib/convert/types";
import { matchProfileByFilename } from "@/lib/convert/glob";
import { convertNonPdf } from "@/lib/convert/markitdown";
import { convertPdf } from "@/lib/convert/pdf";
import { decryptPassword } from "@/lib/convert/crypto";
import { CheckCircle2, AlertTriangle, FileUp, Loader2, KeyRound } from "lucide-react";

type Account = { id: string; name: string; institution: string; kind: string };
type Category = { name: string; parent: string | null };
type Profile = { id: string; name: string; filenameMatchPattern: string | null; passwordCiphertext: string; kdfSalt: string; kdfIterations: number };

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

export function ImportWizard({ accounts, categories, profiles }: { accounts: Account[]; categories: Category[]; profiles: Profile[] }) {
  const router = useRouter();
  const { begin, end } = useBusy();
  const { requestPassphrase } = usePassphrase();
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [fileName, setFileName] = useState<string>("");
  const [file, setFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [convertStage, setConvertStage] = useState<string | null>(null);
  const [manualPassword, setManualPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [statements, setStatements] = useState<StmtState[] | null>(null);
  const [committing, setCommitting] = useState(false);
  const [result, setResult] = useState<{ inserted: number; duplicate: number; statements: number } | null>(null);

  // Source kind + (for PDFs) the saved-password profile auto-suggested by filename glob.
  const kind = useMemo(() => (file ? detectSourceKind(file.name) : "unknown"), [file]);
  const matchedProfile = useMemo(
    () => (file && isPdf(kind) ? matchProfileByFilename(file.name, profiles) : null),
    [file, kind, profiles],
  );

  /** Resolve the plaintext PDF password (manual entry wins; else decrypt the matched profile; else none). */
  async function resolvePdfPassword(): Promise<string | undefined> {
    if (manualPassword) return manualPassword;
    if (matchedProfile) {
      const passphrase = await requestPassphrase();
      return decryptPassword(
        { ciphertext: matchedProfile.passwordCiphertext, salt: matchedProfile.kdfSalt, iterations: matchedProfile.kdfIterations },
        passphrase,
      );
    }
    return undefined; // server reports password_required if the PDF turns out to be encrypted
  }

  async function parse() {
    if (!file || !accountId) { setError("Pick an account and a file."); return; }
    const account = accounts.find((a) => a.id === accountId);
    if (!account) { setError("Account not found."); return; }
    if (kind === "unknown") { setError(convertErrorMessage("unsupported_type")); return; }

    const id = begin("Import");
    setParsing(true); setError(null); setResult(null); setStatements(null);
    try {
      // 1) Obtain markdown — convert client-side (xlsx/text) or via the server PDF service. Markdown/txt
      //    skip conversion entirely (today's manual flow). Raw bytes/passwords never go to /api/import.
      let markdown: string;
      if (isMarkdown(kind)) {
        markdown = await file.text();
      } else if (isPdf(kind)) {
        setConvertStage("Converting PDF…");
        markdown = (await convertPdf(file, account.institution, await resolvePdfPassword())).markdown;
      } else {
        setConvertStage("Loading converter (first time only)…");
        markdown = (await convertNonPdf(file, kind)).markdown;
      }
      if (!mounted.current) return;
      setConvertStage(null);

      // 2) Upload the markdown to the UNCHANGED import route, keeping the original filename for provenance.
      const mdFile = new File([markdown], file.name.replace(/\.[^.]+$/, "") + ".md", { type: "text/markdown" });
      const fd = new FormData();
      fd.append("file", mdFile);
      fd.append("accountId", accountId);
      const res = await fetch("/api/import", { method: "POST", body: fd });
      const json = await res.json();
      if (!mounted.current) return; // op completed server-side; UI gone — drop the result quietly
      if (!res.ok) { setError(json.error ?? "import failed"); return; }
      const data = json as ImportResponse;
      setStatements(data.results.map((s) => ({
        stmt: s,
        rows: s.transactions.map((t) => ({ categoryName: t.suggestedCategory, tags: [], included: true })),
      })));
    } catch (e) {
      if (mounted.current) {
        const err = e as Error;
        setError(err instanceof ConvertError ? convertErrorMessage(err.code) : err.message);
      }
    } finally {
      if (mounted.current) { setParsing(false); setConvertStage(null); }
      end(id);
    }
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
    const id = begin("Commit");
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
    try {
      const res = await fetch("/api/commit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const json = await res.json();
      if (!mounted.current) return; // committed server-side regardless; just no UI to update
      if (!res.ok) { setError(json.error ?? "commit failed"); return; }
      setResult(json);
      setStatements(null);
      router.refresh();
    } catch (e) {
      if (mounted.current) setError((e as Error).message);
    } finally {
      if (mounted.current) setCommitting(false);
      end(id);
    }
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
              <label className="text-sm font-medium">Statement file</label>
              <label className="flex h-10 cursor-pointer items-center gap-2 rounded-md border border-dashed border-input px-3 text-sm text-muted-foreground hover:bg-accent">
                <FileUp className="h-4 w-4" />
                <span className="truncate">{fileName || "Choose a statement (PDF, Excel, CSV, HTML, …)"}</span>
                <input type="file" accept={ACCEPT_ATTR} className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0] ?? null; setFile(f); setFileName(f?.name ?? ""); setManualPassword(""); setError(null); }} />
              </label>
            </div>
          </div>

          {file && isPdf(kind) && (
            <div className="space-y-2 rounded-md border bg-muted/30 p-3 text-sm">
              {matchedProfile ? (
                <p className="flex items-center gap-1.5 text-muted-foreground">
                  <KeyRound className="h-4 w-4" /> Using saved password
                  <span className="font-medium text-foreground">{matchedProfile.name}</span>
                  — you&apos;ll be asked for your master passphrase. Enter one below to override.
                </p>
              ) : (
                <p className="flex items-center gap-1.5 text-muted-foreground">
                  <KeyRound className="h-4 w-4" /> If this PDF is password-protected, enter its password (or save one in Settings → Statement passwords).
                </p>
              )}
              <Input type="password" value={manualPassword} onChange={(e) => setManualPassword(e.target.value)}
                placeholder="PDF password (optional)" autoComplete="off" className="max-w-xs" />
            </div>
          )}

          <Button onClick={parse} disabled={parsing || !file}>
            {parsing ? <><Loader2 className="h-4 w-4 animate-spin" /> {convertStage ?? "Parsing…"}</> : "Parse & reconcile"}
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
