"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CategorySelect, type CategoryOption } from "@/components/category-select";
import { updateTxnCategory } from "@/lib/client/category-write";
import { formatINR, formatDate } from "@/lib/format";
import type { DrillTxn } from "@/lib/drilldown";

/**
 * One transaction inside a drill-down: full description + meta + amount, an inline category dropdown
 * (writes category_source='user' via the shared path), and an "Add rule" affordance that creates a
 * vendor_rule from the counterpart text → the chosen category. router.refresh() re-pulls the dashboard
 * so the change is reflected immediately.
 */
export function DrillTxnRow({ t, categories }: { t: DrillTxn; categories: CategoryOption[] }) {
  const router = useRouter();
  const validIds = useMemo(() => new Set(categories.map((c) => c.id)), [categories]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; msg: string } | null>(null);

  async function onChange(categoryId: string) {
    setBusy(true); setNote(null);
    const { error } = await updateTxnCategory(t.id, categoryId, validIds);
    setBusy(false);
    if (error) { setNote({ ok: false, msg: error }); return; }
    router.refresh();
  }

  async function addRule() {
    setBusy(true); setNote(null);
    const res = await fetch("/api/rules/create", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ matchText: `${t.descriptionRaw} ${t.merchant}`.trim(), categoryName: t.categoryName }),
    });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    setNote(res.ok ? { ok: true, msg: `Rule added: ${json.match} → ${t.categoryName}` } : { ok: false, msg: json.error ?? "rule failed" });
  }

  return (
    <div className="border-b py-2 text-xs last:border-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="break-words">{t.descriptionRaw}{t.merchant ? ` · ${t.merchant}` : ""}</div>
          <div className="text-[11px] text-muted-foreground">{formatDate(t.txnDate)} · {t.accountName || "—"} · {t.categorySource}</div>
        </div>
        <span className={`shrink-0 whitespace-nowrap font-medium ${t.amountPaise < 0 ? "text-destructive" : "text-income"}`}>{formatINR(t.amountPaise, { sign: true })}</span>
      </div>
      <div className="mt-1.5 flex items-center gap-2">
        <CategorySelect value={t.categoryId} categories={categories} onChange={onChange} disabled={busy} />
        <button onClick={addRule} disabled={busy || !t.categoryId}
          className="shrink-0 rounded-md border border-input px-2 py-1 text-[11px] hover:bg-accent disabled:opacity-50">Add rule</button>
      </div>
      {note && <p className={`mt-1 text-[11px] ${note.ok ? "text-income" : "text-destructive"}`}>{note.msg}</p>}
    </div>
  );
}
