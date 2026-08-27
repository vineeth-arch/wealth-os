/**
 * Postgres error code for `unique_violation` (https://www.postgresql.org/docs/current/errcodes-appendix.html).
 * Used to distinguish "another concurrent request already inserted this row" (benign — the
 * unique constraint IS the idempotency guard) from a real failure (audit FA-8).
 */
const UNIQUE_VIOLATION = "23505";

export function isUniqueViolation(error: { code?: string | null } | null | undefined): boolean {
  return error?.code === UNIQUE_VIOLATION;
}
