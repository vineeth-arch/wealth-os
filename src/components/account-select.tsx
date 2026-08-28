"use client";
import { useRouter, useSearchParams } from "next/navigation";

/**
 * Visible account/bank filter for the /transactions Review tab. Sets the same `?account=` param the
 * account-page deep-link already drives (src/components/accounts-panel.tsx) — one source of truth —
 * and always keeps `tab=review` so the navigation lands back on this tab. router.push() (not the tab
 * hub's local-state switchTo) because this genuinely re-fetches server data for the new filter.
 */
export function AccountSelect({ accounts, value }: { accounts: Array<{ id: string; name: string }>; value: string }) {
  const router = useRouter();
  const params = useSearchParams();

  function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = new URLSearchParams(params.toString());
    next.set("tab", "review");
    if (e.target.value) next.set("account", e.target.value);
    else next.delete("account");
    router.push(`/transactions?${next.toString()}`);
  }

  return (
    <label className="flex items-center gap-2 text-sm text-muted-foreground">
      Account
      <select value={value} onChange={onChange}
        className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring">
        <option value="">All accounts</option>
        {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
      </select>
    </label>
  );
}
