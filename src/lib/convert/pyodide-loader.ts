/**
 * Lazy, memoized Pyodide loader — CLIENT ONLY. Never import this at a component's module scope; call
 * getPyodide() inside the convert path so the ~15 MB runtime stays out of the initial bundle and SSR.
 * The WASM runtime is fetched from a CDN (or a self-hosted base via NEXT_PUBLIC_PYODIDE_BASE_URL); NO
 * statement data is transmitted — only engine code is downloaded, then everything runs on-device.
 *
 * FIDELITY NOTE: the pandas version is fixed by the Pyodide version below. The in-browser XLSX path
 * must reproduce the SBI fixture (## sheet / Unnamed / NaN); confirm via the offline Step-0 byte-diff
 * after pinning PYODIDE_VERSION to a build whose pandas matches the MarkItDown that made the fixtures.
 */

const PYODIDE_VERSION = "0.27.2";
const DEFAULT_BASE = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;
const BASE = (process.env.NEXT_PUBLIC_PYODIDE_BASE_URL || DEFAULT_BASE).replace(/\/?$/, "/");

export interface PyodideAPI {
  loadPackage(names: string | string[]): Promise<void>;
  runPythonAsync(code: string): Promise<unknown>;
  FS: { writeFile(path: string, data: Uint8Array, opts?: { encoding?: string }): void };
}

declare global {
  interface Window {
    loadPyodide?: (config: { indexURL: string }) => Promise<PyodideAPI>;
  }
}

let pyodidePromise: Promise<PyodideAPI> | null = null;

function injectScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector("script[data-pyodide]")) return resolve();
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.dataset.pyodide = "1";
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`failed to load ${src}`));
    document.head.appendChild(s);
  });
}

/** Resolve a ready Pyodide with pandas + the markdown deps installed. Memoized for the page session. */
export function getPyodide(): Promise<PyodideAPI> {
  if (pyodidePromise) return pyodidePromise;
  pyodidePromise = (async () => {
    await injectScript(`${BASE}pyodide.js`);
    if (!window.loadPyodide) throw new Error("loadPyodide unavailable after script load");
    const py = await window.loadPyodide({ indexURL: BASE });
    // pandas + openpyxl (xlsx engine) + beautifulsoup4 ship as Pyodide packages; micropip pulls markdownify.
    await py.loadPackage(["pandas", "openpyxl", "beautifulsoup4", "micropip"]);
    await py.runPythonAsync(`import micropip\nawait micropip.install("markdownify")`);
    return py;
  })().catch((e) => {
    pyodidePromise = null; // allow a retry after a transient load failure
    throw e;
  });
  return pyodidePromise;
}
