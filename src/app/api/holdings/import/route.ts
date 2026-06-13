import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServer } from "@/lib/supabase/server";
import { parseZerodhaHoldings } from "@/lib/ingest/parsers/market";

export const runtime = "nodejs";

/** Parse a Zerodha holdings workbook server-side and return a preview. Nothing is persisted here. */
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
    .select("id,name,institution,kind").eq("id", accountId).single();
  if (!account) return NextResponse.json({ error: "account not found" }, { status: 404 });
  if (account.institution !== "ZERODHA") {
    return NextResponse.json({ error: `holdings import expects a Zerodha (broker) account, got ${account.institution}` }, { status: 400 });
  }

  let snapshot;
  try {
    snapshot = parseZerodhaHoldings(Buffer.from(await file.arrayBuffer()));
  } catch (e) {
    return NextResponse.json({ error: `parse failed: ${(e as Error).message}` }, { status: 422 });
  }

  return NextResponse.json({ accountId: account.id, accountName: account.name, fileName: file.name, snapshot });
}
