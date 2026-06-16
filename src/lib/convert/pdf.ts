/**
 * Client side of server PDF conversion. Sends the PDF (+ decrypted password, if any) and the chosen
 * account's institution to the authenticated Next proxy /api/convert/pdf, which forwards to the Python
 * PyMuPDF4LLM service and returns markdown. The PDF + password are used once server-side and never stored.
 */
import { ConvertError, type ConvertResult } from "./types";

export async function convertPdf(file: File, institution: string, password?: string): Promise<ConvertResult> {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("institution", institution);
  if (password) fd.append("password", password);

  let res: Response;
  try {
    res = await fetch("/api/convert/pdf", { method: "POST", body: fd });
  } catch (e) {
    throw new ConvertError("pdf_service_error", (e as Error).message);
  }

  const json = (await res.json().catch(() => ({}))) as { markdown?: string; error?: string; code?: string };
  if (!res.ok) {
    if (json.code === "wrong_password") throw new ConvertError("wrong_password", json.error ?? "wrong PDF password");
    if (json.code === "password_required") throw new ConvertError("password_required", json.error ?? "password required");
    if (json.code === "corrupt_source") throw new ConvertError("corrupt_source", json.error ?? "could not read PDF");
    throw new ConvertError("pdf_service_error", json.error ?? `PDF conversion failed (${res.status})`);
  }
  return { markdown: json.markdown ?? "", sourceKind: "pdf", usedPassword: Boolean(password) };
}
