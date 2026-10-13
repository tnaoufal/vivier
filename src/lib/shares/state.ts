/**
 * What a share row is right now: active, expired or revoked, computed
 * the same way on the server (getShare, the CV route) and in the panel.
 * Also the expiry a new share gets from the days the person chose.
 */
import type { ShareRow } from "@/lib/db/types";

export type ShareState = "active" | "expired" | "revoked";

export type ShareTiming = Pick<ShareRow, "expires_at" | "revoked_at">;

/** Revoked wins over expired: a revoked link says so even after its date. */
export function shareState(row: ShareTiming, now: number = Date.now()): ShareState {
  if (row.revoked_at) return "revoked";
  const expires = new Date(row.expires_at).getTime();
  if (Number.isNaN(expires) || expires <= now) return "expired";
  return "active";
}

export const EXPIRY_CHOICES = [7, 14, 30] as const;
export type ExpiryDays = (typeof EXPIRY_CHOICES)[number];
export const DEFAULT_EXPIRY_DAYS: ExpiryDays = 14;
export const EXPIRY_MIN_DAYS = 1;
export const EXPIRY_MAX_DAYS = 30;

export function isExpiryDays(value: number): value is ExpiryDays {
  return (EXPIRY_CHOICES as readonly number[]).includes(value);
}

/** The ISO instant `days` days from now, clamped to the 1..30 the server accepts. */
export function expiresAtFrom(days: number, now: number = Date.now()): string {
  const clamped = Math.min(EXPIRY_MAX_DAYS, Math.max(EXPIRY_MIN_DAYS, Math.round(days)));
  return new Date(now + clamped * 86_400_000).toISOString();
}
