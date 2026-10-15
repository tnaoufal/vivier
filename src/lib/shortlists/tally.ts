/**
 * The arithmetic of a shortlist board, pure and tested on its own: the
 * three statuses in reading order, the items grouped by status (position
 * first, then the moment they were added), the counts per status, the
 * decisions a person may take from each status, and the thread's
 * message count per item. Nothing here decides anything: it counts what
 * people did and says which clicks apply next.
 */
import type { ShortlistItemStatus } from "@/lib/db/types";

export const ITEM_STATUSES: readonly ShortlistItemStatus[] = ["to_review", "retained", "dismissed"];

export function isItemStatus(value: unknown): value is ShortlistItemStatus {
  return value === "to_review" || value === "retained" || value === "dismissed";
}

/**
 * The two decisions that apply from each status, the first one the main
 * one; the current status is never offered (a person decides, never
 * re-decides the same thing).
 */
const NEXT_STATUSES: Record<ShortlistItemStatus, readonly ShortlistItemStatus[]> = {
  to_review: ["retained", "dismissed"],
  retained: ["dismissed", "to_review"],
  dismissed: ["retained", "to_review"],
};

export function decisionsFrom(status: ShortlistItemStatus): readonly ShortlistItemStatus[] {
  return NEXT_STATUSES[status];
}

/** The thread's messages per item, from rows that carry only the item id. */
export function countByItem(
  rows: readonly { shortlist_item_id: string | null }[],
): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of rows) {
    if (!row.shortlist_item_id) continue;
    map.set(row.shortlist_item_id, (map.get(row.shortlist_item_id) ?? 0) + 1);
  }
  return map;
}

export interface Orderable {
  position: number;
  created_at: string;
}

/** Reading order inside a column: position first, then the moment the item was added. */
export function compareItems(a: Orderable, b: Orderable): number {
  if (a.position !== b.position) return a.position - b.position;
  if (a.created_at < b.created_at) return -1;
  if (a.created_at > b.created_at) return 1;
  return 0;
}

export type Grouped<T> = Record<ShortlistItemStatus, T[]>;

/** The three columns of the board, each in reading order; a row with an unknown status is left out. */
export function groupByStatus<T extends Orderable & { status: string }>(
  items: readonly T[],
): Grouped<T> {
  const groups: Grouped<T> = { to_review: [], retained: [], dismissed: [] };
  for (const item of items) {
    if (isItemStatus(item.status)) groups[item.status].push(item);
  }
  for (const status of ITEM_STATUSES) groups[status].sort(compareItems);
  return groups;
}

export type StatusCounts = Record<ShortlistItemStatus, number>;

export function countByStatus(items: readonly { status: string }[]): StatusCounts {
  const counts: StatusCounts = { to_review: 0, retained: 0, dismissed: 0 };
  for (const item of items) {
    if (isItemStatus(item.status)) counts[item.status] += 1;
  }
  return counts;
}
