"use client";
import { useEffect, useState } from "react";
import { createSupabaseBrowser } from "@/lib/supabase/client";
import { addDaysISO } from "@/lib/dates";
import { formatINR, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

interface ContextRow { id: string; txnDate: string; amountPaise: number; description: string; merchant: string }

/**
 * Read-only same-account context for one review row: every transaction on that account within
 * ±windowDays of its date. Bounded by construction (one account, a small date window, a row cap) —
 * never a whole-ledger fetch. Browser Supabase client, RLS-scoped, mirroring how the review table
 * already writes (src/lib/client/category-write.ts) — no new API route needed for a read this narrow.
 */
export function TxnContext({ txnId, accountId, date, windowDays = 2 }: {
  txnId: string;
  accountId: string;
  date: string;
  windowDays?: number;
}) {
  const [rows, setRows] = useState<ContextRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    setError(null);
    const supabase = createSupabaseBrowser();
    supabase.from("transactions")
      .select("id,txn_date,amount_paise,description_raw,merchant")
      .eq("account_id", accountId)
      .gte("txn_date", addDaysISO(date, -windowDays))
      .lte("txn_date", addDaysISO(date, windowDays))
      .order("txn_date").order("id")
      .limit(50)
      .then(({ data, error: err }) => {
        if (cancelled) return;
        if (err) { setError(err.message); return; }
        setRows((data ?? []).map((t) => ({
          id: t.id as string,
          txnDate: t.txn_date as string,
          amountPaise: t.amount_paise as number,
          description: (t.description_raw as string) ?? "",
          merchant: (t.merchant as string | null) ?? "",
        })));
      });
    return () => { cancelled = true; };
  }, [accountId, date, windowDays]);

  if (error) return <p className="px-2 py-1.5 text-xs text-destructive">Couldn't load context: {error}</p>;
  if (rows === null) return <p className="px-2 py-1.5 text-xs text-muted-foreground">Loading…</p>;
  if (rows.length === 0) return <p className="px-2 py-1.5 text-xs text-muted-foreground">No other transactions on this account in this window.</p>;

  return (
    <div className="max-w-2xl space-y-1 px-2 py-1.5">
      {rows.map((r) => (
        <div key={r.id} className={cn("flex items-center justify-between gap-3 rounded px-1.5 py-1 text-xs",
          r.id === txnId && "bg-accent/50")}>
          <span className="min-w-0 flex-1 truncate">
            <span className="text-muted-foreground">{formatDate(r.txnDate)}</span>{" "}
            {r.description}{r.merchant ? ` · ${r.merchant}` : ""}
          </span>
          <span className={cn("shrink-0 whitespace-nowrap font-medium", r.amountPaise < 0 ? "text-destructive" : "text-income")}>
            {formatINR(r.amountPaise, { sign: true })}
          </span>
        </div>
      ))}
    </div>
  );
}
