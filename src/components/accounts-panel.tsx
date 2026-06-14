"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatINR, formatDate, formatMonth } from "@/lib/format";
import { formatAccountDetails, institutionLabel, type AccountDetails } from "@/lib/accounts/format";
import { Copy, Check, ArrowRight } from "lucide-react";

export interface AccountRow {
  id: string; name: string; institution: string; kind: string;
  anchorBalancePaise: number | null; anchorDate: string | null;
  accountHolderName: string; accountNumber: string; ifsc: string; branch: string; accountType: string; upiId: string;
}

export interface AccountFlow { inflowPaise: number; outflowPaise: number; count: number }
export type AccountFlowMap = Record<string, AccountFlow>;

type EditState = Pick<AccountRow, "accountHolderName" | "accountNumber" | "ifsc" | "branch" | "accountType" | "upiId">;

const FIELDS: Array<{ key: keyof EditState; label: string; placeholder: string }> = [
  { key: "accountHolderName", label: "Account holder", placeholder: "Full name as per bank" },
  { key: "accountNumber", label: "Account number", placeholder: "e.g. 1234567890" },
  { key: "ifsc", label: "IFSC", placeholder: "e.g. SBIN0001234" },
  { key: "branch", label: "Branch", placeholder: "e.g. MG Road" },
  { key: "accountType", label: "Account type", placeholder: "e.g. Savings / Current" },
  { key: "upiId", label: "UPI ID", placeholder: "e.g. name@oksbi" },
];

// Map the camel-cased form state → the snake_case PATCH body the API whitelists.
const COLUMN: Record<keyof EditState, string> = {
  accountHolderName: "account_holder_name", accountNumber: "account_number", ifsc: "ifsc",
  branch: "branch", accountType: "account_type", upiId: "upi_id",
};

export function AccountsPanel({ accounts, flows, month }: { accounts: AccountRow[]; flows: AccountFlowMap; month: string }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {accounts.map((a) => <AccountCard key={a.id} account={a} flow={flows[a.id]} month={month} />)}
    </div>
  );
}

function AccountCard({ account, flow, month }: { account: AccountRow; flow?: AccountFlow; month: string }) {
  const router = useRouter();
  const [s, setS] = useState<EditState>({
    accountHolderName: account.accountHolderName, accountNumber: account.accountNumber, ifsc: account.ifsc,
    branch: account.branch, accountType: account.accountType, upiId: account.upiId,
  });
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The copy block reflects the form live, so you copy exactly what you see (institution is read-only).
  const details: AccountDetails = { institution: account.institution, ...s };
  const block = formatAccountDetails(details);

  async function save() {
    setBusy(true); setError(null); setSaved(false);
    const body: Record<string, string> = { id: account.id };
    for (const f of FIELDS) body[COLUMN[f.key]] = s[f.key];
    const res = await fetch("/api/accounts", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setBusy(false);
    if (!res.ok) { const j = await res.json().catch(() => ({})); setError(j.error ?? "save failed"); return; }
    setSaved(true); setTimeout(() => setSaved(false), 1500);
    router.refresh();
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(block);
      setCopied(true); setTimeout(() => setCopied(false), 1500);
    } catch { setError("couldn't access clipboard"); }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">{account.name}</CardTitle>
          <Badge variant="secondary">{account.kind.replace("_", " ")}</Badge>
        </div>
        <CardDescription>{institutionLabel(account.institution) || account.institution}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="text-xs text-muted-foreground">
          {account.anchorBalancePaise !== null
            ? <>Anchor {formatINR(account.anchorBalancePaise)} · {account.anchorDate ? formatDate(account.anchorDate) : "—"}</>
            : <>No anchor yet — set on first statement import.</>}
        </div>

        <div className="rounded-md border bg-muted/30 p-3">
          <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Contribution · {month ? formatMonth(month) : "—"}
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">In</span>
            <span className="font-medium text-income">{formatINR(flow?.inflowPaise ?? 0)}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Out</span>
            <span className="font-medium text-destructive">{formatINR(flow?.outflowPaise ?? 0)}</span>
          </div>
          <Link href={`/transactions?tab=review&account=${account.id}`}
            className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
            View transactions <ArrowRight className="h-3 w-3" />
          </Link>
        </div>

        <div className="grid gap-2">
          {FIELDS.map((f) => (
            <label key={f.key} className="block">
              <span className="text-xs text-muted-foreground">{f.label}</span>
              <Input value={s[f.key]} placeholder={f.placeholder} disabled={busy}
                onChange={(e) => setS((p) => ({ ...p, [f.key]: e.target.value }))} className="mt-0.5 h-9 text-sm" />
            </label>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <Button size="sm" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
          {saved && <span className="text-xs text-income">Saved</span>}
          {error && <span className="text-xs text-destructive">{error}</span>}
        </div>

        {block ? (
          <div className="rounded-md border bg-muted/30 p-3">
            <pre className="whitespace-pre-wrap break-words font-sans text-xs">{block}</pre>
            <Button size="sm" variant="outline" className="mt-2 gap-1.5" onClick={copy}>
              {copied ? <><Check className="h-3.5 w-3.5 text-income" /> Copied</> : <><Copy className="h-3.5 w-3.5" /> Copy</>}
            </Button>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">Fill in the details above to get a copy-pastable block.</p>
        )}
      </CardContent>
    </Card>
  );
}
