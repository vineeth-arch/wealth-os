/**
 * The auth callback redirects to `${origin}${next}` with `next` taken from the URL. Unvalidated,
 * that is an open redirect: `next=@evil.com` makes the browser treat the origin as userinfo and
 * land on evil.com; `//evil.com` is protocol-relative (audit FA-6). Only a same-origin absolute
 * path survives this filter; everything else falls back to the dashboard. Pure, gate-tested.
 */

export const DEFAULT_NEXT_PATH = "/dashboard";

/**
 * True if s contains whitespace, a C0 control char, DEL, or a backslash (0x5c — browsers
 * normalize it to a slash). Explicit char codes: no string escapes, no regex-class subtleties.
 */
function hasForbiddenChar(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c <= 0x20 || c === 0x7f || c === 0x5c) return true;
  }
  return false;
}

export function safeNextPath(next: string | null | undefined): string {
  if (!next) return DEFAULT_NEXT_PATH;
  if (!next.startsWith("/")) return DEFAULT_NEXT_PATH; // bare hosts, schemes, "@evil.com"
  if (next.startsWith("//")) return DEFAULT_NEXT_PATH; // protocol-relative escape
  if (hasForbiddenChar(next)) return DEFAULT_NEXT_PATH;
  return next;
}
