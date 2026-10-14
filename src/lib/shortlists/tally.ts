/**
 * The arithmetic of a shortlist, pure and tested on its own: vote
 * tallies with the caller's own vote, verdict counts of an explained
 * match, items grouped by status in reading order (position, then the
 * moment they were added), counts and assignees per shortlist for the
 * list page. Nothing here decides anything: it counts what people did.
 */
import type {
  BriefStatus,
  CriterionVerdict,
  MatchResult,
  ShortlistItemStatus,
  VoteRow,
} from "@/lib/db/types";

export const ITEM_STATUSES: readonly ShortlistItemStatus[] = ["to_review", "retained", "dismissed"];

export function isItemStatus(value: unknown): value is ShortlistItemStatus {
  return value === "to_review" || value === "retained" || value === "dismissed";
}

export type VoteValue = VoteRow["value"];

export interface VoteTally {
  up: number;
  down: number;
  /** The caller's own vote, null when they did not vote. */
  mine: VoteValue | null;
}

export const NO_VOTES: VoteTally = { up: 0, down: 0, mine: null };

/** Counts the votes of one item; `userId` marks which one is the caller's. */
export function tallyVotes(
  votes: readonly Pick<VoteRow, "user_id" | "value">[],
  userId: string | null,
): VoteTally {
  let up = 0;
  let down = 0;
  let mine: VoteValue | null = null;
  for (const vote of votes) {
    if (vote.value === 1) up += 1;
    else if (vote.value === -1) down += 1;
    else continue;
    if (userId !== null && vote.user_id === userId) mine = vote.value;
  }
  return { up, down, mine };
}

/** The votes of a whole shortlist, keyed by item. */
export function votesByItem<T extends Pick<VoteRow, "shortlist_item_id">>(
  votes: readonly T[],
): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const vote of votes) {
    const list = map.get(vote.shortlist_item_id);
    if (list) list.push(vote);
    else map.set(vote.shortlist_item_id, [vote]);
  }
  return map;
}

/** Comments per item, from rows that carry only the item id. */
export function countByItem(rows: readonly { shortlist_item_id: string | null }[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of rows) {
    if (!row.shortlist_item_id) continue;
    map.set(row.shortlist_item_id, (map.get(row.shortlist_item_id) ?? 0) + 1);
  }
  return map;
}

export const VERDICTS: readonly CriterionVerdict[] = ["match", "partial", "missing", "not_stated"];

export function isVerdict(value: unknown): value is CriterionVerdict {
  return value === "match" || value === "partial" || value === "missing" || value === "not_stated";
}

export type VerdictCounts = Record<CriterionVerdict, number>;

/** How many criteria got each verdict; null when the item has no match (added without a score). */
export function verdictCounts(match: Pick<MatchResult, "verdicts"> | null | undefined): VerdictCounts | null {
  if (!match || !Array.isArray(match.verdicts)) return null;
  const counts: VerdictCounts = { match: 0, partial: 0, missing: 0, not_stated: 0 };
  for (const result of match.verdicts) {
    if (result && isVerdict(result.verdict)) counts[result.verdict] += 1;
  }
  return counts;
}

/** The score as a whole number 0..100, or null when the match carries none. */
export function scorePercent(match: Pick<MatchResult, "score"> | null | undefined): number | null {
  if (!match || typeof match.score !== "number" || !Number.isFinite(match.score)) return null;
  return Math.round(Math.min(100, Math.max(0, match.score)));
}

/** The coverage (0..1 in the match) as a whole percentage, or null. */
export function coveragePercent(match: Pick<MatchResult, "coverage"> | null | undefined): number | null {
  if (!match || typeof match.coverage !== "number" || !Number.isFinite(match.coverage)) return null;
  return Math.round(Math.min(1, Math.max(0, match.coverage)) * 100);
}

export interface Orderable {
  position: number;
  created_at: string;
}

/** Reading order inside a section: position first, then the moment the item was added. */
export function compareItems(a: Orderable, b: Orderable): number {
  if (a.position !== b.position) return a.position - b.position;
  if (a.created_at < b.created_at) return -1;
  if (a.created_at > b.created_at) return 1;
  return 0;
}

export type Grouped<T> = Record<ShortlistItemStatus, T[]>;

/** The three sections of the board, each in reading order; a row with an unknown status is left out. */
export function groupByStatus<T extends Orderable & { status: string }>(items: readonly T[]): Grouped<T> {
  const groups: Grouped<T> = { to_review: [], retained: [], dismissed: [] };
  for (const item of items) {
    if (isItemStatus(item.status)) groups[item.status].push(item);
  }
  for (const status of ITEM_STATUSES) groups[status].sort(compareItems);
  return groups;
}

export type StatusCounts = Record<ShortlistItemStatus, number>;

export const NO_COUNTS: StatusCounts = { to_review: 0, retained: 0, dismissed: 0 };

export function countByStatus(items: readonly { status: string }[]): StatusCounts {
  const counts: StatusCounts = { to_review: 0, retained: 0, dismissed: 0 };
  for (const item of items) {
    if (isItemStatus(item.status)) counts[item.status] += 1;
  }
  return counts;
}

export function totalOf(counts: StatusCounts): number {
  return counts.to_review + counts.retained + counts.dismissed;
}

/** Counts per shortlist from the organisation's item rows, for the list page. */
export function countByShortlist(
  rows: readonly { shortlist_id: string; status: string }[],
): Map<string, StatusCounts> {
  const map = new Map<string, StatusCounts>();
  for (const row of rows) {
    if (!isItemStatus(row.status)) continue;
    const counts = map.get(row.shortlist_id) ?? { to_review: 0, retained: 0, dismissed: 0 };
    counts[row.status] += 1;
    map.set(row.shortlist_id, counts);
  }
  return map;
}

export type ShortlistFilter = "all" | "active" | "closed";

export const SHORTLIST_FILTERS: readonly ShortlistFilter[] = ["all", "active", "closed"];

/**
 * True when a shortlist whose brief has `status` belongs under `filter`:
 * "active" is every brief not closed, "closed" the closed ones. A deleted
 * brief (null) reads as active, so its shortlist never disappears from
 * the default view.
 */
export function matchesFilter(status: BriefStatus | null | undefined, filter: ShortlistFilter): boolean {
  if (filter === "all") return true;
  if (filter === "closed") return status === "closed";
  return status !== "closed";
}

/** True when the filter would change what the list shows: at least one closed brief among the rows. */
export function filterUseful(statuses: readonly (BriefStatus | null | undefined)[]): boolean {
  return statuses.some((status) => status === "closed");
}

/** The distinct people assigned on each shortlist, in the order they appear. */
export function assigneesByShortlist(
  rows: readonly { shortlist_id: string; assigned_to: string | null }[],
): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const row of rows) {
    if (!row.assigned_to) continue;
    const list = map.get(row.shortlist_id) ?? [];
    if (!list.includes(row.assigned_to)) list.push(row.assigned_to);
    map.set(row.shortlist_id, list);
  }
  return map;
}
