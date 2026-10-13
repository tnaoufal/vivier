/**
 * The seats rule, shared by the invite server function (refuses past the
 * limit) and the members page (shows "x / y seats"). `used` is what
 * seats_used() counts: members plus pending, unexpired invitations.
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
