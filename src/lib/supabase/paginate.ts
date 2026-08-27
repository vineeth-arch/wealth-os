/**
 * Drains a Supabase query past PostgREST's hard 1000-row response cap (audit FA-1). A plain
 * `.select()` silently truncates at 1000 rows with no error — on `transactions` that means net
 * worth, cash flow, and every dashboard total quietly go wrong on any ledger past ~1000 rows,
 * with nothing in the response to signal it happened.
 *
 * `queryPage` must apply its own stable `.order(...)` before `.range(from, to)` — pagination over
 * an unordered result can skip or repeat rows across pages. All-or-nothing on error: a failure on
 * any page discards whatever was already accumulated and returns the error, rather than silently
 * returning a partial read that looks complete.
 */

export const DEFAULT_PAGE_SIZE = 1000;

export interface PageResult<T> {
  rows: T[];
  error: string | null;
}

export async function fetchAllRows<T>(
  queryPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  pageSize: number = DEFAULT_PAGE_SIZE,
): Promise<PageResult<T>> {
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await queryPage(from, from + pageSize - 1);
    if (error) return { rows: [], error: error.message };
    const page = data ?? [];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return { rows, error: null };
}
