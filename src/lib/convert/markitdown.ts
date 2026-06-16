/**
 * In-browser conversion of NON-PDF sources to markdown (CLIENT ONLY), reproducing MarkItDown's output
 * with Pyodide. PDFs are handled server-side (see pdf.ts) — never here.
 *
 * Only the XLSX path has a calibrated parser today (SBI), so it must match MarkItDown's XlsxConverter
 * exactly: per sheet, `## {sheet}` then markdownify(DataFrame.to_html(index=False)). The csv/json/xml/
 * html/txt paths have NO calibrated parser yet, so a reasonable MarkItDown-like rendering is acceptable.
 *
 * VALIDATE the XLSX output against the committed SBI fixture in the offline Step-0 byte-diff before
 * relying on it — the gate parses the committed markdown and does NOT exercise this converter.
 */
import { getPyodide } from "./pyodide-loader";
import { ConvertError, type ConvertResult, type SourceKind } from "./types";

// Embedded Python driver. Mirrors MarkItDown's converters for the formats we accept in-browser.
const DRIVER = `
import pandas as pd
from markdownify import markdownify as _md
import json as _json

def convert_xlsx(path):
    sheets = pd.read_excel(path, sheet_name=None)  # default header=0 -> 'Unnamed: N' for blank headers
    parts = []
    for name, df in sheets.items():
        parts.append("## " + str(name))
        parts.append(_md(df.to_html(index=False)))
    return "\\n".join(parts).strip() + "\\n"

def convert_csv(path):
    df = pd.read_csv(path)
    return _md(df.to_html(index=False)).strip() + "\\n"

def convert_text(path):
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        return f.read()

def convert_json(path):
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        raw = f.read()
    try:
        return "\\n\`\`\`json\\n" + _json.dumps(_json.loads(raw), indent=2, ensure_ascii=False) + "\\n\`\`\`\\n"
    except Exception:
        return raw

def convert_html(path):
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        return _md(f.read()).strip() + "\\n"

def convert(path, kind):
    if kind == "xlsx": return convert_xlsx(path)
    if kind == "csv":  return convert_csv(path)
    if kind == "json": return convert_json(path)
    if kind == "html": return convert_html(path)
    return convert_text(path)  # txt, xml
`;

let driverLoaded = false;

/** Convert an XLSX/CSV/HTML/XML/JSON file to markdown entirely in the browser. */
export async function convertNonPdf(file: File, kind: SourceKind): Promise<ConvertResult> {
  let py;
  try {
    py = await getPyodide();
  } catch (e) {
    throw new ConvertError("pyodide_load_failed", (e as Error).message);
  }
  try {
    if (!driverLoaded) {
      await py.runPythonAsync(DRIVER);
      driverLoaded = true;
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const path = "/tmp/source";
    py.FS.writeFile(path, bytes);
    const markdown = (await py.runPythonAsync(`convert(${JSON.stringify(path)}, ${JSON.stringify(kind)})`)) as string;
    return { markdown, sourceKind: kind, usedPassword: false };
  } catch (e) {
    throw new ConvertError("convert_failed", (e as Error).message);
  }
}
