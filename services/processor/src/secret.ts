/**
 * The bearer secret check. Both values are hashed before the comparison,
 * so the comparison runs on equal-length digests whatever the inputs:
 * neither an early return nor the time taken says how long the secret is
 * or where it differs.
 */
import { createHash, timingSafeEqual } from "node:crypto";

export function secretsMatch(presented: string, expected: string): boolean {
  if (!expected) return false;
  const left = createHash("sha256").update(presented).digest();
  const right = createHash("sha256").update(expected).digest();
  return timingSafeEqual(left, right);
}

/** The token of an `Authorization: Bearer <token>` header, or "". */
export function bearerTokenOf(header: string | string[] | undefined): string {
  const value = Array.isArray(header) ? (header[0] ?? "") : (header ?? "");
  return value.startsWith("Bearer ") ? value.slice(7).trim() : "";
}
