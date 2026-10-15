/**
 * The typed reads and writes of briefs through supabase-js under RLS:
 * the list, one brief, its searches (summaries, which never carry the
 * results: the counts a list shows and where the job stands are
 * columns of the row; then one search with its stored results; the
 * newest of each brief for the list's rows), what a whole-pool search's
 * triage stands at (counts per verdict), the profiles its screening
 * scored but nobody read (page by page, best first), the profiles it
 * set aside page by page, the candidates a result list shows (and the
 * years of the one a drawer opens), and the shortlist of a brief
 * (created on first use, items added one by one, how many it retained
 * for the brief's tab and the list's rows). The processor runs the
 * analysis and writes its row; nothing here drives it. Each call
 * filters by the organisation and casts rows at the boundary.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { isAnalysisStage, isAnalysisStatus, lotsOf } from "@vivier/analysis";

import type {
  AnalysisStatus,
  BriefRow,
  BriefStatus,
  CandidateRow,
  MatchResult,
  SearchMethod,
  SearchRow,
  SearchTriageRow,
  ShortlistItemStatus,
  TriageVerdict,
} from "@/lib/db/types";

import { parseCriteria } from "./criteria";
import { retainedByBrief } from "./presentation";
import { parseRoleProfile } from "./role-profile";

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

/** What a person edits of a brief: its title, its text and its status. The criteria and the role profile are the model's reading of the text, written by the analysis alone. */
export type BriefPatch = Partial<Pick<BriefRow, "title" | "description" | "status">>;

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

/** What a list of analyses shows of each one, and where its job stands: never its results (read one search at a time with readSearch). */
export type SearchSummary = Pick<
  SearchRow,
  | "id"
  | "brief_id"
  | "created_at"
  | "method"
  | "pool_size"
  | "result_count"
  | "assessed_count"
  | "match_count"
  | "near_count"
  | "ran_by"
  | "status"
  | "stage"
  | "progress_done"
  | "progress_total"
  | "stop_requested"
  | "error"
  | "started_at"
  | "finished_at"
>;

export const SEARCH_SUMMARY_COLUMNS =
  "id, brief_id, created_at, method, pool_size, result_count, assessed_count, match_count, near_count, ran_by, status, stage, progress_done, progress_total, stop_requested, error, started_at, finished_at";

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
  return ((data ?? []) as unknown as SearchSummary[]).map(summaryOf);
}

/**
 * The newest analysis of a brief as a list shows it, read off the
 * summary columns of its row. `status` is where its job stands (a row
 * stored before the job existed reads done), `total` the entries of
 * its results (the profiles the promotion brought in, or retrieved),
 * `poolSize` the profiles of the pool when it ran (null for rows
 * stored before the column), `assessed` the ones read in full,
 * `matches` the ones that match (decision fit), `near` the borderline
 * ones. `present` repeats `matches` for the cards written before the
 * summary columns. `triagePending` and `kept` are never read here any
 * more (the status says where the job stands); they stay null for the
 * callers that merge the triage's counts into the row.
 */
export interface AnalysisSummary {
  searchId: string;
  createdAt: string;
  method: SearchMethod;
  status: AnalysisStatus;
  poolSize: number | null;
  total: number;
  assessed: number;
  matches: number;
  near: number;
  present: number;
  triagePending: number | null;
  kept: number | null;
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** The job's status of a row: a row stored before the job existed, or read without the column, reads done (the column's default). */
function statusOf(value: unknown): AnalysisStatus {
  return isAnalysisStatus(value) ? value : "done";
}

