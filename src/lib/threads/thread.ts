/**
 * The pure side of the team thread, tested on its own: what a thread is
 * about (a brief, a candidate or a shortlisted candidate, one column of
 * `comments`), the messages grouped by the day they were written, the
 * one-line excerpt a list shows, the mentions read from a body (through
 * the shortlist's mentions helper), who wrote what, the summary per
 * brief for the dashboard, the labels of the objects a mention points
 * at, and the merge of what a read confirmed with what was just sent.
 * Nothing here talks to the database; queries.ts does.
 */
import { dayKey, labelOfDay } from "@/lib/activity/grouping";
import type { CommentRow, ProfileRow } from "@/lib/db/types";
import { formatDate, type Locale } from "@/lib/i18n";
import { parseMentions, type MentionMember } from "@/lib/shortlists/mentions";

export type ThreadTarget =
  | { briefId: string }
  | { candidateId: string }
  | { shortlistItemId: string };

/** The column of `comments` a target fills; the two others stay null. */
export type ThreadColumn = "brief_id" | "candidate_id" | "shortlist_item_id";

/** The messages a thread shows: the last ones, newest last. */
export const THREAD_LIMIT = 100;
/** The database's own limit on a body. */
export const MESSAGE_MAX = 8000;
export const EXCERPT_MAX = 80;
/** Ids per `in()` filter: a longer list makes a URL the gateway refuses. */
export const LOT_SIZE = 100;

export type ThreadAuthor = Pick<ProfileRow, "id" | "display_name" | "email">;

/** A comment with its author's profile; null when the author left the organisation (their profile is no longer readable). */
export interface ThreadMessage extends CommentRow {
  author: ThreadAuthor | null;
}

export function targetColumn(target: ThreadTarget): { column: ThreadColumn; id: string } {
  if ("briefId" in target) return { column: "brief_id", id: target.briefId };
  if ("candidateId" in target) return { column: "candidate_id", id: target.candidateId };
  return { column: "shortlist_item_id", id: target.shortlistItemId };
}

/** The target back from its column and id (a stable object for hooks). */
export function targetOf(column: ThreadColumn, id: string): ThreadTarget {
  if (column === "brief_id") return { briefId: id };
  if (column === "candidate_id") return { candidateId: id };
  return { shortlistItemId: id };
}

/** "brief_id:<id>": the key of a query or a channel. */
export function threadKey(target: ThreadTarget): string {
  const { column, id } = targetColumn(target);
  return `${column}:${id}`;
}

/** The three target columns of a row, the target's one filled. */
export function targetColumns(
  target: ThreadTarget,
): Pick<CommentRow, "brief_id" | "candidate_id" | "shortlist_item_id"> {
  const { column, id } = targetColumn(target);
  return {
    brief_id: column === "brief_id" ? id : null,
    candidate_id: column === "candidate_id" ? id : null,
    shortlist_item_id: column === "shortlist_item_id" ? id : null,
  };
}

/** Cuts a list into lots of `size` in order; the last one may be shorter; nothing for an empty list. */
export function lots<T>(items: readonly T[], size: number = LOT_SIZE): T[][] {
  const step = Math.max(1, Math.floor(size));
  const out: T[][] = [];
  for (let at = 0; at < items.length; at += step) out.push(items.slice(at, at + step));
  return out;
}

/** Each value once, in order of first appearance, empty ones left out. */
export function distinct(values: readonly (string | null | undefined)[]): string[] {
  const seen = new Set<string>();
  for (const value of values) if (value) seen.add(value);
  return [...seen];
}

export function isMine(
  message: Pick<CommentRow, "author_id">,
  userId: string | null | undefined,
): boolean {
  return typeof userId === "string" && userId.length > 0 && message.author_id === userId;
}

/** The id of a message shown before the database answered; a read replaces it with the row's. */
export const PENDING_PREFIX = "pending:";

/** True for a message just sent and not read back yet: there is no id to act on. */
export function isPending(message: Pick<CommentRow, "id">): boolean {
  return message.id.startsWith(PENDING_PREFIX);
}

/** The ids of the members a body mentions, each once, in order (the shortlist's reader). */
export function mentionsOf(body: string, members: readonly MentionMember[]): string[] {
  return parseMentions(body, members);
}

/**
 * The first line of a body for a list: whitespace collapsed, at most
 * `max` characters, cut at a word when one is near enough, an ellipsis
 * (counted in the limit) when something was left out.
 */
export function excerpt(body: string, max: number = EXCERPT_MAX): string {
  const line = body.replace(/\s+/g, " ").trim();
  const limit = Math.max(1, Math.floor(max));
  if (line.length <= limit) return line;
  const cut = line.slice(0, limit - 1);
  const space = cut.lastIndexOf(" ");
  const kept = space >= limit / 2 ? cut.slice(0, space) : cut;
  return `${kept.trimEnd()}…`;
}

export type ThreadDayLabel =
  | { kind: "today" }
  | { kind: "yesterday" }
  | { kind: "date"; text: string };

export interface ThreadDay<Message extends Pick<CommentRow, "created_at">> {
  /** The local calendar day, "YYYY-MM-DD", stable as a React key. */
  key: string;
  label: ThreadDayLabel;
  messages: Message[];
}

/**
 * Consecutive messages of one day under one label, in the order given
 * (oldest first in a thread, so the days are too): today, yesterday,
 * else the date written for the locale. A message without a readable
 * date joins the group before it rather than making its own.
 */
