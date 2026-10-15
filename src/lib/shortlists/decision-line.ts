/**
 * What the shortlist says of a decision, pure and tested: the filter of
 * the shortlist's rows (all, to examine, retained, dismissed), the line
 * a row ends with (who retains or dismisses, read off decided_by and
 * decided_at; "to examine" otherwise), and the trace the detail shows
 * (the decision with who and when, a profile put back under review,
 * else who added it and when). A name is never guessed: the ids are
 * answered, the caller names the members.
 */
import type { ShortlistItemRow, ShortlistItemStatus } from "@/lib/db/types";

import { isItemStatus } from "./tally";

export type ShortlistFilter = "all" | ShortlistItemStatus;

export const SHORTLIST_FILTERS: readonly ShortlistFilter[] = [
  "all",
  "to_review",
  "retained",
  "dismissed",
];

export function isShortlistFilter(value: unknown): value is ShortlistFilter {
  return value === "all" || isItemStatus(value);
}

/** The rows the filter keeps, in the order given. */
export function filterItems<T extends { status: string }>(
  items: readonly T[],
  filter: ShortlistFilter,
): T[] {
  if (filter === "all") return [...items];
  return items.filter((item) => item.status === filter);
}

export type DecisionLine =
  | { kind: "retained" | "dismissed"; by: string | null; at: string | null }
  | { kind: "toReview" };

/** The end of a row's line: who retains or dismisses the profile, or that it is still to examine. */
export function decisionLineOf(
  item: Pick<ShortlistItemRow, "status" | "decided_by" | "decided_at">,
): DecisionLine {
  if (item.status === "retained" || item.status === "dismissed")
    return { kind: item.status, by: item.decided_by ?? null, at: item.decided_at ?? null };
  return { kind: "toReview" };
}

export interface DecisionTrace {
  kind: "retained" | "dismissed" | "reviewed" | "added";
  by: string | null;
  at: string;
}

/** The detail's trace: the decision taken (who, when), a profile put back under review (who, when), else who added it and when. */
export function decisionTraceOf(
  item: Pick<ShortlistItemRow, "status" | "decided_by" | "decided_at" | "added_by" | "created_at">,
): DecisionTrace {
  if (item.decided_at) {
    const kind =
      item.status === "retained" || item.status === "dismissed" ? item.status : "reviewed";
    return { kind, by: item.decided_by ?? null, at: item.decided_at };
  }
  return { kind: "added", by: item.added_by ?? null, at: item.created_at };
}
