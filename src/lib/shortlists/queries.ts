/**
 * The typed reads and writes of the shortlists, through supabase-js
 * under RLS: the organisation's shortlists with their brief, the board
 * of one shortlist (items with their candidate, votes, comment counts),
 * one item's comments and history, and the writes the grants allow
 * (status, assignee, note, removal, the caller's own vote and comments).
 * Every call filters by the organisation and casts rows at the boundary.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  ActivityRow,
  BriefRow,
  CandidateRow,
  CommentRow,
  ShortlistItemRow,
  ShortlistItemStatus,
  ShortlistRow,
  VoteRow,
} from "@/lib/db/types";

import { countByItem, type VoteValue } from "./tally";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string | null | undefined): value is string {
  return typeof value === "string" && UUID.test(value);
}

/** An embedded to-one row comes back as an object; an array (older PostgREST) is read as its first row. */
function one<T>(value: unknown): T | null {
  if (Array.isArray(value)) return (value[0] as T | undefined) ?? null;
  return value && typeof value === "object" ? (value as T) : null;
}

// ---------------------------------------------------------------------
// the list page
// ---------------------------------------------------------------------

export type ListBrief = Pick<BriefRow, "id" | "title" | "status">;

export interface ShortlistListRow extends ShortlistRow {
  briefs: ListBrief | null;
}

export async function listShortlists(supabase: SupabaseClient, orgId: string): Promise<ShortlistListRow[]> {
  const { data, error } = await supabase
    .from("shortlists")
    .select("*, briefs(id, title, status)")
    .eq("org_id", orgId)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return ((data ?? []) as unknown as Record<string, unknown>[]).map((row) => ({
    ...(row as unknown as ShortlistRow),
    briefs: one<ListBrief>(row["briefs"]),
  }));
}

export interface ItemSummary {
  shortlist_id: string;
  status: ShortlistItemStatus;
  assigned_to: string | null;
}

/** Every item of the organisation, three columns: the list page counts them in the browser. */
export async function listItemSummaries(supabase: SupabaseClient, orgId: string): Promise<ItemSummary[]> {
  const { data, error } = await supabase
    .from("shortlist_items")
    .select("shortlist_id, status, assigned_to")
    .eq("org_id", orgId);
  if (error) throw error;
  return (data ?? []) as unknown as ItemSummary[];
}

// ---------------------------------------------------------------------
// the board of one shortlist
// ---------------------------------------------------------------------

export type ShortlistBrief = Pick<BriefRow, "id" | "title" | "status" | "criteria">;

export interface ShortlistWithBrief extends ShortlistRow {
  briefs: ShortlistBrief | null;
}

export async function readShortlist(
  supabase: SupabaseClient,
  orgId: string,
  shortlistId: string,
): Promise<ShortlistWithBrief | null> {
  const { data, error } = await supabase
    .from("shortlists")
    .select("*, briefs(id, title, status, criteria)")
    .eq("org_id", orgId)
    .eq("id", shortlistId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = data as unknown as Record<string, unknown>;
  return { ...(row as unknown as ShortlistRow), briefs: one<ShortlistBrief>(row["briefs"]) };
}

export const ITEM_CANDIDATE_COLUMNS = "id, full_name, headline, location, skills, confidence";

export type ItemCandidate = Pick<
  CandidateRow,
  "id" | "full_name" | "headline" | "location" | "skills" | "confidence"
>;

export interface BoardItem extends ShortlistItemRow {
  /** Null when the candidate was erased from the pool (the row cascades soon after). */
  candidates: ItemCandidate | null;
}

export interface Board {
  items: BoardItem[];
  votes: VoteRow[];
  /** Comments per item id. */
  commentCounts: Map<string, number>;
}

export async function listBoardItems(
  supabase: SupabaseClient,
  orgId: string,
  shortlistId: string,
): Promise<BoardItem[]> {
  const { data, error } = await supabase
    .from("shortlist_items")
    .select(`*, candidates(${ITEM_CANDIDATE_COLUMNS})`)
    .eq("org_id", orgId)
    .eq("shortlist_id", shortlistId)
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as unknown as Record<string, unknown>[]).map((row) => ({
    ...(row as unknown as ShortlistItemRow),
    candidates: one<ItemCandidate>(row["candidates"]),
  }));
}

/** The items, every vote on them and the number of comments per item, in three reads. */
export async function readBoard(supabase: SupabaseClient, orgId: string, shortlistId: string): Promise<Board> {
  const items = await listBoardItems(supabase, orgId, shortlistId);
  const ids = items.map((item) => item.id);
  if (!ids.length) return { items, votes: [], commentCounts: new Map() };
  const [votes, comments] = await Promise.all([
    supabase.from("votes").select("*").eq("org_id", orgId).in("shortlist_item_id", ids),
    supabase.from("comments").select("shortlist_item_id").eq("org_id", orgId).in("shortlist_item_id", ids),
  ]);
  if (votes.error) throw votes.error;
  if (comments.error) throw comments.error;
  return {
    items,
    votes: (votes.data ?? []) as unknown as VoteRow[],
    commentCounts: countByItem((comments.data ?? []) as unknown as { shortlist_item_id: string | null }[]),
  };
}

// ---------------------------------------------------------------------
// the drawer of one item
// ---------------------------------------------------------------------

export const DRAWER_CANDIDATE_COLUMNS =
  "id, full_name, headline, location, summary, skills, languages, years_experience, availability, status";

