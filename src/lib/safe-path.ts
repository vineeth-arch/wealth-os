/**
 * Guards a redirect-target search param against becoming an open redirect. Must resolve to an
 * in-app, same-origin path only: a single leading "/" (not "//" or "/\", both of which browsers
 * treat as protocol-relative), no backslashes, and no "://" scheme separator anywhere in the value.
 */
export function safeNextPath(next: string | null | undefined, fallback = "/dashboard"): string {
  if (!next || !next.startsWith("/")) return fallback;
  if (next.startsWith("//") || next.includes("\\") || next.includes("://")) return fallback;
  return next;
}
