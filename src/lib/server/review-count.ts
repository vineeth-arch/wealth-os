// Single source of truth for "how many transactions are still Uncategorized Review" — used by BOTH
// the /transactions Review panel header and the dashboard tile, so the two numbers can never disagree
// (they previously used two different, inconsistent formulas).
import { FALLBACK_CATEGORY } from "@/lib/ingest/rules";
import type { createSupabaseServer } from "@/lib/supabase/server";

type Supa = Awaited<ReturnType<typeof createSupabaseServer>>;

export interface ReviewCount {
  reviewCategoryId: string;
  count: number;
}

export async function countUncategorized(supabase: Supa): Promise<ReviewCount> {
  const { data: cat } = await supabase.from("categories").select("id").eq("name", FALLBACK_CATEGORY).maybeSingle();
  const reviewCategoryId = (cat?.id as string | undefined) ?? "";
  if (!reviewCategoryId) return { reviewCategoryId, count: 0 };
  const { count } = await supabase.from("transactions")
    .select("id", { count: "exact", head: true }).eq("category_id", reviewCategoryId);
  return { reviewCategoryId, count: count ?? 0 };
}
