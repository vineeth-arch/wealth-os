/**
 * Bounded-concurrency runner for per-row DB writes whose payloads DIFFER row to row
 * (audit FA-7). The enrichment apply loops write a distinct notes/ref/category per
 * transaction, so the usual "group identical values + chunked .in()" trick (see
 * rules/apply, enrich) degenerates to singleton groups — the honest speedup is to keep
 * per-row statements but run a bounded number in flight instead of strictly one.
 *
 * Semantics match the sequential loops this replaces: stop scheduling on the first
 * error (in-flight tasks finish), report how many succeeded. `limit` stays modest —
 * every task holds a pooled Postgres connection.
 */

export const DEFAULT_WRITE_CONCURRENCY = 20;

export async function runBounded<T>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<string | null>,
): Promise<{ done: number; error: string | null }> {
  let next = 0;
  let done = 0;
  let firstError: string | null = null;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (firstError === null) {
      const i = next++;
      if (i >= items.length) break;
      const err = await task(items[i]);
      if (err !== null) {
        if (firstError === null) firstError = err;
        break;
      }
      done++;
    }
  });
  await Promise.all(workers);
  return { done, error: firstError };
}
