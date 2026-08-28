// Drains a Supabase offset-paginated query past the 1000-row cap. Pure (IO is injected via the
// `page` callback), so it's importable in scripts/verify.ts without pulling in next/* or @supabase/ssr.
export const PAGE_SIZE = 1000;

export interface PageResult<Row> { data: Row[] | null; error: { message: string } | null }

/**
 * `page(from, to)` must be a FRESH query builder call per page (Supabase builders are single-use
 * thenables) ending in a total order — by convention `.order("id")` as the last/tie-break clause, so
 * offset pages can't duplicate or drop rows. Throws on the first page error (callers wrap in try/catch
 * to preserve their existing error-response shape).
 */
export async function fetchAllRows<Row>(
  page: (from: number, to: number) => PromiseLike<PageResult<Row>>,
  pageSize: number = PAGE_SIZE,
): Promise<Row[]> {
  const rows: Row[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await page(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < pageSize) return rows;
  }
}
