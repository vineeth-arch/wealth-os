import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServer } from "@/lib/supabase/server";
import { parseHdfcLoanSchedule } from "@/lib/ingest/parsers/hdfc-loan";

export const runtime = "nodejs";

/**
 * Import an HDFC loan repayment schedule. The file is re-parsed server-side (deterministic — money
 * never round-trips through the client), a `source='imported'` loan is created from the metadata,
 * and the actual schedule rows are stored verbatim. No transactions are created: forward-dated EMIs
 * become transactions only when they appear on a bank statement.
 */
export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const form = await request.formData();
  const file = form.get("file");
  const accountId = form.get("accountId");
  const emiCategory = form.get("emiCategory");
  if (!(file instanceof File)) return NextResponse.json({ error: "file is required" }, { status: 400 });

  let sched;
  try {
    sched = parseHdfcLoanSchedule(await file.text());
  } catch (e) {
    return NextResponse.json({ error: `parse failed: ${(e as Error).message}` }, { status: 422 });
  }
  if (!sched.reconciliation.ok) {
    return NextResponse.json({ error: `schedule did not reconcile: ${sched.reconciliation.detail}` }, { status: 422 });
  }

  const name = `HDFC ${sched.loanType} ${sched.agreementNo}`.replace(/\s+/g, " ").trim();
  const { data: loan, error: loanErr } = await supabase.from("loans").insert({
    user_id: user.id,
    name,
    kind: sched.kind,
    principal_paise: sched.amountFinancedPaise,
    annual_rate_pct: sched.approxAnnualRatePct,   // approx, backed out from the schedule
    tenure_months: sched.tenureMonths,
    start_date: sched.firstDueDate,
    account_id: typeof accountId === "string" && accountId ? accountId : null,
    emi_category: typeof emiCategory === "string" && emiCategory ? emiCategory : null,
    source: "imported",
  }).select("id").single();
  if (loanErr) return NextResponse.json({ error: loanErr.message }, { status: loanErr.code === "23505" ? 409 : 500 });

  const scheduleRows = sched.rows.map((r) => ({
    user_id: user.id,
    loan_id: loan.id,
    instl_no: r.instlNo,
    due_date: r.dueDate,
    instl_paise: r.instlPaise,
    principal_paise: r.principalPaise,
    interest_paise: r.interestPaise,
    os_principal_paise: r.osPrincipalPaise,
  }));
  const { error: rowsErr } = await supabase.from("loan_schedule_rows").insert(scheduleRows);
  if (rowsErr) {
    await supabase.from("loans").delete().eq("id", loan.id).eq("user_id", user.id);   // roll back the orphan loan
    return NextResponse.json({ error: rowsErr.message }, { status: 500 });
  }

  return NextResponse.json({ id: loan.id, name, installments: sched.rows.length, approxAnnualRatePct: sched.approxAnnualRatePct });
}
