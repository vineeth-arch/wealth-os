import { createSupabaseBrowser } from "@/lib/supabase/client";
import { buildUserCategoryUpdate, isKnownCategory } from "@/lib/recategorize";

/**
 * The single client-side category write, reused by the review table and the dashboard drill-downs.
 * Sets category_source='user' (a human decision overrides any rule/AI). Refuses a category id that
 * isn't in the taxonomy so we never persist a non-taxonomy category. RLS scopes the row to the user.
 */
export async function updateTxnCategory(
  id: string,
  categoryId: string,
  validIds: ReadonlySet<string>,
): Promise<{ error: string | null }> {
  if (!isKnownCategory(categoryId, validIds)) return { error: "category is not in the taxonomy" };
  const supabase = createSupabaseBrowser();
  const { error } = await supabase.from("transactions").update(buildUserCategoryUpdate(categoryId)).eq("id", id);
  return { error: error?.message ?? null };
}