/** A summary row with its counts and its job columns guarded at the boundary (a missing count reads 0, a missing pool size null, a missing status done). */
function summaryOf(row: SearchSummary): SearchSummary {
  return {
    ...row,
    pool_size: typeof row.pool_size === "number" ? row.pool_size : null,
    result_count: count(row.result_count),
    assessed_count: count(row.assessed_count),
    match_count: count(row.match_count),
    near_count: count(row.near_count),
    status: statusOf(row.status),
    stage: isAnalysisStage(row.stage) ? row.stage : null,
    progress_done: count(row.progress_done),
    progress_total: count(row.progress_total),
    stop_requested: row.stop_requested === true,
    error: text(row.error),
    started_at: text(row.started_at),
    finished_at: text(row.finished_at),
  };
}

const METHODS: readonly SearchMethod[] = ["hybrid", "text", "triage"];

/**
 * The analysis a summary row (a query's, or a realtime change's: its
 * summary columns travel whatever the size of its results) says, with
 * its brief; null when the row lacks its id, its brief or its date.
 */
export function analysisOfSummary(
  row: Readonly<Record<string, unknown>>,
): { briefId: string; analysis: AnalysisSummary } | null {
  const id = row["id"];
  const briefId = row["brief_id"];
  const createdAt = row["created_at"];
  const method = row["method"];
  if (typeof id !== "string" || typeof briefId !== "string" || typeof createdAt !== "string")
    return null;
  const poolSize = row["pool_size"];
  const matches = count(row["match_count"]);
  return {
    briefId,
    analysis: {
      searchId: id,
      createdAt,
      method: METHODS.find((known) => known === method) ?? "text",
      status: statusOf(row["status"]),
      poolSize: typeof poolSize === "number" && Number.isFinite(poolSize) ? poolSize : null,
      total: count(row["result_count"]),
      assessed: count(row["assessed_count"]),
      matches,
      near: count(row["near_count"]),
      present: matches,
      triagePending: null,
      kept: null,
    },
  };
}

/** The most summaries the list reads per lot of briefs to find the newest of each, and the briefs one query names. */
const LATEST_SEARCH_SCAN = 1000;
const LATEST_LOT = 50;

/**
 * The newest analysis of each of the briefs given, read off the summary
 * columns alone (never the results): the briefs' searches newest first,
 * in lots so no URL names more than fifty ids, the newest row of each
 * brief kept. Its status says whether the job ended; no other read is
 * needed. A brief without an analysis is absent from the map.
 */
export async function readLatestAnalyses(
  supabase: SupabaseClient,
  orgId: string,
  briefIds: readonly string[],
): Promise<Map<string, AnalysisSummary>> {
  const out = new Map<string, AnalysisSummary>();
  for (const lot of lotsOf([...new Set(briefIds)], LATEST_LOT)) {
    const { data, error } = await supabase
      .from("searches")
      .select(SEARCH_SUMMARY_COLUMNS)
      .eq("org_id", orgId)
      .in("brief_id", lot)
      .order("created_at", { ascending: false })
      .limit(LATEST_SEARCH_SCAN);
    if (error) throw error;
    for (const row of (data ?? []) as unknown as Record<string, unknown>[]) {
      const read = analysisOfSummary(row);
      if (!read) continue;
      const kept = out.get(read.briefId);
      if (!kept || Date.parse(read.analysis.createdAt) > Date.parse(kept.createdAt))
        out.set(read.briefId, read.analysis);
    }
  }
  return out;
}

/** One search with its stored results and the criteria of the time, its job columns guarded. */
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
    ...summaryOf(row),
    criteria: parseCriteria(row.criteria),
    results: Array.isArray(row.results) ? row.results : [],
  };
}

// ---------------------------------------------------------------------
// the triage and the screening of a whole-pool search
// ---------------------------------------------------------------------

/** Where a whole-pool search's triage stands: the profiles of its snapshot, read or not, by verdict. */
export interface TriageState {
  /** The profiles of the snapshot. */
  total: number;
  /** The ones the triage read. */
  read: number;
  yes: number;
  close: number;
  no: number;
  unknown: number;
  /** The ones still to read. */
  pending: number;
}

/** One page of search_triage, the most PostgREST answers at once. */
const TRIAGE_PAGE = 1000;

