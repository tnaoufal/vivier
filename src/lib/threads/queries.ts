/**
 * The reads and writes of the team thread through supabase-js under
 * RLS: the last messages of one object with their authors' profiles
 * (one lot), a count, a message posted or deleted, the live
 * subscription on the object's column, the messages that mention the
 * person with the object each points at named (briefs, candidates and
 * shortlisted candidates read in lots), and one summary per brief for
 * the dashboard. Every read filters by the organisation and casts rows
 * at the boundary; the pure parts are in thread.ts.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { debounce, subscribeToTable } from "@/lib/data/realtime";
import type { CommentRow } from "@/lib/db/types";

import {
  MESSAGE_MAX,
  THREAD_LIMIT,
  distinct,
  lots,
  resolveTarget,
  summarizeThreads,
  targetColumn,
  targetColumns,
  targetIdsOf,
  type MentionItem,
  type TargetNames,
  type ThreadAuthor,
  type ThreadMessage,
  type ThreadSummary,
  type ThreadTarget,
} from "./thread";

const COMMENT_COLUMNS =
  "id, org_id, shortlist_item_id, candidate_id, brief_id, author_id, body, mentions, created_at, updated_at";

/** What a thread shows of a person: never the locale or the dates of the profile. */
const AUTHOR_COLUMNS = "id, display_name, email";

export const MENTIONS_LIMIT = 20;

/** The profiles of these authors, by id; a profile RLS hides (a person who left) is simply absent. */
async function readAuthors(
  supabase: SupabaseClient,
  authorIds: readonly string[],
): Promise<Map<string, ThreadAuthor>> {
  const authors = new Map<string, ThreadAuthor>();
  for (const lot of lots(distinct(authorIds))) {
    const { data, error } = await supabase.from("profiles").select(AUTHOR_COLUMNS).in("id", lot);
    if (error) throw error;
    for (const profile of (data ?? []) as unknown as ThreadAuthor[])
      authors.set(profile.id, profile);
  }
  return authors;
}

function withAuthors(
  rows: readonly CommentRow[],
  authors: ReadonlyMap<string, ThreadAuthor>,
): ThreadMessage[] {
  return rows.map((row) => ({ ...row, author: authors.get(row.author_id) ?? null }));
}

export interface ThreadPage {
  /** The last `limit` messages, newest last. */
  messages: ThreadMessage[];
  /** How many the object holds in all; more than the messages when the thread is longer than the limit. */
  total: number;
}

export async function listThread(
  supabase: SupabaseClient,
  orgId: string,
  target: ThreadTarget,
  options: { limit?: number | undefined } = {},
): Promise<ThreadPage> {
  const { column, id } = targetColumn(target);
  const limit = options.limit ?? THREAD_LIMIT;
  const { data, error, count } = await supabase
    .from("comments")
    .select(COMMENT_COLUMNS, { count: "exact" })
    .eq("org_id", orgId)
    .eq(column, id)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit);
  if (error) throw error;
  const rows = ((data ?? []) as unknown as CommentRow[]).reverse();
  const authors = await readAuthors(
    supabase,
    rows.map((row) => row.author_id),
  );
  return {
    messages: withAuthors(rows, authors),
    total: typeof count === "number" ? count : rows.length,
  };
}

/** How many messages the object holds, without reading them (a HEAD with count=exact). */
export async function countThread(
  supabase: SupabaseClient,
  orgId: string,
  target: ThreadTarget,
): Promise<number> {
  const { column, id } = targetColumn(target);
  const { count, error } = await supabase
    .from("comments")
    .select("id", { head: true, count: "exact" })
    .eq("org_id", orgId)
    .eq(column, id);
  if (error) throw error;
  return count ?? 0;
}

/** Inserts the message and reads it back (the grant covers the columns written; RLS checks the author). */
export async function postMessage(
  supabase: SupabaseClient,
  input: {
    orgId: string;
    target: ThreadTarget;
    authorId: string;
    body: string;
    mentions: string[];
  },
): Promise<CommentRow> {
  const { data, error } = await supabase
    .from("comments")
    .insert({
      org_id: input.orgId,
      ...targetColumns(input.target),
      author_id: input.authorId,
      body: input.body.slice(0, MESSAGE_MAX),
      mentions: input.mentions,
    })
    .select(COMMENT_COLUMNS)
    .single();
  if (error) throw error;
  return data as unknown as CommentRow;
}