export type DrawerCandidate = Pick<
  CandidateRow,
  | "id"
  | "full_name"
  | "headline"
  | "location"
  | "summary"
  | "skills"
  | "languages"
  | "years_experience"
  | "availability"
  | "status"
>;

export async function readDrawerCandidate(
  supabase: SupabaseClient,
  orgId: string,
  candidateId: string,
): Promise<DrawerCandidate | null> {
  const { data, error } = await supabase
    .from("candidates")
    .select(DRAWER_CANDIDATE_COLUMNS)
    .eq("org_id", orgId)
    .eq("id", candidateId)
    .maybeSingle();
  if (error) throw error;
  return (data as unknown as DrawerCandidate | null) ?? null;
}

export async function listItemComments(
  supabase: SupabaseClient,
  orgId: string,
  itemId: string,
): Promise<CommentRow[]> {
  const { data, error } = await supabase
    .from("comments")
    .select("*")
    .eq("org_id", orgId)
    .eq("shortlist_item_id", itemId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as CommentRow[];
}

export const HISTORY_LIMIT = 50;

/**
 * What happened to this item, newest first: the rows that target it
 * (added, decided, assigned, removed) and those about the same candidate
 * on the same brief (comments, an earlier line). Ids are checked before
 * they go into the filter string.
 */
export async function listItemHistory(
  supabase: SupabaseClient,
  orgId: string,
  item: { id: string; candidate_id: string },
  briefId: string | null,
): Promise<ActivityRow[]> {
  if (!isUuid(item.id)) return [];
  const parts = [`target_id.eq.${item.id}`];
  if (isUuid(briefId) && isUuid(item.candidate_id)) {
    parts.push(`and(candidate_id.eq.${item.candidate_id},brief_id.eq.${briefId})`);
  }
  const { data, error } = await supabase
    .from("activities")
    .select("*")
    .eq("org_id", orgId)
    .or(parts.join(","))
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(HISTORY_LIMIT);
  if (error) throw error;
  return (data ?? []) as unknown as ActivityRow[];
}

// ---------------------------------------------------------------------
// writes (members and up; RLS and the column grants decide)
// ---------------------------------------------------------------------

/** A status is always a person's click; the database stamps decided_by / decided_at. */
export async function setItemStatus(
  supabase: SupabaseClient,
  orgId: string,
  itemId: string,
  status: ShortlistItemStatus,
): Promise<void> {
  const { error } = await supabase
    .from("shortlist_items")
    .update({ status })
    .eq("id", itemId)
    .eq("org_id", orgId);
  if (error) throw error;
}

export async function setItemAssignee(
  supabase: SupabaseClient,
  orgId: string,
  itemId: string,
  userId: string | null,
): Promise<void> {
  const { error } = await supabase
    .from("shortlist_items")
    .update({ assigned_to: userId })
    .eq("id", itemId)
    .eq("org_id", orgId);
  if (error) throw error;
}

export const NOTE_MAX = 4000;

export async function setItemNote(
  supabase: SupabaseClient,
  orgId: string,
  itemId: string,
  note: string | null,
): Promise<void> {
  const { error } = await supabase
    .from("shortlist_items")
    .update({ note: note ? note.slice(0, NOTE_MAX) : null })
    .eq("id", itemId)
    .eq("org_id", orgId);
  if (error) throw error;
}

export async function removeItem(supabase: SupabaseClient, orgId: string, itemId: string): Promise<void> {
  const { error } = await supabase.from("shortlist_items").delete().eq("id", itemId).eq("org_id", orgId);
  if (error) throw error;
}

/** The caller's vote on an item, inserted or replaced on the primary key (item, user). */
export async function castVote(
  supabase: SupabaseClient,
  input: { orgId: string; itemId: string; userId: string; value: VoteValue },
): Promise<void> {
  const { error } = await supabase
    .from("votes")
    .upsert(
      { shortlist_item_id: input.itemId, org_id: input.orgId, user_id: input.userId, value: input.value },
      { onConflict: "shortlist_item_id,user_id" },
    );
  if (error) throw error;
}

export async function clearVote(
  supabase: SupabaseClient,
  orgId: string,
  itemId: string,
  userId: string,
): Promise<void> {
  const { error } = await supabase
    .from("votes")
    .delete()
    .eq("shortlist_item_id", itemId)
    .eq("user_id", userId)
    .eq("org_id", orgId);
  if (error) throw error;
}

export const COMMENT_MAX = 8000;

export async function addComment(
  supabase: SupabaseClient,
  input: { orgId: string; itemId: string; authorId: string; body: string; mentions: string[] },
): Promise<void> {
  const { error } = await supabase.from("comments").insert({
    org_id: input.orgId,
    shortlist_item_id: input.itemId,
    author_id: input.authorId,
    body: input.body.slice(0, COMMENT_MAX),
    mentions: input.mentions,
  });
  if (error) throw error;
}

export async function editComment(
  supabase: SupabaseClient,
  orgId: string,
  commentId: string,
  body: string,
  mentions: string[],
): Promise<void> {
  const { error } = await supabase
    .from("comments")
    .update({ body: body.slice(0, COMMENT_MAX), mentions })
    .eq("id", commentId)
    .eq("org_id", orgId);
  if (error) throw error;
}

export async function deleteComment(supabase: SupabaseClient, orgId: string, commentId: string): Promise<void> {
  const { error } = await supabase.from("comments").delete().eq("id", commentId).eq("org_id", orgId);
  if (error) throw error;
}