export function groupByDay<Message extends Pick<CommentRow, "created_at">>(
  messages: readonly Message[],
  locale: Locale,
  now: Date = new Date(),
): ThreadDay<Message>[] {
  const days: ThreadDay<Message>[] = [];
  for (const message of messages) {
    const key = dayKey(message.created_at);
    const last = days[days.length - 1];
    if (last && (key === "" || last.key === key)) {
      last.messages.push(message);
      continue;
    }
    const day = labelOfDay(key, now);
    const label: ThreadDayLabel =
      day.kind === "date" ? { kind: "date", text: formatDate(locale, `${day.iso}T12:00:00`) } : day;
    days.push({ key, label, messages: [message] });
  }
  return days;
}

/**
 * What a list shows: the rows a read confirmed (those removed here taken
 * out), then the messages sent but not read back yet, so a message never
 * shows twice and a deleted one never comes back before the next read.
 */
export function mergeMessages<Message extends Pick<CommentRow, "id">>(
  loaded: readonly Message[],
  pending: readonly Message[],
  removed: ReadonlySet<string> = new Set(),
): Message[] {
  const known = new Set(loaded.map((message) => message.id));
  const shown = loaded.filter((message) => !removed.has(message.id));
  for (const message of pending) {
    if (!known.has(message.id) && !removed.has(message.id)) shown.push(message);
  }
  return shown;
}

export interface ThreadSummary {
  count: number;
  /** When the last message was written. */
  lastAt: string;
  /** Who wrote it (an id: the page names it with its member namer). */
  lastAuthorId: string;
  lastExcerpt: string;
}

/** One summary per brief from its rows, in any order; a row without a brief is skipped. */
export function summarizeThreads(
  rows: readonly Pick<CommentRow, "brief_id" | "author_id" | "body" | "created_at">[],
): Map<string, ThreadSummary> {
  const map = new Map<string, ThreadSummary>();
  for (const row of rows) {
    if (!row.brief_id) continue;
    const current = map.get(row.brief_id);
    if (!current) {
      map.set(row.brief_id, {
        count: 1,
        lastAt: row.created_at,
        lastAuthorId: row.author_id,
        lastExcerpt: excerpt(row.body),
      });
      continue;
    }
    current.count += 1;
    if (Date.parse(row.created_at) >= Date.parse(current.lastAt)) {
      current.lastAt = row.created_at;
      current.lastAuthorId = row.author_id;
      current.lastExcerpt = excerpt(row.body);
    }
  }
  return map;
}

/** The object a mention points at, named for a list; `label` is null when the object carries no name. */
export type MentionTarget =
  | { kind: "brief"; id: string; label: string | null }
  | { kind: "candidate"; id: string; label: string | null }
  | {
      kind: "shortlistItem";
      id: string;
      shortlistId: string | null;
      candidateId: string | null;
      label: string | null;
    };

export interface MentionItem extends ThreadMessage {
  target: MentionTarget;
}

export interface TargetNames {
  /** Brief id → title. */
  briefs: ReadonlyMap<string, string>;
  /** Candidate id → full name (null when the CV gave none). */
  candidates: ReadonlyMap<string, string | null>;
  /** Shortlist item id → its shortlist and candidate. */
  items: ReadonlyMap<string, { shortlist_id: string; candidate_id: string }>;
}

/** The distinct ids the rows point at, per kind, so each can be read in one lot. */
export function targetIdsOf(
  rows: readonly Pick<CommentRow, "brief_id" | "candidate_id" | "shortlist_item_id">[],
): { briefIds: string[]; candidateIds: string[]; itemIds: string[] } {
  return {
    briefIds: distinct(rows.map((row) => row.brief_id)),
    candidateIds: distinct(rows.map((row) => row.candidate_id)),
    itemIds: distinct(rows.map((row) => row.shortlist_item_id)),
  };
}

/**
 * Where a row points, the most specific column first (a shortlisted
 * candidate, then a candidate, then a brief), with the name read for
 * it: a brief's title, a candidate's name, the shortlisted candidate's
 * name. An item whose row was not read (erased since) keeps its id and
 * no name.
 */
export function resolveTarget(
  row: Pick<CommentRow, "brief_id" | "candidate_id" | "shortlist_item_id">,
  names: TargetNames,
): MentionTarget {
  if (row.shortlist_item_id) {
    const item = names.items.get(row.shortlist_item_id);
    const candidateId = item?.candidate_id ?? row.candidate_id;
    return {
      kind: "shortlistItem",
      id: row.shortlist_item_id,
      shortlistId: item?.shortlist_id ?? null,
      candidateId,
      label: candidateId ? (names.candidates.get(candidateId) ?? null) : null,
    };
  }
  if (row.candidate_id) {
    return {
      kind: "candidate",
      id: row.candidate_id,
      label: names.candidates.get(row.candidate_id) ?? null,
    };
  }
  return {
    kind: "brief",
    id: row.brief_id ?? "",
    label: row.brief_id ? (names.briefs.get(row.brief_id) ?? null) : null,
  };
}

/** The path of the page a mention opens; null for a shortlisted candidate whose shortlist is gone. */
export function mentionPath(target: MentionTarget): string | null {
  if (target.kind === "brief")
    return target.id ? `/app/briefs/${encodeURIComponent(target.id)}` : null;
  if (target.kind === "candidate") return `/app/candidates/${encodeURIComponent(target.id)}`;
  return target.shortlistId ? `/app/shortlists/${encodeURIComponent(target.shortlistId)}` : null;
}
