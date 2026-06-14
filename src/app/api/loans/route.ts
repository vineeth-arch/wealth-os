import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

const KINDS = ["home", "vehicle", "personal", "education", "business", "other"] as const;

interface LoanBody {
  name: string;
  kind: string;
  principalPaise: number;
  annualRatePct: number;
  tenureMonths: number;
  startDate: string;        // ISO yyyy-mm-dd
  accountId?: string | null;
  emiCategory?: string | null;
}

/** Validate + normalize a loan payload. Money stays integer paise; the UI may only edit these fields. */
function parseLoan(body: unknown): { row: Omit<LoanBody, never> } | { error: string } {
  const b = body as Partial<LoanBody> | null;
  if (!b || typeof b.name !== "string" || !b.name.trim()) return { error: "name is required" };
  if (typeof b.kind !== "string" || !KINDS.includes(b.kind as (typeof KINDS)[number])) return { error: "kind is invalid" };
  if (!Number.isInteger(b.principalPaise) || (b.principalPaise as number) <= 0) return { error: "principalPaise must be a positive integer" };
  if (typeof b.annualRatePct !== "number" || !Number.isFinite(b.annualRatePct) || b.annualRatePct < 0) return { error: "annualRatePct must be ≥ 0" };
  if (!Number.isInteger(b.tenureMonths) || (b.tenureMonths as number) <= 0) return { error: "tenureMonths must be a positive integer" };
  if (typeof b.startDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(b.startDate)) return { error: "startDate must be yyyy-mm-dd" };
  return {
    row: {
      name: b.name.trim(), kind: b.kind, principalPaise: b.principalPaise as number,
      annualRatePct: b.annualRatePct, tenureMonths: b.tenureMonths as number, startDate: b.startDate,
      accountId: b.accountId ?? null, emiCategory: b.emiCategory ?? null,
    },
  };
}

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = parseLoan(await request.json().catch(() => null));
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const r = parsed.row;

  const { data, error } = await supabase.from("loans").insert({
    user_id: user.id, name: r.name, kind: r.kind, principal_paise: r.principalPaise,
    annual_rate_pct: r.annualRatePct, tenure_months: r.tenureMonths, start_date: r.startDate,
    account_id: r.accountId, emi_category: r.emiCategory,
  }).select("id").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ id: data.id });
}
