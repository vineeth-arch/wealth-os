"""
wealth-os PDF→markdown conversion service.

PDFs are the one statement format that can't be converted in the browser (PyMuPDF has no working
Pyodide/WASM install). This tiny FastAPI service runs the SAME native PyMuPDF4LLM that produced the
committed fixtures, so its markdown byte-matches what the parsers in src/lib/ingest/parsers/ expect.

Privacy: the uploaded PDF bytes and the (optional) password live in memory only, are used once to
convert, and are never written to disk, logged, or stored. There is no database here.

Run locally:   uvicorn main:app --host 0.0.0.0 --port 8000
Then set       CONVERT_SERVICE_URL=http://localhost:8000   in the Next app's env.
"""
from fastapi import FastAPI, UploadFile, File, Form
from fastapi.responses import JSONResponse

import fitz  # PyMuPDF
import pymupdf4llm

app = FastAPI(title="wealth-os convert", version="1")

# Per-institution conversion profile — mirror the engine you used in Private Markdown Converter for each
# statement. "markdown" = pymupdf4llm.to_markdown (pipe-tables); "text" = plain page.get_text (HDFC).
# Determined/confirmed by the offline Step-0 byte-diff against fixtures/.
INSTITUTION_PROFILE = {
    "FEDERAL": "markdown",
    "IDFC_BANK": "markdown",
    "IDFC_CC": "markdown",
    "SURYODAY_CC": "markdown",
    "HDFC": "text",
}
DEFAULT_PROFILE = "markdown"


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/convert/pdf")
async def convert_pdf(
    file: UploadFile = File(...),
    institution: str = Form(...),
    password: str = Form(""),
):
    data = await file.read()
    try:
        doc = fitz.open(stream=data, filetype="pdf")
    except Exception as e:  # noqa: BLE001 - surface any open failure as a typed client error
        return JSONResponse(status_code=422, content={"error": f"could not open PDF: {e}", "code": "corrupt_source"})

    try:
        if doc.needs_pass:
            if not password:
                return JSONResponse(status_code=401, content={"error": "password required", "code": "password_required"})
            if not doc.authenticate(password):  # 0 == failure
                return JSONResponse(status_code=401, content={"error": "wrong password", "code": "wrong_password"})

        profile = INSTITUTION_PROFILE.get(institution, DEFAULT_PROFILE)
        if profile == "text":
            markdown = "\n".join(page.get_text() for page in doc)
        else:
            markdown = pymupdf4llm.to_markdown(doc)
        return {"markdown": markdown}
    except Exception as e:  # noqa: BLE001
        return JSONResponse(status_code=500, content={"error": f"conversion failed: {e}", "code": "convert_failed"})
    finally:
        doc.close()
