/**
 * Filename glob matching for statement-password auto-suggest. Pure — gate-safe (no browser APIs).
 * Glob (not regex) per the source app's DD-03: intuitive `*HDFC*statement*`, case-insensitive,
 * `*` = any run, `?` = one char. Mirrors Python's fnmatch.fnmatch(name.lower(), pattern.lower()).
 */

export interface ProfileLike {
  id: string;
  name: string;
  filenameMatchPattern: string | null;
}

/** Compile a glob to a full-match, case-insensitive RegExp. Everything except * and ? is escaped. */
function globToRegExp(pattern: string): RegExp {
  let out = "";
  for (const ch of pattern) {
    if (ch === "*") out += ".*";
    else if (ch === "?") out += ".";
    else out += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${out}$`, "i");
}

/** True iff `fileName` matches the glob (case-insensitive). Empty/blank pattern never matches. */
export function globMatches(fileName: string, pattern: string): boolean {
  if (!pattern.trim()) return false;
  return globToRegExp(pattern).test(fileName);
}

/** First profile whose glob matches the filename, or null. Profiles without a glob are skipped. */
export function matchProfileByFilename<T extends ProfileLike>(fileName: string, profiles: readonly T[]): T | null {
  for (const p of profiles) {
    if (p.filenameMatchPattern && globMatches(fileName, p.filenameMatchPattern)) return p;
  }
  return null;
}
