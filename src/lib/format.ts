/** UI formatting. Money is integer paise everywhere; format only at the view boundary. */

export function formatINR(paise: number, opts: { sign?: boolean } = {}): string {
  const neg = paise < 0;
  const rupees = Math.abs(paise) / 100;
  const body = rupees.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const prefix = neg ? "-₹" : opts.sign ? "+₹" : "₹";
  return `${prefix}${body}`;
}

/** Compact form for big tiles: ₹1.2L, ₹3.4Cr. */
export function formatINRCompact(paise: number): string {
  const neg = paise < 0;
  const r = Math.abs(paise) / 100;
  let body: string;
  if (r >= 1e7) body = `${(r / 1e7).toFixed(2)}Cr`;
  else if (r >= 1e5) body = `${(r / 1e5).toFixed(2)}L`;
  else if (r >= 1e3) body = `${(r / 1e3).toFixed(1)}K`;
  else body = r.toFixed(0);
  return `${neg ? "-₹" : "₹"}${body}`;
}

export function formatPct(n: number, digits = 1): string {
  return `${n.toFixed(digits)}%`;
}

/** "2026-03" → "Mar 2026" */
export function formatMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-IN", { month: "short", year: "numeric" });
}

/** "2026-03-14" → "14 Mar 2026" */
export function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export function monthKey(iso: string): string {
  return iso.slice(0, 7);
}
