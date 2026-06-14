import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServer } from "@/lib/supabase/server";
import { isTxnInstitution, parseStatement } from "@/lib/ingest/dispatch";
import { categorize, type VendorRule } from "@/lib/ingest/rules";
import type { ImportResponse, WireStatement } from "@/lib/ingest/wire";

export const runtime = "nodejs";

/** Parse a statement server-side, reconcile, attach rule-suggested categories. Nothing is persisted here. */
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
  if (!isTxnInstitution(account.institution)) {
    return NextResponse.json({ error: `${account.institution} accounts don't use this importer — import broker holdings (Zerodha/Upstox) on the Holdings page, and UPI exports via the Enrich panel. This importer handles bank & credit-card statements.` }, { status: 400 });
  }

  const text = await file.text();
  let results;
  try {
    results = parseStatement(account.institution, text);
  } catch (e) {
    return NextResponse.json({ error: `parse failed: ${(e as Error).message}` }, { status: 422 });
  }

  const { data: ruleRows } = await supabase.from("vendor_rules")
    .select("priority,match_text,category:categories(name)").eq("active", true).order("priority");
  const rules: VendorRule[] = (ruleRows ?? []).map((r) => ({
    match: r.match_text as string,
    category: (r.category as unknown as { name: string }).name,
  }));

  const out: WireStatement[] = results.map((r) => ({
    accountName: account.name,
    institution: r.institution,
    periodStart: r.periodStart,
    periodEnd: r.periodEnd,
    reconciliation: r.reconciliation,
    warnings: r.warnings,
    transactions: r.transactions.map((t) => ({
      txnDate: t.txnDate,
      amountPaise: t.amountPaise,
      balanceAfterPaise: t.balanceAfterPaise ?? null,
      descriptionRaw: t.descriptionRaw,
      refNo: t.refNo ?? null,
      nativeType: t.nativeType ?? null,
      subAccount: t.subAccount ?? null,
      occurrence: t.occurrence,
      contentHash: t.contentHash,
      suggestedCategory: categorize(t.descriptionRaw, rules).category,
    })),
  }));

  const body: ImportResponse = { accountId: account.id, accountName: account.name, results: out };
  return NextResponse.json(body);
}
