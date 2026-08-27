import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Constant-time string comparison for secret checks (audit FA-14). A plain `!==` on the raw
 * strings leaks timing information proportional to how many leading bytes match, which can be
 * used to brute-force a secret byte-by-byte. Comparing SHA-256 digests instead of the raw
 * strings gives `timingSafeEqual` two fixed-length (32-byte) buffers regardless of input length,
 * so there is no length-dependent branch or early-return to time either.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  const digestA = createHash("sha256").update(a).digest();
  const digestB = createHash("sha256").update(b).digest();
  return timingSafeEqual(digestA, digestB);
}
