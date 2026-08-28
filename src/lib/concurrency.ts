// Bounded-concurrency write helper for per-row updates whose payloads genuinely differ per row (so
// grouping into a single `.in("id", chunk)` update, the pattern used elsewhere in this codebase for
// uniform updates, does not apply). Pure orchestration — `fn` owns the actual I/O.
export interface BoundedResult {
  completed: number;
  error: string | null;
}

/**
 * Runs `fn` over `items` in sequential chunks of `limit`, with `Promise.all` concurrency within each
 * chunk. Stops after the first chunk containing a failure (no further chunks are started); `completed`
 * counts only the writes that actually succeeded, so a caller can report an explicit partial-apply count
 * instead of an opaque bail.
 */
export async function runBounded<T>(
  items: T[],
  limit: number,
  fn: (item: T) => PromiseLike<{ error: string | null }>,
): Promise<BoundedResult> {
  let completed = 0;
  for (let i = 0; i < items.length; i += limit) {
    const chunk = items.slice(i, i + limit);
    const results = await Promise.all(chunk.map((item) => fn(item)));
    const firstError = results.find((r) => r.error !== null)?.error ?? null;
    completed += results.filter((r) => r.error === null).length;
    if (firstError) return { completed, error: firstError };
  }
  return { completed, error: null };
}
