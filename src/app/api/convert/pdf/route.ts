import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * Authenticated proxy to the Python PDF→markdown service (PyMuPDF4LLM). The browser sends the PDF, the
 * picked account's institution, and (for encrypted PDFs) the password it decrypted locally from a saved
 * bank_profile. We forward to CONVERT_SERVICE_URL, return the markdown, and persist NOTHING — the raw PDF
 * and password are used once by the service and discarded. This route never touches the database.
 */
export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const serviceUrl = process.env.CONVERT_SERVICE_URL;
  if (!serviceUrl) {
    return NextResponse.json(
      { error: "PDF conversion service is not configured (set CONVERT_SERVICE_URL).", code: "pdf_service_error" },
      { status: 503 },
    );
  }

  const form = await request.formData();
  const file = form.get("file");
  const institution = form.get("institution");
  if (!(file instanceof File) || typeof institution !== "string") {
    return NextResponse.json({ error: "file and institution are required" }, { status: 400 });
  }

  const upstream = new FormData();
  upstream.append("file", file, file.name);
  upstream.append("institution", institution);
  const password = form.get("password");
  if (typeof password === "string" && password) upstream.append("password", password);

  let res: Response;
  try {
    res = await fetch(`${serviceUrl.replace(/\/$/, "")}/convert/pdf`, { method: "POST", body: upstream });
  } catch (e) {
    return NextResponse.json(
      { error: `conversion service unreachable: ${(e as Error).message}`, code: "pdf_service_error" },
      { status: 502 },
    );
  }
  // Pass the service's status + body through unchanged (it carries { markdown } or { error, code }).
  const json = await res.json().catch(() => ({ error: "bad response from conversion service", code: "pdf_service_error" }));
  return NextResponse.json(json, { status: res.status });
}
