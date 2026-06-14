import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServer } from "@/lib/supabase/server";
import { parseZerodhaHoldings } from "@/lib/ingest/parsers/market";
import { parseUpstoxHoldings } from "@/lib/ingest/parsers/upstox";

export const runtime = "nodejs";

const HOLDINGS_BROKERS = ["ZERODHA", "UPSTOX"];

/** Parse a broker holdings workbook server-side and return a preview. Nothing is persisted here. */
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
  if (!HOLDINGS_BROKERS.includes(account.institution)) {
    return NextResponse.json({ error: `holdings import expects a broker account (Zerodha/Upstox), got ${account.institution}` }, { status: 400 });
  }

  let snapshot;
  try {
    const buf = Buffer.from(await file.arrayBuffer());
    snapshot = account.institution === "UPSTOX" ? parseUpstoxHoldings(buf) : parseZerodhaHoldings(buf);
  } catch (e) {
    return NextResponse.json({ error: `parse failed: ${(e as Error).message}` }, { status: 422 });
  }

  return NextResponse.json({ accountId: account.id, accountName: account.name, fileName: file.name, snapshot });
}