/** The verdicts the funnel keeps: the screening scores them and the promotion reads the best. A card it could not judge ("unknown") is set aside, never kept. */
const KEPT_VERDICTS: readonly TriageVerdict[] = ["yes", "close"];

/** The verdicts of the profiles the triage set aside: another job, or a card it could not judge. */
const SET_ASIDE_VERDICTS: readonly TriageVerdict[] = ["no", "unknown"];

/** The triage's counts, from count queries alone (one per verdict, one for the rows not read): no row travels. */
export async function readTriageState(
  supabase: SupabaseClient,
  orgId: string,
  searchId: string,
): Promise<TriageState> {
  const countOf = async (verdict: TriageVerdict | null): Promise<number> => {
    const base = supabase
      .from("search_triage")
      .select("candidate_id", { head: true, count: "exact" })
      .eq("org_id", orgId)
      .eq("search_id", searchId);
    const { count: total, error } = await (verdict === null
      ? base.is("verdict", null)
      : base.eq("verdict", verdict));
    if (error) throw error;
    return typeof total === "number" ? total : 0;
  };
  const [yes, close, no, unknown, pending] = await Promise.all([
    countOf("yes"),
    countOf("close"),
    countOf("no"),
    countOf("unknown"),
    countOf(null),
  ]);
  const read = yes + close + no + unknown;
  return { total: read + pending, read, yes, close, no, unknown, pending };
}

/** Where a whole-pool search's triage stands for a card: the profiles still to read, and the ones kept (yes, close), from two counts. */
export async function readTriageProgress(
  supabase: SupabaseClient,
  orgId: string,
  searchId: string,
): Promise<{ pending: number; kept: number }> {
  const countOf = async (verdicts: readonly TriageVerdict[] | null): Promise<number> => {
    const base = supabase
      .from("search_triage")
      .select("candidate_id", { head: true, count: "exact" })
      .eq("org_id", orgId)
      .eq("search_id", searchId);
    const { count: total, error } = await (verdicts === null
      ? base.is("verdict", null)
      : base.in("verdict", [...verdicts]));
    if (error) throw error;
    return typeof total === "number" ? Math.max(0, total) : 0;
  };
  const [pending, kept] = await Promise.all([countOf(null), countOf(KEPT_VERDICTS)]);
  return { pending, kept };
}

/** One profile the triage set aside: who, the verdict, and the reason on its card (the model's for "no"; for "unknown", why the card could not be judged). */
export interface SetAsideEntry {
  candidateId: string;
  verdict: Extract<TriageVerdict, "no" | "unknown">;
  reason: string | null;
}

/** One page of the profiles a triage set aside, and, on the first page, how many there are in all (null on the others). */
export interface SetAsidePage {
  rows: SetAsideEntry[];
  total: number | null;
}

/** A page size inside one PostgREST page and at one row at least. */
function pageSize(limit: number): number {
  return Math.min(TRIAGE_PAGE, Math.max(1, Math.floor(Number.isFinite(limit) ? limit : 1)));
}

/**
 * The profiles a whole-pool search's triage set aside (verdict "no":
 * another job; "unknown": a card it could not judge), one page at a
 * time, ordered by candidate id: each page starts after the last id of
 * the one before (`after`, null for the first), so a verdict written
 * between two reads never shifts a page and never hides a row. The
 * first page also counts them all. RLS decides what the caller reads.
 */