export async function deleteMessage(
  supabase: SupabaseClient,
  orgId: string,
  messageId: string,
): Promise<void> {
  const { error } = await supabase
    .from("comments")
    .delete()
    .eq("id", messageId)
    .eq("org_id", orgId);
  if (error) throw error;
}

/** Calls back (debounced) on every change of the object's thread; returns the way to stop. */
export function subscribeThread(target: ThreadTarget, onChange: () => void): () => void {
  const { column, id } = targetColumn(target);
  return subscribeToTable("comments", `${column}=eq.${id}`, debounce(onChange));
}

/** The names of the objects these rows point at, each kind read in lots of ids. */
async function readTargetNames(
  supabase: SupabaseClient,
  orgId: string,
  rows: readonly CommentRow[],
): Promise<TargetNames> {
  const ids = targetIdsOf(rows);
  const items = new Map<string, { shortlist_id: string; candidate_id: string }>();
  for (const lot of lots(ids.itemIds)) {
    const { data, error } = await supabase
      .from("shortlist_items")
      .select("id, shortlist_id, candidate_id")
      .eq("org_id", orgId)
      .in("id", lot);
    if (error) throw error;
    for (const row of (data ?? []) as unknown as {
      id: string;
      shortlist_id: string;
      candidate_id: string;
    }[]) {
      items.set(row.id, { shortlist_id: row.shortlist_id, candidate_id: row.candidate_id });
    }
  }
  const candidates = new Map<string, string | null>();
  const candidateIds = distinct([
    ...ids.candidateIds,
    ...[...items.values()].map((item) => item.candidate_id),
  ]);
  for (const lot of lots(candidateIds)) {
    const { data, error } = await supabase
      .from("candidates")
      .select("id, full_name")
      .eq("org_id", orgId)
      .in("id", lot);
    if (error) throw error;
    for (const row of (data ?? []) as unknown as { id: string; full_name: string | null }[]) {
      candidates.set(row.id, row.full_name?.trim() || null);
    }
  }
  const briefs = new Map<string, string>();
  for (const lot of lots(ids.briefIds)) {
    const { data, error } = await supabase
      .from("briefs")
      .select("id, title")
      .eq("org_id", orgId)
      .in("id", lot);
    if (error) throw error;
    for (const row of (data ?? []) as unknown as { id: string; title: string }[])
      briefs.set(row.id, row.title);
  }
  return { briefs, candidates, items };
}

/** The messages that mention the person, newest first, each with the object it is about named. */
export async function listMyMentions(
  supabase: SupabaseClient,
  orgId: string,
  userId: string,
  limit: number = MENTIONS_LIMIT,
): Promise<MentionItem[]> {
  const { data, error } = await supabase
    .from("comments")
    .select(COMMENT_COLUMNS)
    .eq("org_id", orgId)
    .contains("mentions", [userId])
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit);
  if (error) throw error;
  const rows = (data ?? []) as unknown as CommentRow[];
  if (!rows.length) return [];
  const [authors, names] = await Promise.all([
    readAuthors(
      supabase,
      rows.map((row) => row.author_id),
    ),
    readTargetNames(supabase, orgId, rows),
  ]);
  return withAuthors(rows, authors).map((message) => ({
    ...message,
    target: resolveTarget(message, names),
  }));
}

/**
 * One summary per brief that has a thread (count, last message), for
 * the dashboard and the briefs list: the rows of these briefs in one
 * read per lot of ids, four columns, aggregated here. A brief without
 * a message is absent from the map.
 */
export async function threadSummaries(
  supabase: SupabaseClient,
  orgId: string,
  briefIds: readonly string[],
): Promise<Map<string, ThreadSummary>> {
  const rows: Pick<CommentRow, "brief_id" | "author_id" | "body" | "created_at">[] = [];
  for (const lot of lots(distinct(briefIds))) {
    const { data, error } = await supabase
      .from("comments")
      .select("brief_id, author_id, body, created_at")
      .eq("org_id", orgId)
      .in("brief_id", lot);
    if (error) throw error;
    rows.push(
      ...((data ?? []) as unknown as Pick<
        CommentRow,
        "brief_id" | "author_id" | "body" | "created_at"
      >[]),
    );
  }
  return summarizeThreads(rows);
}
