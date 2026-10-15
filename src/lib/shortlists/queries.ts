/**
 * The typed reads and writes of a brief's shortlist, through supabase-js
 * under RLS: the shortlist of a brief (read, or created on first use by
 * a member), the brief a shortlist belongs to (for the old links that
 * still name a shortlist), the board (the items with their candidate
 * and the thread's message count per item), the candidate a drawer
 * reads in full, and the writes the grants allow (status, assignee,
 * removal). Every call filters by the organisation and casts rows at
 * the boundary.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { parseCriteria } from "@/lib/briefs/criteria";
import type {
  BriefCriterion,
  CandidateRow,
  ShortlistItemRow,
  ShortlistItemStatus,
} from "@/lib/db/types";

import { countByItem } from "./tally";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Postgres: a row that already exists under a unique key (a shortlist of this brief). */
const UNIQUE_VIOLATION = "23505";

export function isUuid(value: string | null | undefined): value is string {
  return typeof value === "string" && UUID.test(value);
}

/** An embedded to-one row comes back as an object; an array (older PostgREST) is read as its first row. */
function one<T>(value: unknown): T | null {
  if (Array.isArray(value)) return (value[0] as T | undefined) ?? null;
  return value && typeof value === "object" ? (value as T) : null;
}

// ---------------------------------------------------------------------
// the shortlist of a brief
// ---------------------------------------------------------------------

/** The id of the brief's shortlist, null until someone adds the first candidate. */
export async function readShortlistId(
  supabase: SupabaseClient,
  orgId: string,
  briefId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("shortlists")
    .select("id")
    .eq("org_id", orgId)
    .eq("brief_id", briefId)
    .maybeSingle();
  if (error) throw error;
  return (data as { id: string } | null)?.id ?? null;
}

/** The brief's shortlist, created now when it does not exist yet (a lost race is fine: the row is then read). */
export async function ensureShortlist(
  supabase: SupabaseClient,
  input: { orgId: string; briefId: string; userId: string },
): Promise<string> {
  const inserted = await supabase
    .from("shortlists")
    .insert({ org_id: input.orgId, brief_id: input.briefId, created_by: input.userId })
    .select("id")
    .single();
  if (!inserted.error) return (inserted.data as { id: string }).id;
  if (inserted.error.code !== UNIQUE_VIOLATION) throw inserted.error;
  const id = await readShortlistId(supabase, input.orgId, input.briefId);
  if (!id) throw inserted.error;
  return id;
}

/** The brief a shortlist belongs to, for a link that still names the shortlist; null when it does not exist. */
export async function readShortlistBriefId(
  supabase: SupabaseClient,
  orgId: string,
  shortlistId: string,
): Promise<string | null> {
  if (!isUuid(shortlistId)) return null;
  const { data, error } = await supabase
    .from("shortlists")
    .select("brief_id")
    .eq("org_id", orgId)
    .eq("id", shortlistId)
    .maybeSingle();
  if (error) throw error;
  return (data as { brief_id: string } | null)?.brief_id ?? null;
}

/** What the board needs of the brief: its title (the dossier's) and its criteria (the rows of an older match). */
export interface BoardBrief {
  title: string;
  criteria: BriefCriterion[];
}

export async function readBoardBrief(
  supabase: SupabaseClient,
  orgId: string,
  briefId: string,
): Promise<BoardBrief | null> {
  const { data, error } = await supabase
    .from("briefs")
    .select("title, criteria")
    .eq("org_id", orgId)
    .eq("id", briefId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = data as { title: string | null; criteria: unknown };
  return { title: row.title ?? "", criteria: parseCriteria(row.criteria) };
}

// ---------------------------------------------------------------------
// the board
// ---------------------------------------------------------------------

/** The photo path rides along for the card's avatar: a signed URL in the browser, never a model's input. */
export const ITEM_CANDIDATE_COLUMNS = "id, full_name, headline, years_experience, photo_path";

export type ItemCandidate = Pick<
  CandidateRow,
  "id" | "full_name" | "headline" | "years_experience" | "photo_path"
>;

export interface BoardItem extends ShortlistItemRow {
  /** Null when the candidate was erased from the pool (the row cascades soon after). */
  candidates: ItemCandidate | null;
}

export interface Board {
  items: BoardItem[];
  /** The thread's messages per item id. */
  threadCounts: Map<string, number>;
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

/** The items and the number of messages on each one's thread, in two reads. */
export async function readBoard(
  supabase: SupabaseClient,
  orgId: string,
  shortlistId: string,
): Promise<Board> {
  const items = await listBoardItems(supabase, orgId, shortlistId);
  const ids = items.map((item) => item.id);
  if (!ids.length) return { items, threadCounts: new Map() };
  const { data, error } = await supabase
    .from("comments")
    .select("shortlist_item_id")
    .eq("org_id", orgId)
    .in("shortlist_item_id", ids);
  if (error) throw error;
  return {
    items,
    threadCounts: countByItem((data ?? []) as unknown as { shortlist_item_id: string | null }[]),
  };
}

// ---------------------------------------------------------------------
// the candidate a drawer reads in full (shared with the brief's match drawer)
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

export async function removeItem(
  supabase: SupabaseClient,
  orgId: string,
  itemId: string,
): Promise<void> {
  const { error } = await supabase
    .from("shortlist_items")
    .delete()
    .eq("id", itemId)
    .eq("org_id", orgId);
  if (error) throw error;
}
