/**
 * The typed reads and writes of briefs through supabase-js under RLS:
 * the list, one brief, its searches (summaries, then one search with its
 * stored results; the newest of each brief for the list's cards), the
 * candidates a result list shows, and the shortlist of a brief (created
 * on first use, items added one by one).
 * Each call filters by the organisation and casts rows at the boundary.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  BriefCriterion,
  BriefRow,
  BriefStatus,
  CandidateRow,
  MatchResult,
  RoleProfile,
  SearchRow,
} from "@/lib/db/types";

import { parseCriteria } from "./criteria";
import { digestResults, latestPerBrief, type LatestAnalysis } from "./presentation";
import { parseRoleProfile } from "./role-profile";
import { batchesOf } from "./stages";

/** Every column of BriefRow, named so the embedding vector never travels to the browser. */
export const BRIEF_COLUMNS =
  "id, org_id, title, description, criteria, role_profile, status, created_by, created_at, updated_at";

export const TITLE_MAX = 160;
export const DESCRIPTION_MAX = 20000;

/** A duplicate key: a unique index refused the row. */
export const UNIQUE_VIOLATION = "23505";

/** The JSON columns guarded at the boundary: the criteria and the role profile (null when the column holds nothing readable). */
function withParsedCriteria(row: BriefRow): BriefRow {
  return {
    ...row,
    criteria: parseCriteria(row.criteria),
    role_profile: parseRoleProfile(row.role_profile),
  };
}

export async function listBriefs(
  supabase: SupabaseClient,
  orgId: string,
  status: BriefStatus | null,
): Promise<BriefRow[]> {
  let request = supabase.from("briefs").select(BRIEF_COLUMNS).eq("org_id", orgId);
  if (status) request = request.eq("status", status);
  const { data, error } = await request.order("updated_at", { ascending: false }).limit(200);
  if (error) throw error;
  return ((data ?? []) as unknown as BriefRow[]).map(withParsedCriteria);
}

/** One brief of the organisation, or null when it does not exist. */
export async function readBrief(
  supabase: SupabaseClient,
  orgId: string,
  briefId: string,
): Promise<BriefRow | null> {
  const { data, error } = await supabase
    .from("briefs")
    .select(BRIEF_COLUMNS)
    .eq("org_id", orgId)
    .eq("id", briefId)
    .maybeSingle();
  if (error) throw error;
  const row = data as unknown as BriefRow | null;
  return row ? withParsedCriteria(row) : null;
}

export interface NewBrief {
  orgId: string;
  title: string;
  description: string;
  userId: string;
}

/** Inserts an open brief and answers its id. */
export async function createBrief(supabase: SupabaseClient, input: NewBrief): Promise<string> {
  const { data, error } = await supabase
    .from("briefs")
    .insert({
      org_id: input.orgId,
      title: input.title.trim().slice(0, TITLE_MAX),
      description: input.description.trim().slice(0, DESCRIPTION_MAX),
      criteria: [],
      status: "open",
      created_by: input.userId,
    })
    .select("id")
    .single();
  if (error) throw error;
  return (data as { id: string }).id;
}

export type BriefPatch = Partial<Pick<BriefRow, "title" | "description" | "status">> & {
  criteria?: BriefCriterion[];
  /** The role profile as the team edited it (members may write the column); null clears it. */
  role_profile?: RoleProfile | null;
};

export async function updateBrief(
  supabase: SupabaseClient,
  orgId: string,
  briefId: string,
  patch: BriefPatch,
): Promise<void> {
  const { error } = await supabase
    .from("briefs")
    .update(patch)
    .eq("org_id", orgId)
    .eq("id", briefId);
  if (error) throw error;
}

export async function deleteBrief(
  supabase: SupabaseClient,
  orgId: string,
  briefId: string,
): Promise<void> {
  const { error } = await supabase.from("briefs").delete().eq("org_id", orgId).eq("id", briefId);
  if (error) throw error;
}

// ---------------------------------------------------------------------
// searches
// ---------------------------------------------------------------------

export type SearchSummary = Pick<
  SearchRow,
  "id" | "brief_id" | "result_count" | "method" | "ran_by" | "created_at"
>;

const SEARCH_SUMMARY_COLUMNS = "id, brief_id, result_count, method, ran_by, created_at";

