"use client";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { useBusy } from "@/components/busy-provider";
import { ConfirmDialog } from "@/components/confirm-dialog";

export type TxTab = "import" | "review" | "rules";

const TABS: { id: TxTab; label: string; blurb: string }[] = [
  { id: "import", label: "Import", blurb: "Drop a markdown statement. It is parsed and reconciled server-side; categorize, then commit. Re-importing the same period is a no-op." },
  { id: "review", label: "Review", blurb: "Re-categorize and tag leakage on committed transactions. Changes save instantly. Showing the most recent 300." },
  { id: "rules", label: "Rules", blurb: "Vendor → category rules applied deterministically at import and on demand. Add your own, toggle the seeded ones, then re-run them over Uncategorized Review." },
];

/**
 * Client tab hub for /transactions. All three sections stay MOUNTED (toggled with `hidden`) so an
 * in-progress import's parsed-but-uncommitted rows survive tab switches instead of being unmounted and
 * discarded. The sections are server components passed in as props. Switching is local state (no route
 * navigation); the URL is kept in sync with history.replaceState so deep-links still set the initial tab.
 */
export function TransactionsTabs({ initialTab, importSection, reviewSection, rulesSection }: {
  initialTab: TxTab;
  importSection: React.ReactNode;
  reviewSection: React.ReactNode;
  rulesSection: React.ReactNode;
}) {
  const [tab, setTab] = useState<TxTab>(initialTab);
  const { isBusy, label } = useBusy();
  const [pending, setPending] = useState<TxTab | null>(null);
  const active = TABS.find((t) => t.id === tab)!;

  function switchTo(next: TxTab) {
    setTab(next);
    window.history.replaceState(null, "", `/transactions?tab=${next}`);
  }
  function go(next: TxTab) {
    if (next === tab) return;
    if (isBusy) { setPending(next); return; } // confirm first — the op keeps running regardless
    switchTo(next);
  }

  return (
    <>
      <p className="text-sm text-muted-foreground">{active.blurb}</p>
      <nav className="flex gap-1 border-b">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => go(t.id)}
            className={cn("border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              t.id === tab ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>
            {t.label}
          </button>
        ))}
      </nav>
      <div className={cn(tab !== "import" && "hidden")}>{importSection}</div>
      <div className={cn(tab !== "review" && "hidden")}>{reviewSection}</div>
      <div className={cn(tab !== "rules" && "hidden")}>{rulesSection}</div>

      <ConfirmDialog
        open={pending !== null}
        title={`${label ?? "An operation"} is still running`}
        description="Switch tabs anyway? It will keep running in the background — nothing is cancelled."
        confirmLabel="Switch tabs"
        onConfirm={() => { if (pending) switchTo(pending); setPending(null); }}
        onCancel={() => setPending(null)}
      />
    </>
  );
}
