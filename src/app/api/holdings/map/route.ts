import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServer } from "@/lib/supabase/server";
import { createSupabaseService } from "@/lib/supabase/service";
import { deriveYahooSymbol } from "@/lib/holdings";

export const runtime = "nodejs";

/**
 * Human-in-the-loop instrument mapping (confirm-on-first-sight, like vendor rules). `instruments` is
 * reference data (service-role write), so we gate on ownership first: the user must actually hold the
 * ISIN (RLS user client) before the service client writes the source code.
 */
export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body?.isin || typeof body.isin !== "string") {
    return NextResponse.json({ error: "isin is required" }, { status: 400 });
  }

  const { data: owned } = await supabase.from("holdings_snapshots")
    .select("isin").eq("isin", body.isin).limit(1);
  if (!owned || owned.length === 0) {
    return NextResponse.json({ error: "you do not hold this instrument" }, { status: 403 });
  }

  const patch: Record<string, string | null> = {};
  if (typeof body.amfiSchemeCode === "string" && /^\d+$/.test(body.amfiSchemeCode.trim())) {
    patch.amfi_scheme_code = body.amfiSchemeCode.trim();
  }
  if (typeof body.yahooSymbol === "string" && body.yahooSymbol.trim()) {
    patch.yahoo_symbol = deriveYahooSymbol(body.yahooSymbol);
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "provide amfiSchemeCode (digits) or yahooSymbol" }, { status: 400 });
  }

  const svc = createSupabaseService();
  const { error } = await svc.from("instruments").update(patch).eq("isin", body.isin);
  if (error) return NextResponse.json({ error: `instruments: ${error.message}` }, { status: 500 });
  return NextResponse.json({ ok: true, isin: body.isin, ...patch });
}
