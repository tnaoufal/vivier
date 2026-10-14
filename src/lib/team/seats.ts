/**
 * The seats rule, shared by the invite server function (refuses past the
 * limit) and the members page (shows "x / y seats"). `used` is what
 * seats_used() counts: members plus pending, unexpired invitations. The
 * plan card's bars (seats, CVs of the month) read their tone here too.
 */

/** True when one more seat can be taken. Anything unreadable counts as full. */
export function seatsAvailable(used: number, limit: number): boolean {
  if (!Number.isFinite(used) || !Number.isFinite(limit)) return false;
  return used >= 0 && used < limit;
}

/** How many seats remain, never below zero. */
export function seatsLeft(used: number, limit: number): number {
  if (!Number.isFinite(used) || !Number.isFinite(limit)) return 0;
  return Math.max(0, limit - used);
}

export type UsageTone = "primary" | "caution" | "negative";

/**
 * The colour of a usage bar: calm until four fifths of the limit,
 * caution from there, negative once the limit is reached. An unreadable
 * pair stays calm (a bar never alarms on a guess).
 */
export function usageTone(used: number, limit: number): UsageTone {
  if (!Number.isFinite(used) || !Number.isFinite(limit) || limit <= 0) return "primary";
  if (used >= limit) return "negative";
  if (used >= limit * 0.8) return "caution";
  return "primary";
}
