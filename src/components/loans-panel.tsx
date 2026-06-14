"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoanBalanceChart } from "@/components/charts";
import { amortizationSchedule, emiPaise, totalInterestPaise, prepaymentImpact, type PrepayMode } from "@/lib/calc/loan";
import { formatINR, formatPct, formatDate } from "@/lib/format";

const RUPEE = 100;
const KINDS = ["home", "vehicle", "personal", "education", "business", "other"] as const;

export interface LoanRecord {
  id: string;
  name: string;
  kind: string;
  principalPaise: number;
  annualRatePct: number;
  tenureMonths: number;
  startDate: string;
  accountId: string | null;
  emiCategory: string | null;
}
export interface AccountOption { id: string; name: string }

function toPaise(rupees: string): number {
  const n = Number(rupees.replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n * RUPEE) : 0;
}

interface FormState {
  name: string; kind: string; principal: string; rate: string; tenure: string;
  startDate: string; accountId: string; emiCategory: string;
}
const EMPTY_FORM: FormState = {
  name: "", kind: "home", principal: "", rate: "", tenure: "",
  startDate: new Date().toISOString().slice(0, 10), accountId: "", emiCategory: "",
};

export function LoansPanel({ loans, accounts, emiCategories }: {
  loans: LoanRecord[]; accounts: AccountOption[]; emiCategories: string[];
}) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(loans[0]?.id ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = loans.find((l) => l.id === selectedId) ?? null;
  const set = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }));

  function loadForEdit(l: LoanRecord) {
    setEditingId(l.id);
    setForm({
      name: l.name, kind: l.kind, principal: String(l.principalPaise / RUPEE), rate: String(l.annualRatePct),
      tenure: String(l.tenureMonths), startDate: l.startDate, accountId: l.accountId ?? "", emiCategory: l.emiCategory ?? "",
    });
  }
  function resetForm() { setEditingId(null); setForm(EMPTY_FORM); }

  async function save() {
    setError(null);
    const body = {
      name: form.name.trim(), kind: form.kind, principalPaise: toPaise(form.principal),
      annualRatePct: Number(form.rate), tenureMonths: Number(form.tenure), startDate: form.startDate,
      accountId: form.accountId || null, emiCategory: form.emiCategory || null,
    };
    if (!body.name) return setError("Name is required.");
    if (body.principalPaise <= 0) return setError("Principal must be positive.");
    if (!Number.isFinite(body.annualRatePct) || body.annualRatePct < 0) return setError("Rate must be ≥ 0.");
    if (!Number.isInteger(body.tenureMonths) || body.tenureMonths <= 0) return setError("Tenure must be a positive whole number of months.");

    setBusy(true);
    const url = editingId ? `/api/loans/${editingId}` : "/api/loans";
    const res = await fetch(url, { method: editingId ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(json.error ?? "Save failed.");
    resetForm();
    router.refresh();
  }

  async function remove(id: string) {
    setBusy(true); setError(null);
    const res = await fetch(`/api/loans/${id}`, { method: "DELETE" });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(json.error ?? "Delete failed.");
    if (selectedId === id) setSelectedId(null);
    if (editingId === id) resetForm();
    router.refresh();
  }

  return (
    <div className="space-y-6">
      {error && <p className="text-sm text-destructive">{error}</p>}

      <Card>
        <CardHeader>
          <CardTitle>{editingId ? "Edit loan" : "Add a loan"}</CardTitle>
          <CardDescription>Reducing-balance loan. EMI is computed from principal, rate and tenure.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="ln-name">Name</Label>
            <Input id="ln-name" value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="Home Loan SBI" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ln-kind">Type</Label>
            <select id="ln-kind" className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              value={form.kind} onChange={(e) => set({ kind: e.target.value })}>
              {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ln-principal">Principal (₹)</Label>
            <Input id="ln-principal" inputMode="numeric" value={form.principal} onChange={(e) => set({ principal: e.target.value })} placeholder="5000000" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ln-rate">Interest rate (% p.a.)</Label>
            <Input id="ln-rate" inputMode="decimal" value={form.rate} onChange={(e) => set({ rate: e.target.value })} placeholder="8.5" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ln-tenure">Tenure (months)</Label>
            <Input id="ln-tenure" inputMode="numeric" value={form.tenure} onChange={(e) => set({ tenure: e.target.value })} placeholder="240" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ln-start">Start date</Label>
            <Input id="ln-start" type="date" value={form.startDate} onChange={(e) => set({ startDate: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ln-acct">EMI account (optional)</Label>
            <select id="ln-acct" className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              value={form.accountId} onChange={(e) => set({ accountId: e.target.value })}>
              <option value="">—</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ln-cat">EMI category (optional)</Label>
            <select id="ln-cat" className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              value={form.emiCategory} onChange={(e) => set({ emiCategory: e.target.value })}>
              <option value="">—</option>
              {emiCategories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="flex items-end gap-2">
            <Button onClick={save} disabled={busy}>{busy ? "…" : editingId ? "Update" : "Add loan"}</Button>
            {editingId && <Button variant="outline" onClick={resetForm} disabled={busy}>Cancel</Button>}
          </div>
        </CardContent>
      </Card>

      {loans.length === 0 ? (
        <Card><CardHeader><CardTitle>No loans yet</CardTitle><CardDescription>Add a loan above to see its schedule.</CardDescription></CardHeader><CardContent /></Card>
      ) : (
        <Card>
          <CardHeader><CardTitle>Your loans</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {loans.map((l) => {
              const emi = emiPaise({ principalPaise: l.principalPaise, annualRatePct: l.annualRatePct, tenureMonths: l.tenureMonths });
              const active = l.id === selectedId;
              return (
                <div key={l.id} className={`flex flex-wrap items-center justify-between gap-3 rounded-md border p-3 ${active ? "border-primary/60 bg-accent/30" : ""}`}>
                  <button className="text-left" onClick={() => setSelectedId(l.id)}>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{l.name}</span>
                      <Badge variant="secondary">{l.kind}</Badge>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {formatINR(l.principalPaise)} · {formatPct(l.annualRatePct)} · {l.tenureMonths} mo · EMI {formatINR(emi)}
                    </div>
                  </button>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => loadForEdit(l)} disabled={busy}>Edit</Button>
                    <Button variant="ghost" size="sm" onClick={() => remove(l.id)} disabled={busy}>Delete</Button>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {selected && <LoanDetail loan={selected} />}

      <p className="text-xs text-muted-foreground">
        Reducing-balance EMI = P·r·(1+r)ⁿ / ((1+r)ⁿ−1), r = annual rate / 12. Assumes a fixed rate for the
        whole tenure, monthly EMI in arrears, no fees/insurance/moratorium. Prepayment is modelled as a
        one-time lump sum. Educational, not financial advice.
      </p>
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-card p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}

function LoanDetail({ loan }: { loan: LoanRecord }) {
  const input = { principalPaise: loan.principalPaise, annualRatePct: loan.annualRatePct, tenureMonths: loan.tenureMonths };
  const schedule = useMemo(() => amortizationSchedule(input), [loan.principalPaise, loan.annualRatePct, loan.tenureMonths]);
  const emi = schedule.find((r) => r.month === 1)?.emiPaise ?? emiPaise(input);
  const totalInterest = totalInterestPaise(schedule);
  const totalPayment = loan.principalPaise + totalInterest;
  const chartData = schedule.map((r) => ({ month: r.month, balance: r.closingBalancePaise }));

  // Prepayment what-if
  const [prepay, setPrepay] = useState("");
  const [atMonth, setAtMonth] = useState("12");
  const [mode, setMode] = useState<PrepayMode>("reduce_tenure");
  const impact = useMemo(() => {
    const prepaymentPaise = toPaise(prepay);
    const at = Number(atMonth);
    if (prepaymentPaise <= 0 || !Number.isInteger(at) || at < 1 || at >= loan.tenureMonths) return null;
    try {
      return prepaymentImpact({ ...input, prepaymentPaise, atMonth: at, mode });
    } catch { return null; }
  }, [prepay, atMonth, mode, loan.principalPaise, loan.annualRatePct, loan.tenureMonths]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{loan.name}</CardTitle>
          <CardDescription>
            Started {formatDate(loan.startDate)}
            {loan.emiCategory ? ` · EMI category: ${loan.emiCategory}` : ""}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-3 sm:grid-cols-4">
            <Tile label="Monthly EMI" value={formatINR(emi)} />
            <Tile label="Total interest" value={formatINR(totalInterest)} />
            <Tile label="Total payment" value={formatINR(totalPayment)} />
            <Tile label="Tenure" value={`${loan.tenureMonths} mo`} />
          </div>
          <LoanBalanceChart data={chartData} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Prepayment what-if</CardTitle>
          <CardDescription>Model a one-time lump-sum prepayment after a chosen month.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="pp-amt">Prepayment (₹)</Label>
              <Input id="pp-amt" inputMode="numeric" value={prepay} onChange={(e) => setPrepay(e.target.value)} placeholder="200000" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pp-month">After month</Label>
              <Input id="pp-month" inputMode="numeric" value={atMonth} onChange={(e) => setAtMonth(e.target.value)} placeholder="12" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pp-mode">Mode</Label>
              <select id="pp-mode" className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                value={mode} onChange={(e) => setMode(e.target.value as PrepayMode)}>
                <option value="reduce_tenure">Reduce tenure (keep EMI)</option>
                <option value="reduce_emi">Reduce EMI (keep tenure)</option>
              </select>
            </div>
          </div>
          {impact ? (
            <div className="grid gap-3 sm:grid-cols-3">
              <Tile label="Interest saved" value={formatINR(impact.interestSavedPaise)} />
              {mode === "reduce_tenure" ? (
                <>
                  <Tile label="Months saved" value={`${impact.monthsSaved} mo`} />
                  <Tile label="New tenure" value={`${impact.newTenureMonths} mo`} />
                </>
              ) : (
                <>
                  <Tile label="New EMI" value={formatINR(impact.newEmiPaise ?? 0)} />
                  <Tile label="Tenure" value={`${loan.tenureMonths} mo (unchanged)`} />
                </>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Enter a prepayment amount and a month within the loan tenure.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Amortization schedule</CardTitle></CardHeader>
        <CardContent>
          <div className="max-h-96 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-card text-xs text-muted-foreground">
                <tr className="border-b text-right">
                  <th className="py-2 text-left">#</th>
                  <th className="py-2">Opening</th><th className="py-2">EMI</th>
                  <th className="py-2">Interest</th><th className="py-2">Principal</th><th className="py-2">Closing</th>
                </tr>
              </thead>
              <tbody>
                {schedule.map((r) => (
                  <tr key={r.month} className="border-b text-right last:border-0">
                    <td className="py-1.5 text-left">{r.month}</td>
                    <td className="py-1.5">{formatINR(r.openingBalancePaise)}</td>
                    <td className="py-1.5">{formatINR(r.emiPaise)}</td>
                    <td className="py-1.5">{formatINR(r.interestPaise)}</td>
                    <td className="py-1.5">{formatINR(r.principalPaise)}</td>
                    <td className="py-1.5">{formatINR(r.closingBalancePaise)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
