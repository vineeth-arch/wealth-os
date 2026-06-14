import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServer } from "@/lib/supabase/server";
import { parseUpstoxTaxReport } from "@/lib/ingest/parsers/upstox";

export const runtime = "nodejs";

/** Parse an Upstox tradewise tax report and return a realized-gains preview. Nothing is persisted here. */
export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const form = await request.formData();
  const file = form.get("file");
  const accountId = form.get("accountId");
  if (!(file instanceof File) || typeof accountId !== "string") {
    return NextResponse.json({ error: "file and accountId are required" }, { status: 400 });
  }

  const { data: account } = await supabase.from("accounts")
    .select("id,name,institution").eq("id", accountId).single();
  if (!account) return NextResponse.json({ error: "account not found" }, { status: 404 });
  if (account.institution !== "UPSTOX") {
    return NextResponse.json({ error: `tax report import expects an Upstox account, got ${account.institution}` }, { status: 400 });
  }

  let report;
  try {
    report = parseUpstoxTaxReport(Buffer.from(await file.arrayBuffer()));
  } catch (e) {
    return NextResponse.json({ error: `parse failed: ${(e as Error).message}` }, { status: 422 });
  }

  return NextResponse.json({ accountId: account.id, accountName: account.name, fileName: file.name, report });
}