export async function listSetAside(
  supabase: SupabaseClient,
  orgId: string,
  searchId: string,
  page: { after: string | null; limit: number },
): Promise<SetAsidePage> {
  const size = pageSize(page.limit);
  const first = page.after === null;
  let request = supabase
    .from("search_triage")
    .select("candidate_id, verdict, reason", first ? { count: "exact" as const } : undefined)
    .eq("org_id", orgId)
    .eq("search_id", searchId)
    .in("verdict", [...SET_ASIDE_VERDICTS]);
  if (page.after !== null) request = request.gt("candidate_id", page.after);
  const { data, error, count } = await request
    .order("candidate_id", { ascending: true })
    .range(0, size - 1);
  if (error) throw error;
  const rows: SetAsideEntry[] = [];
  for (const row of (data ?? []) as unknown as Pick<
    SearchTriageRow,
    "candidate_id" | "verdict" | "reason"
  >[]) {
    if (typeof row.candidate_id !== "string") continue;
    if (row.verdict !== "no" && row.verdict !== "unknown") continue;
    rows.push({
      candidateId: row.candidate_id,
      verdict: row.verdict,
      reason: typeof row.reason === "string" ? row.reason : null,
    });
  }
  return {
    rows,
    total: first ? (typeof count === "number" ? Math.max(count, 0) : rows.length) : null,
  };
}

/** One profile the screening scored that nobody read in full: who, the triage's verdict, the score and its reason. */
export interface ScreenedEntry {
  candidateId: string;
  verdict: Extract<TriageVerdict, "yes" | "close">;
  score: number;
  reason: string | null;
}

/** One page of the screened profiles, how many rows it answered before the ones in the results were left out (the next page starts after them), and, on the first page, how many there are in all (null on the others). */
export interface ScreenedPage {
  rows: ScreenedEntry[];
  fetched: number;
  total: number | null;
}

/** The most ids one read excludes in its query string (the gateway refuses a URL past 16 KB); the rest are left out here. */
const EXCLUDE_LOT = 100;

/**
 * The profiles a whole-pool search's screening scored but the
 * promotion did not bring into the results (the near profiles a person
 * may still read in full): the kept rows (yes, close) with a score,
 * the ones in the results left out (`exclude`: the first hundred in the
 * query, every one here), best score first, then by candidate id, read
 * by offset (`from`, 0 for the first page; `fetched` says how far the
 * page went) since a score, once written, never changes. The first
 * page also counts them all. RLS decides what the caller reads.
 */
