"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { formatMonth } from "@/lib/format";

/**
 * Per-page month picker. Pushes `?month=YYYY-MM` (preserving other params) so the server page
 * re-renders for the chosen month. Deferred: a single global period control shared across pages —
 * see the plan's "Deferred" note; until pages start duplicating this we keep it local.
 */
export function MonthSelect({ months, value }: { months: string[]; value: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = new URLSearchParams(params.toString());
    next.set("month", e.target.value);
    router.push(`${pathname}?${next.toString()}`);
  }

  if (months.length === 0) return null;
  return (
    <label className="flex items-center gap-2 text-sm text-muted-foreground">
      Month
      <select value={value} onChange={onChange}
        className="rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground">
        {months.map((m) => <option key={m} value={m}>{formatMonth(m)}</option>)}
      </select>
    </label>
  );
}
