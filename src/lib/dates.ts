// Pure ISO-date arithmetic (UTC, date-only — no time-of-day, no timezone drift). Used to build a
// bounded ±N-day window for the same-day transaction context (src/components/txn-context.tsx).
export function addDaysISO(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}
