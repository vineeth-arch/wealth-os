import { NextResponse } from "next/server";
import { createSupabaseService } from "@/lib/supabase/service";
import { refreshPrices } from "@/lib/prices";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Single daily cron (Vercel `vercel.json`). Rationale: Supabase free pauses at 7 days idle (any DB hit
 * resets it → daily is a safe buffer); Hobby crons run at most once/day. So one daily entry point does
 * BOTH jobs — keepalive every run, price refresh gated to one weekday inside the handler.
 *
 * Auth: Vercel auto-provisions CRON_SECRET and sends `Authorization: Bearer <secret>`. The same value
 * lets you curl this route locally.
 */
const REFRESH_DOW = 0; // Sunday (UTC). Flip the day here without touching the cron schedule.

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new NextResponse("unauthorized", { status: 401 });
  }

  const svc = createSupabaseService();

  // Keepalive (every run): a trivial read resets Supabase's inactivity timer.
  const { error: kaErr } = await svc.from("price_sources").select("id", { head: true, count: "exact" });

  // Weekly price refresh, gated inside the daily cron.
  const refresh = new Date().getUTCDay() === REFRESH_DOW;
  const result = refresh ? await refreshPrices(svc) : null;

  return NextResponse.json({ ok: true, keepalive: !kaErr, refresh, result });
}
