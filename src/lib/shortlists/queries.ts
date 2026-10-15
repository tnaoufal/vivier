/**
 * The typed reads and writes of a brief's shortlist, through supabase-js
 * under RLS: the brief a shortlist belongs to (for the old links that
 * still name a shortlist), the board (the items with their candidate
 * and the thread's message count per item), the profiles the rows of
 * the brief page show (read by id, in lots: the name, the position held
 * today, the years, where, the availability, the photo's path, whether
 * still in the pool), and the writes the grants allow: a decision on an
 * item, and a match entering the shortlist straight as retained or
 * dismissed (an insert, then the status the database stamps with who
 * and when, as every decision). Every call filters by the organisation
 * and casts rows at the boundary.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { lotsOf } from "@vivier/analysis";

import type {
  CandidateRow,
  MatchResult,
  ShortlistItemRow,
  ShortlistItemStatus,
} from "@/lib/db/types";

import { countByItem } from "./tally";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Postgres: a row that already exists under a unique key (a candidate already on the shortlist). */
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

// ---------------------------------------------------------------------
// the profiles the rows show
// ---------------------------------------------------------------------

/**
 * What a row and the reading pane need of a candidate: the name, the
 * position held today (the experiences, the headline), the years,
 * where, the availability, whether still in the pool, and the photo's
 * path (signed in the browser when the organisation shows photos; it
 * identifies a person on screen only and never reaches a model).
 */
export type ProfileCandidate = Pick<
  CandidateRow,
  | "id"
  | "full_name"
  | "headline"
  | "location"
  | "years_experience"
  | "availability"
  | "status"
  | "photo_path"
  | "experiences"
>;

export const PROFILE_COLUMNS =
  "id, full_name, headline, location, years_experience, availability, status, photo_path, experiences";

/** The most ids one read names (the gateway refuses a URL past 16 KB). */
export const PROFILE_LOT = 100;

/** The profiles given, by id, read in lots: each id answers its row, or null when the candidate was erased (or RLS hides it). */
export async function readProfilesById(
  supabase: SupabaseClient,
  orgId: string,
  ids: readonly string[],
): Promise<Map<string, ProfileCandidate | null>> {
  const out = new Map<string, ProfileCandidate | null>();
  for (const lot of lotsOf([...new Set(ids)], PROFILE_LOT)) {
    const { data, error } = await supabase
      .from("candidates")
      .select(PROFILE_COLUMNS)
      .eq("org_id", orgId)
      .in("id", lot);
    if (error) throw error;
    const rows = (data ?? []) as unknown as ProfileCandidate[];
    const byId = new Map(rows.map((row) => [row.id, row] as const));
    for (const id of lot) out.set(id, byId.get(id) ?? null);
  }
  return out;
}

// ---------------------------------------------------------------------
// the board
// ---------------------------------------------------------------------

export interface BoardItem extends ShortlistItemRow {
  /** Null when the candidate was erased from the pool (the row cascades soon after). */
  candidates: ProfileCandidate | null;
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
    .select(`*, candidates(${PROFILE_COLUMNS})`)
    .eq("org_id", orgId)
    .eq("shortlist_id", shortlistId)
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as unknown as Record<string, unknown>[]).map((row) => ({
    ...(row as unknown as ShortlistItemRow),
    candidates: one<ProfileCandidate>(row["candidates"]),
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

export type AddOutcome = "added" | "already";

/**
 * A match entering the shortlist with the match of the search, as
 * retained or dismissed in one click (or to examine): the row is
 * inserted to examine, then its status written as a second step, so
 * the database stamps decided_by and decided_at exactly as it does for
 * a decision on the board (the trigger stamps an update, never an
 * insert, and the grants never let the browser write them). "already"
 * when the pair existed: the status asked for is then written on it.
 */
export async function addWithStatus(
  supabase: SupabaseClient,
  input: {
    orgId: string;
    shortlistId: string;
    candidateId: string;
    match: MatchResult;
    userId: string;
    status: ShortlistItemStatus;
  },
): Promise<AddOutcome> {
  const { error } = await supabase.from("shortlist_items").insert({
    org_id: input.orgId,
    shortlist_id: input.shortlistId,
    candidate_id: input.candidateId,
    match: input.match,
    added_by: input.userId,
  });
  const outcome: AddOutcome = error ? "already" : "added";
  if (error && error.code !== UNIQUE_VIOLATION) throw error;
  if (input.status !== "to_review") {
    const decided = await supabase
      .from("shortlist_items")
      .update({ status: input.status })
      .eq("org_id", input.orgId)
      .eq("shortlist_id", input.shortlistId)
      .eq("candidate_id", input.candidateId);
    if (decided.error) throw decided.error;
  }
  return outcome;
}