export async function listScreened(
  supabase: SupabaseClient,
  orgId: string,
  searchId: string,
  page: { exclude: readonly string[]; from: number; limit: number },
): Promise<ScreenedPage> {
  const size = pageSize(page.limit);
  const from = Math.max(0, Math.floor(Number.isFinite(page.from) ? page.from : 0));
  const first = from === 0;
  const excluded = new Set(page.exclude);
  let request = supabase
    .from("search_triage")
    .select(
      "candidate_id, verdict, score, score_reason",
      first ? { count: "exact" as const } : undefined,
    )
    .eq("org_id", orgId)
    .eq("search_id", searchId)
    .in("verdict", [...KEPT_VERDICTS])
    .not("score", "is", null);
  const named = [...excluded].slice(0, EXCLUDE_LOT);
  if (named.length) request = request.not("candidate_id", "in", `(${named.join(",")})`);
  const { data, error, count } = await request
    .order("score", { ascending: false })
    .order("candidate_id", { ascending: true })
    .range(from, from + size - 1);
  if (error) throw error;
  const answered = (data ?? []) as unknown as Pick<
    SearchTriageRow,
    "candidate_id" | "verdict" | "score" | "score_reason"
  >[];
  const rows: ScreenedEntry[] = [];
  for (const row of answered) {
    if (typeof row.candidate_id !== "string" || excluded.has(row.candidate_id)) continue;
    if (row.verdict !== "yes" && row.verdict !== "close") continue;
    if (typeof row.score !== "number" || !Number.isFinite(row.score)) continue;
    rows.push({
      candidateId: row.candidate_id,
      verdict: row.verdict,
      score: row.score,
      reason: typeof row.score_reason === "string" ? row.score_reason : null,
    });
  }
  return {
    rows,
    fetched: answered.length,
    total: first ? (typeof count === "number" ? Math.max(count, 0) : rows.length) : null,
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

/** The most ids one read of candidates names (the gateway refuses a URL past 16 KB). */
export const CANDIDATE_LOT = 100;

/**
 * The candidates given, by id, read in lots of CANDIDATE_LOT (however
 * many ids a list holds): each id answers its row, or null when the
 * candidate was erased (or RLS hides it).
 */
export async function readCandidatesById(
  supabase: SupabaseClient,
  orgId: string,
  ids: readonly string[],
): Promise<Map<string, ResultCandidate | null>> {
  const out = new Map<string, ResultCandidate | null>();
  for (const lot of lotsOf([...new Set(ids)], CANDIDATE_LOT)) {
    const rows = await readResultCandidates(supabase, orgId, lot);
    const byId = new Map(rows.map((row) => [row.id, row] as const));
    for (const id of lot) out.set(id, byId.get(id) ?? null);
  }
  return out;
}

/** The years of experience of one candidate, with the id they answer for (a drawer walking a list never shows the previous profile's years). */
export interface CandidateYears {
  id: string;
  years_experience: number | null;
}

/** The years the rows' read never carries, for the header of a drawer; null when the candidate is gone. */
export async function readCandidateYears(
  supabase: SupabaseClient,
  orgId: string,
  candidateId: string,
): Promise<CandidateYears | null> {
  const { data, error } = await supabase
    .from("candidates")
    .select("id, years_experience")
    .eq("org_id", orgId)
    .eq("id", candidateId)
    .maybeSingle();
  if (error) throw error;
  const row = data as unknown as CandidateYears | null;
  if (!row) return null;
  return {
    id: row.id,
    years_experience:
      typeof row.years_experience === "number" && Number.isFinite(row.years_experience)
        ? row.years_experience
        : null,
  };
}

// ---------------------------------------------------------------------
// the shortlist of a brief
// ---------------------------------------------------------------------

export interface ShortlistState {
  /** Null until someone adds the first candidate. */
  shortlistId: string | null;
  /** The candidates already on it. */
  candidateIds: string[];
  /** How many of them the team retained. */
  retained: number;
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
  if (!shortlistId) return { shortlistId: null, candidateIds: [], retained: 0 };
  const items = await supabase
    .from("shortlist_items")
    .select("candidate_id, status")
    .eq("org_id", orgId)
    .eq("shortlist_id", shortlistId);
  if (items.error) throw items.error;
  const rows = (items.data ?? []) as { candidate_id: string; status: ShortlistItemStatus }[];
  return {
    shortlistId,
    candidateIds: rows.map((item) => item.candidate_id),
    retained: rows.filter((item) => item.status === "retained").length,
  };
}

/** The retained items a shortlist embeds: an array for a to-many row; anything else counts as none. */
function embeddedItems(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

/**
 * How many candidates each brief's shortlist retained, for the list's
 * rows: the shortlists of these briefs with their retained items alone
 * (an inner join filtered on the item's status, so nothing else
 * travels), one read per lot of ids, counted here. A brief without a
 * retained candidate is absent from the map.
 */
export async function readRetainedCounts(
  supabase: SupabaseClient,
  orgId: string,
  briefIds: readonly string[],
): Promise<Map<string, number>> {
  const rows: { briefId: string | null }[] = [];
  for (const lot of lotsOf([...new Set(briefIds)], LATEST_LOT)) {
    const { data, error } = await supabase
      .from("shortlists")
      .select("brief_id, shortlist_items!inner(status)")
      .eq("org_id", orgId)
      .in("brief_id", lot)
      .eq("shortlist_items.status", "retained");
    if (error) throw error;
    for (const row of (data ?? []) as unknown as Record<string, unknown>[]) {
      const briefId = row["brief_id"];
      const count = embeddedItems(row["shortlist_items"]);
      for (let index = 0; index < count; index += 1)
        rows.push({ briefId: typeof briefId === "string" ? briefId : null });
    }
  }
  return retainedByBrief(rows);
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