/** The searches of a brief, newest first, without their results (read one at a time). */
export async function listSearches(
  supabase: SupabaseClient,
  orgId: string,
  briefId: string,
  limit = 20,
): Promise<SearchSummary[]> {
  const { data, error } = await supabase
    .from("searches")
    .select(SEARCH_SUMMARY_COLUMNS)
    .eq("org_id", orgId)
    .eq("brief_id", briefId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as unknown as SearchSummary[];
}

/** The most searches the list reads to find the newest of each brief, and the ids one query names. */
const LATEST_SEARCH_SCAN = 400;
const LATEST_LOT = 50;

/**
 * The newest analysis of each of the briefs given, with what it
 * counted (its results, the ones the model read, the ones to present):
 * the summaries of the briefs' searches first, newest first, then the
 * results of the newest one per brief, in lots so no URL names more
 * than fifty ids. A brief without an analysis is absent from the map.
 * Known limit: the counts are made here, so this read carries the whole
 * results of each newest analysis; a digest computed in the database
 * (a migration) would spare it. The list reads it once, then keeps it
 * current from the realtime rows (`analysisOfRow`, `withAnalysis`).
 */
export async function readLatestAnalyses(
  supabase: SupabaseClient,
  orgId: string,
  briefIds: readonly string[],
): Promise<Map<string, LatestAnalysis>> {
  const out = new Map<string, LatestAnalysis>();
  if (!briefIds.length) return out;
  const summaries: SearchSummary[] = [];
  for (const lot of batchesOf(briefIds, LATEST_LOT)) {
    const { data, error } = await supabase
      .from("searches")
      .select(SEARCH_SUMMARY_COLUMNS)
      .eq("org_id", orgId)
      .in("brief_id", lot)
      .order("created_at", { ascending: false })
      .limit(LATEST_SEARCH_SCAN);
    if (error) throw error;
    summaries.push(...((data ?? []) as unknown as SearchSummary[]));
  }
  const latest = latestPerBrief(summaries);
  const searchIds = [...latest.values()].map((summary) => summary.id);
  const resultsById = new Map<string, MatchResult[]>();
  for (const lot of batchesOf(searchIds, LATEST_LOT)) {
    const { data, error } = await supabase
      .from("searches")
      .select("id, results")
      .eq("org_id", orgId)
      .in("id", lot);
    if (error) throw error;
    for (const row of (data ?? []) as unknown as { id: string; results: unknown }[])
      resultsById.set(row.id, Array.isArray(row.results) ? (row.results as MatchResult[]) : []);
  }
  for (const [briefId, summary] of latest) {
    out.set(briefId, {
      searchId: summary.id,
      createdAt: summary.created_at,
      ...digestResults(resultsById.get(summary.id) ?? []),
    });
  }
  return out;
}

/** One search with its stored results and the criteria of the time. */
export async function readSearch(
  supabase: SupabaseClient,
  orgId: string,
  searchId: string,
): Promise<SearchRow | null> {
  const { data, error } = await supabase
    .from("searches")
    .select("*")
    .eq("org_id", orgId)
    .eq("id", searchId)
    .maybeSingle();
  if (error) throw error;
  const row = data as unknown as SearchRow | null;
  if (!row) return null;
  return {
    ...row,
    criteria: parseCriteria(row.criteria),
    results: Array.isArray(row.results) ? row.results : [],
  };
}

// ---------------------------------------------------------------------
// the candidates a result list shows
// ---------------------------------------------------------------------

/**
 * What a result card needs of a candidate: the name, the position held
 * today (the experiences, the headline), where, whether still in the
 * pool, and the photo's path (signed in the browser when the
 * organisation shows photos; it identifies a person on screen only and
 * never reaches a model).
 */
export type ResultCandidate = Pick<
  CandidateRow,
  "id" | "full_name" | "headline" | "location" | "status" | "photo_path" | "experiences"
>;

const RESULT_CANDIDATE_COLUMNS =
  "id, full_name, headline, location, status, photo_path, experiences";

/** The candidates of a result list, as the cards show them; an erased one is absent. */
export async function readResultCandidates(
  supabase: SupabaseClient,
  orgId: string,
  ids: readonly string[],
): Promise<ResultCandidate[]> {
  if (!ids.length) return [];
  const { data, error } = await supabase
    .from("candidates")
    .select(RESULT_CANDIDATE_COLUMNS)
    .eq("org_id", orgId)
    .in("id", [...ids].slice(0, 200));
  if (error) throw error;
  return (data ?? []) as unknown as ResultCandidate[];
}

// ---------------------------------------------------------------------
// the shortlist of a brief
// ---------------------------------------------------------------------

export interface ShortlistState {
  /** Null until someone adds the first candidate. */
  shortlistId: string | null;
  /** The candidates already on it. */
  candidateIds: string[];
}

export async function readShortlistState(
  supabase: SupabaseClient,
  orgId: string,
  briefId: string,
): Promise<ShortlistState> {
  const { data, error } = await supabase
    .from("shortlists")
    .select("id")
    .eq("org_id", orgId)
    .eq("brief_id", briefId)
    .maybeSingle();
  if (error) throw error;
  const shortlistId = (data as { id: string } | null)?.id ?? null;
  if (!shortlistId) return { shortlistId: null, candidateIds: [] };
  const items = await supabase
    .from("shortlist_items")
    .select("candidate_id")
    .eq("org_id", orgId)
    .eq("shortlist_id", shortlistId);
  if (items.error) throw items.error;
  return {
    shortlistId,
    candidateIds: ((items.data ?? []) as { candidate_id: string }[]).map(
      (item) => item.candidate_id,
    ),
  };
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
  const { data, error } = await supabase
    .from("shortlists")
    .select("id")
    .eq("org_id", input.orgId)
    .eq("brief_id", input.briefId)
    .single();
  if (error) throw error;
  return (data as { id: string }).id;
}

export type AddOutcome = "added" | "already";

/** Adds a candidate to a shortlist with the match of the search; "already" when the pair exists. */
export async function addShortlistItem(
  supabase: SupabaseClient,
  input: {
    orgId: string;
    shortlistId: string;
    candidateId: string;
    match: MatchResult;
    userId: string;
  },
): Promise<AddOutcome> {
  const { error } = await supabase.from("shortlist_items").insert({
    org_id: input.orgId,
    shortlist_id: input.shortlistId,
    candidate_id: input.candidateId,
    match: input.match,
    added_by: input.userId,
  });
  if (!error) return "added";
  if (error.code === UNIQUE_VIOLATION) return "already";
  throw error;
}
