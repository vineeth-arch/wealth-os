/**
 * Pure types + detection for the in-app file→markdown converter. NO browser/Pyodide/React imports —
 * this module is gate-safe (imported by scripts/verify.ts) and must stay framework-free.
 *
 * Two conversion runtimes, by source kind (see the plan / CLAUDE.md):
 *   - in the BROWSER via Pyodide: xlsx, csv, txt, xml, json  (raw bytes never reach the server)
 *   - on the SERVER via PyMuPDF4LLM: pdf  (the only engine that reproduces the PDF fixtures)
 * markdown/txt are passed through untouched (today's manual flow), never loading Pyodide.
 */

export type SourceKind =
  | "markdown"
  | "pdf"
  | "xlsx"
  | "csv"
  | "html"
  | "txt"
  | "xml"
  | "json"
  | "unknown";

/** The file extensions the import picker accepts, grouped by kind. */
export const EXTENSIONS: Record<Exclude<SourceKind, "unknown">, readonly string[]> = {
  markdown: [".md", ".markdown"],
  pdf: [".pdf"],
  xlsx: [".xlsx"],
  csv: [".csv"],
  html: [".html", ".htm"],
  txt: [".txt"],
  xml: [".xml"],
  json: [".json"],
};

/** A flat, de-duplicated `accept=""` string for an <input type="file">. */
export const ACCEPT_ATTR: string = Object.values(EXTENSIONS).flat().join(",");

/** Kinds converted in the browser (Pyodide). PDF is server-side; markdown/txt need no conversion. */
const PYODIDE_KINDS: ReadonlySet<SourceKind> = new Set(["xlsx", "csv", "html", "xml", "json"]);

function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot === -1 ? "" : fileName.slice(dot).toLowerCase();
}

/** Classify a file by extension (the reliable signal for these formats). */
export function detectSourceKind(fileName: string): SourceKind {
  const ext = extensionOf(fileName);
  for (const [kind, exts] of Object.entries(EXTENSIONS)) {
    if ((exts as readonly string[]).includes(ext)) return kind as SourceKind;
  }
  return "unknown";
}

export function isMarkdown(kind: SourceKind): boolean {
  // .txt is treated as already-markdown text: no conversion, straight to /api/import.
  return kind === "markdown" || kind === "txt";
}
export function isPdf(kind: SourceKind): boolean {
  return kind === "pdf";
}
/** True iff this kind needs the in-browser Pyodide converter. */
export function needsPyodide(kind: SourceKind): boolean {
  return PYODIDE_KINDS.has(kind);
}

export interface ConvertResult {
  markdown: string;
  sourceKind: SourceKind;
  /** A PDF password was supplied/used (for "decrypted with saved profile X" UX). */
  usedPassword: boolean;
}

export type ConvertErrorCode =
  | "unsupported_type"
  | "password_required"
  | "wrong_password"
  | "corrupt_source"
  | "pyodide_load_failed"
  | "convert_failed"
  | "pdf_service_error";

/** Typed converter failure — the wizard maps `.code` to a specific message. */
export class ConvertError extends Error {
  readonly code: ConvertErrorCode;
  constructor(code: ConvertErrorCode, message: string) {
    super(message);
    this.name = "ConvertError";
    this.code = code;
  }
}

/** Human-facing copy per error code (used by the import wizard's error slot). */
export function convertErrorMessage(code: ConvertErrorCode): string {
  switch (code) {
    case "unsupported_type":
      return "This file type isn't supported. Use PDF, Excel (.xlsx), CSV, HTML, TXT, XML, JSON, or markdown.";
    case "password_required":
      return "This PDF is password-protected. Enter its password or pick a saved statement-password profile.";
    case "wrong_password":
      return "That PDF password didn't work — check the saved profile or enter it manually.";
    case "corrupt_source":
      return "The file couldn't be read — it may be corrupt or not the format its extension claims.";
    case "pyodide_load_failed":
      return "Couldn't load the in-browser converter. Check your connection and try again.";
    case "pdf_service_error":
      return "The PDF conversion service is unavailable right now. Try again shortly.";
    case "convert_failed":
      return "Conversion failed. The file may be malformed.";
  }
}
