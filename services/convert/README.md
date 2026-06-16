# wealth-os PDF conversion service

A tiny FastAPI service that converts PDF bank/credit-card statements to markdown using **PyMuPDF4LLM** —
the same native engine that produced the PDF fixtures, so its output matches the parsers in
`src/lib/ingest/parsers/`. PDFs can't be converted in the browser (PyMuPDF has no working Pyodide/WASM
build), so this is the server half of the hybrid converter; everything else (XLSX/CSV/TXT/XML/JSON)
converts in the browser via Pyodide.

## Privacy

The uploaded PDF bytes and any password live **in memory only**, are used once to convert, and are
**never written to disk, logged, or stored**. There is no database. Only the resulting markdown is
returned to the Next app, which is exactly what the user used to paste in manually.

## Run locally

```bash
cd services/convert
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000
```

Then point the Next app at it:

```bash
# .env.local
CONVERT_SERVICE_URL=http://localhost:8000
```

## Deploy

Build the container and deploy to any host (a scale-to-zero host keeps idle cost ~$0):

```bash
docker build -t wealth-os-convert services/convert
```

Set `CONVERT_SERVICE_URL` in the Next app's production env to the deployed URL.

## Fidelity (do this before trusting it)

1. Pin `PyMuPDF` / `pymupdf4llm` in `requirements.txt` to the exact versions from your Private Markdown
   Converter venv (`pip freeze`).
2. Confirm `INSTITUTION_PROFILE` in `main.py` matches the engine/mode you used per statement
   (`markdown` = pymupdf4llm tables; `text` = plain `get_text`, e.g. HDFC).
3. Run the Step-0 byte-diff: convert a real source PDF and compare against its committed `fixtures/*.md`.
   Because this is the same native engine + version, it should match byte-for-byte.

## API

`POST /convert/pdf` (multipart): `file` (PDF), `institution` (e.g. `FEDERAL`), optional `password`.
Returns `{ "markdown": "..." }`, or `{ "error", "code" }` with a 4xx/5xx where
`code ∈ password_required | wrong_password | corrupt_source | convert_failed`.
