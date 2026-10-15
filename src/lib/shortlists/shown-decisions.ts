/**
 * A decision on screen before the board's read confirms it, pure and
 * tested: the row says it at once as the person's own (who, now, as
 * the database will stamp it), and it gives way to the first read that
 * shows it, or to a read that started once the write was stored (the
 * truth, whatever it says). A read already under way when the person
 * clicked never puts the old status back, and a decision a colleague
 * took after the write never hides behind the one shown.
 */
import type { ShortlistItemRow, ShortlistItemStatus } from "@/lib/db/types";

/** The decision shown on an item: the status, who took it and when, and the write's number once it is stored (null while it is sent). */
export interface ShownDecision {
  status: ShortlistItemStatus;
  by: string | null;
  at: string;
  write: number | null;
}

/** The decisions still shown over a read (the same map when none gave way); `after` is how many writes were stored when the read started. */
export function unsettledDecisions(
  shown: ReadonlyMap<string, ShownDecision>,
  read: { items: readonly Pick<ShortlistItemRow, "id" | "status">[]; after: number },
): ReadonlyMap<string, ShownDecision> {
  if (shown.size === 0) return shown;
  const statusOf = new Map(read.items.map((item) => [item.id, item.status] as const));
  let next: Map<string, ShownDecision> | null = null;
  for (const [id, entry] of shown) {
    const settled =
      statusOf.get(id) === entry.status || (entry.write !== null && read.after >= entry.write);
    if (!settled) continue;
    next ??= new Map(shown);
    next.delete(id);
  }
  return next ?? shown;
}

/** The items as the rows show them: a decision still shown stands in place of the status read, with who took it and when. */
export function withShownDecisions<
  T extends Pick<ShortlistItemRow, "id" | "status" | "decided_by" | "decided_at">,
>(items: readonly T[], shown: ReadonlyMap<string, ShownDecision>): readonly T[] {
  if (shown.size === 0) return items;
  return items.map((item) => {
    const entry = shown.get(item.id);
    return entry && entry.status !== item.status
      ? { ...item, status: entry.status, decided_by: entry.by, decided_at: entry.at }
      : item;
  });
}
