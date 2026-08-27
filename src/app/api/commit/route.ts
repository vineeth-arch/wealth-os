import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServer } from "@/lib/supabase/server";
import { finalizeHashes } from "@/lib/ingest/util";
import type { CommitRequest } from "@/lib/ingest/wire";

export const runtime = "nodejs";

/**
 * Persists reviewed transactions. Trust boundary — stated precisely (audit FA-5):
 * - Server-authoritative: every category is re-validated against the user's taxonomy; the
 *   content hash + occurrence are re-derived here (the client cannot set them); dedup is a
 *   DB unique index on (account_id, content_hash), so re-importing overlap inserts nothing.
 * - Client-trusted: amountPaise/txnDate/descriptionRaw are ECHOED BACK from the client's
 *   CommitRequest, not re-parsed from the source file — the hash is derived over client
 *   values. `reconciled` compares two client-supplied numbers (Σ rows vs expectedDelta) and
 *   is STORED on the imports row, not enforced; a non-reconciling statement still commits.
 * In the intended flow the client forwards /api/import output untouched, so these hold in
 * practice — but a tampered request commits what it sends. Re-parsing the source server-side
 * (making the documented boundary real) is a recorded follow-up, not current behavior.
 */
export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as CommitRequest | null;
  if (!body?.accountId || !Array.isArray(body.statements)) {
    return NextResponse.json({ error: "accountId and statements are required" }, { status: 400 });
  }

  const { data: account } = await supabase.from("accounts")
    .select("id,name,anchor_balance_paise,anchor_date").eq("id", body.accountId).eq("user_id", user.id).single();
  if (!account) return NextResponse.json({ error: "account not found" }, { status: 404 });

  const { data: cats } = await supabase.from("categories").select("id,name").eq("user_id", user.id);
  const catId = new Map<string, string>((cats ?? []).map((c) => [c.name as string, c.id as string]));

  let totalInserted = 0;
  let totalDuplicate = 0;
  let anchorDate = account.anchor_date as string | null;
  let anchorOpening = account.anchor_balance_paise as number | null;

  for (const st of body.statements) {
    for (const r of st.rows) {
      if (!catId.has(r.categoryName)) {
        return NextResponse.json({ error: `unknown category "${r.categoryName}" — run workspace setup first` }, { status: 422 });
      }
    }

    // server-authoritative occurrence + content hash
    const finalized = finalizeHashes(account.name, st.rows.map((r) => ({
      txnDate: r.txnDate,
      descriptionRaw: r.descriptionRaw,
      amountPaise: r.amountPaise,
      balanceAfterPaise: r.balanceAfterPaise ?? undefined,
      refNo: r.refNo ?? undefined,
      nativeType: r.nativeType ?? undefined,
      subAccount: r.subAccount ?? undefined,
    })));

    const parsedSum = finalized.reduce((s, t) => s + t.amountPaise, 0);
    const reconciled = st.expectedDeltaPaise === null ? true : st.expectedDeltaPaise === parsedSum;

    const { data: imp, error: impErr } = await supabase.from("imports").insert({
      user_id: user.id,
      account_id: body.accountId,
      file_name: st.fileName,
      institution: st.institution,
      period_start: st.periodStart,
      period_end: st.periodEnd,
      opening_paise: st.openingPaise,
      closing_paise: st.closingPaise,
      expected_delta_paise: st.expectedDeltaPaise,
      parsed_sum_paise: parsedSum,
      reconciled,
      parsed_count: finalized.length,
      inserted_count: 0,
      duplicate_count: 0,
      warnings: [],
    }).select("id").single();
    if (impErr) return NextResponse.json({ error: `import row: ${impErr.message}` }, { status: 500 });

    const txnRows = finalized.map((t, i) => ({
      user_id: user.id,
      account_id: body.accountId,
      import_id: imp!.id,
      txn_date: t.txnDate,
      amount_paise: t.amountPaise,
      balance_after_paise: t.balanceAfterPaise ?? null,
      description_raw: t.descriptionRaw,
      category_id: catId.get(st.rows[i].categoryName)!,
      category_source: st.rows[i].categoryName === "Uncategorized Review" ? "default" : "user",
      tags: st.rows[i].tags,
      ref_no: t.refNo ?? null,
      native_type: t.nativeType ?? null,
      sub_account: t.subAccount ?? null,
      content_hash: t.contentHash,
      occurrence: t.occurrence,
    }));

    const { data: inserted, error: insErr } = await supabase.from("transactions")
      .upsert(txnRows, { onConflict: "account_id,content_hash", ignoreDuplicates: true })
      .select("id");
    if (insErr) return NextResponse.json({ error: `transactions: ${insErr.message}` }, { status: 500 });

    const insertedCount = inserted?.length ?? 0;
    const dupCount = txnRows.length - insertedCount;
    totalInserted += insertedCount;
    totalDuplicate += dupCount;

    await supabase.from("imports").update({ inserted_count: insertedCount, duplicate_count: dupCount }).eq("id", imp!.id);

    if (st.openingPaise !== null && st.periodStart && (anchorDate === null || st.periodStart < anchorDate)) {
      anchorDate = st.periodStart;
      anchorOpening = st.openingPaise;
    }
  }

  if (anchorDate && anchorOpening !== null && (anchorDate !== account.anchor_date || anchorOpening !== account.anchor_balance_paise)) {
    await supabase.from("accounts").update({ anchor_balance_paise: anchorOpening, anchor_date: anchorDate }).eq("id", body.accountId);
  }

  return NextResponse.json({ inserted: totalInserted, duplicate: totalDuplicate, statements: body.statements.length });
}
