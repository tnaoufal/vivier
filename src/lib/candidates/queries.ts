/**
 * The typed reads of the talent pool, through supabase-js under RLS:
 * the list page (search, status, tag, 50 per page), one profile, its
 * documents and comments, the set-aside counts of the organisation and
 * the wave the service is reading, the retention due date. Each read
 * filters by the organisation and casts rows at the boundary, as
 * CONVENTIONS.md says.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { CandidateRow, CandidateStatus, CommentRow, DocumentRow } from "@/lib/db/types";

import { THROUGHPUT_WINDOW_MINUTES, earliestOf, waveOf, type ProcessingWave } from "./progress";
import { QUOTA_ERROR_PATTERN } from "./quota";
import { searchOrFilter } from "./search";

export const PAGE_SIZE = 50;

/** Every column of CandidateRow, named so the embedding vector never travels to the browser. */
export const CANDIDATE_COLUMNS =
  "id, org_id, full_name, email, phone, headline, location, years_experience, availability, summary, skills, languages, experiences, education, links, tags, confidence, source, consent_status, consent_at, last_contact_at, status, fingerprint, search_text, created_by, created_at, updated_at";

/** What a list row needs; search_text and fingerprint stay on the server. */
export const CANDIDATE_LIST_COLUMNS =
  "id, org_id, full_name, headline, location, skills, languages, tags, confidence, source, consent_status, status, created_at, updated_at";

export type CandidateListRow = Pick<
  CandidateRow,
  | "id"
  | "org_id"
  | "full_name"
  | "headline"
  | "location"
  | "skills"
  | "languages"
  | "tags"
  | "confidence"
  | "source"
  | "consent_status"
  | "status"
  | "created_at"
  | "updated_at"
>;

export interface CandidateListQuery {
  orgId: string;
  status: CandidateStatus;
  /** The search box's text, raw; escaped here. */
  text: string;
  tag: string | null;
  /** Zero-based. */
  page: number;
}

export interface CandidatePage {
  rows: CandidateListRow[];
  /** The total over every page, as the database counted it. */
  total: number;
  page: number;
  pageCount: number;
}

export async function listCandidates(supabase: SupabaseClient, query: CandidateListQuery): Promise<CandidatePage> {
  const from = Math.max(0, query.page) * PAGE_SIZE;
  let request = supabase
    .from("candidates")
    .select(CANDIDATE_LIST_COLUMNS, { count: "exact" })
    .eq("org_id", query.orgId)
    .eq("status", query.status);
  const filter = searchOrFilter(query.text);
  if (filter) request = request.or(filter);
  if (query.tag) request = request.contains("tags", [query.tag]);
  const { data, error, count } = await request
    .order("updated_at", { ascending: false })
    .range(from, from + PAGE_SIZE - 1);
  if (error) throw error;
  const total = count ?? 0;
  return {
    rows: (data ?? []) as unknown as CandidateListRow[],
    total,
    page: query.page,
    pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  };
}

/** One profile of the organisation, or null when it does not exist (or was erased). */
export async function readCandidate(supabase: SupabaseClient, orgId: string, candidateId: string): Promise<CandidateRow | null> {
  const { data, error } = await supabase
    .from("candidates")
    .select(CANDIDATE_COLUMNS)
    .eq("org_id", orgId)
    .eq("id", candidateId)
    .maybeSingle();
  if (error) throw error;
  return (data as unknown as CandidateRow | null) ?? null;
}

export async function listCandidateDocuments(supabase: SupabaseClient, orgId: string, candidateId: string): Promise<DocumentRow[]> {
  const { data, error } = await supabase
    .from("documents")
    .select("*")
    .eq("org_id", orgId)
    .eq("candidate_id", candidateId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as DocumentRow[];
}

export async function listCandidateComments(supabase: SupabaseClient, orgId: string, candidateId: string): Promise<CommentRow[]> {
  const { data, error } = await supabase
    .from("comments")
    .select("*")
    .eq("org_id", orgId)
    .eq("candidate_id", candidateId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as CommentRow[];
}

/**
 * What the service set aside; the pending share is the wave's
 * (readProcessingProgress), so one read drives the banner's figures and
 * its bar alike.
 */
export interface ProcessingCounts {
  /** failed or needs_ocr, the quota refusals left out: these the service really could not read. */
  failed: number;
  /** rejected: read by the service, which did not take it for a CV; a person may disagree and retry. */
  rejected: number;
  /** failed at the organisation's monthly cap (quota.ts): not broken, waiting for the quota to allow them. */
  quota: number;
}

/** The statuses a person may want to look at: the service could not read them, or set them aside. */
const SET_ASIDE_STATUSES = ["failed", "needs_ocr", "rejected"];
/** The statuses of a document the service has not read yet: what the wave still holds. */
const PENDING_STATUSES = ["queued", "processing"];

async function countDocuments(supabase: SupabaseClient, orgId: string, statuses: string[]): Promise<number> {
  const { count, error } = await supabase
    .from("documents")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .in("status", statuses);
  if (error) throw error;
  return count ?? 0;
}

/** The documents the service has not read yet (queued or processing): they take the month's quota before anything re-queued or imported behind them. */
export async function countPendingDocuments(supabase: SupabaseClient, orgId: string): Promise<number> {
  return countDocuments(supabase, orgId, PENDING_STATUSES);
}

/** The failed documents that carry the processor's quota sentence (the same test as isQuotaFailure, in SQL). */
async function countQuotaFailures(supabase: SupabaseClient, orgId: string): Promise<number> {
  const { count, error } = await supabase
    .from("documents")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .eq("status", "failed")
    .like("error", QUOTA_ERROR_PATTERN);
  if (error) throw error;
  return count ?? 0;
}

export async function readProcessingCounts(supabase: SupabaseClient, orgId: string): Promise<ProcessingCounts> {
  const [unread, rejected, quota] = await Promise.all([
    countDocuments(supabase, orgId, ["failed", "needs_ocr"]),
    countDocuments(supabase, orgId, ["rejected"]),
    countQuotaFailures(supabase, orgId),
  ]);
  // The quota refusals are failed rows too: they leave the real failures (never below zero, the counts are not one snapshot).
  return { failed: Math.max(0, unread - quota), rejected, quota };
}

/** Where the wave stands: how many documents wait, and when the earliest of them entered the queue. */
export interface WaveStart {
  /** queued or processing */
  pending: number;
  /** updated_at of the earliest pending document (an upload or a re-queue sets it); null when nothing is pending. */
  startedAt: string | null;
}

/** What a caller of readProcessingProgress may pass: the clock, and the start of the wave it already follows. */
export interface WaveOptions {
  /** Injectable for tests. */
  now?: Date;
  /**
   * The previous read's startedAt. While the wave lasts it stays the
   * anchor (the queue's earliest document moves on as lots are read);
   * once nothing is pending, the ended wave is counted from it so the
   * banner can say how many documents it read.
   */
  startedAt?: string | null;
}

/**
 * One request: the pending count and the instant the earliest of them
 * entered the queue. updated_at, not created_at: a re-queued CV keeps
 * the created_at of its import, which would fold every document read
 * since that import into the wave.
 */
export async function readWaveStart(supabase: SupabaseClient, orgId: string): Promise<WaveStart> {
  const { data, count, error } = await supabase
    .from("documents")
    .select("updated_at", { count: "exact" })
    .eq("org_id", orgId)
    .in("status", PENDING_STATUSES)
    .order("updated_at", { ascending: true })
    .limit(1);
  if (error) throw error;
  const pending = count ?? 0;
  const first = ((data ?? []) as unknown as { updated_at?: unknown }[])[0];
  const startedAt = pending > 0 && typeof first?.updated_at === "string" ? first.updated_at : null;
  return { pending, startedAt };
}

/**
 * The documents that left the queue at or after `since`: read, set
 * aside, unreadable or failed (every status change moves updated_at, a
 * duplicate settled without a model call included), the quota refusals
 * apart: those never entered the reading and the banner counts them.
 */
async function countLeftQueueSince(supabase: SupabaseClient, orgId: string, since: string): Promise<number> {
  const { count, error } = await supabase
    .from("documents")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .not("status", "in", `(${PENDING_STATUSES.join(",")})`)
    .gte("updated_at", since)
    // A failure without a sentence is a real one; NOT LIKE alone would drop it (NULL is neither).
    .or(`error.is.null,error.not.like.${QUOTA_ERROR_PATTERN}`);
  if (error) throw error;
  return count ?? 0;
}

/**
 * The wave from its start (progress.ts): what left the queue since
 * that instant and over the last THROUGHPUT_WINDOW_MINUTES, in
 * parallel; with nothing pending, what the ended wave read (one count)
 * or, without a start, the empty wave with no request at all.
 */
export async function readWaveCounts(
  supabase: SupabaseClient,
  orgId: string,
  start: WaveStart,
  now: Date = new Date(),
): Promise<ProcessingWave> {
  if (start.startedAt === null) {
    return waveOf({ pending: 0, done: 0, leftInWindow: 0, startedAt: null });
  }
  if (start.pending === 0) {
    const done = await countLeftQueueSince(supabase, orgId, start.startedAt);
    return waveOf({ pending: 0, done, leftInWindow: 0, startedAt: start.startedAt });
  }
  const since = new Date(now.getTime() - THROUGHPUT_WINDOW_MINUTES * 60_000).toISOString();
  const [done, leftInWindow] = await Promise.all([
    countLeftQueueSince(supabase, orgId, start.startedAt),
    countLeftQueueSince(supabase, orgId, since),
  ]);
  return waveOf({ pending: start.pending, done, leftInWindow, startedAt: start.startedAt });
}

/**
 * The wave the service is reading: readWaveStart, then readWaveCounts
 * from the earlier of the start the caller follows and the queue's.
 * Two or three requests while something is pending, one when nothing
 * is (two when the caller's wave just ended). What is counted "done"
 * is what left the queue since the start: a few documents read in the
 * seconds before the next lot of an import was queued fall out when
 * that lot becomes the earliest, so a fresh page may stand a little
 * behind one that followed the wave from its start; the estimate is
 * not affected.
 */
export async function readProcessingProgress(
  supabase: SupabaseClient,
  orgId: string,
  options: WaveOptions = {},
): Promise<ProcessingWave> {
  const start = await readWaveStart(supabase, orgId);
  const startedAt = earliestOf(options.startedAt ?? null, start.startedAt);
  return readWaveCounts(supabase, orgId, { pending: start.pending, startedAt }, options.now ?? new Date());
}

/** When the hourly purge deletes the candidate, from retention_due_at(); null when unknown. */
export async function readRetentionDueAt(supabase: SupabaseClient, candidateId: string): Promise<string | null> {
  const { data, error } = await supabase.rpc("retention_due_at", { p_candidate: candidateId });
  if (error) throw error;
  return typeof data === "string" ? data : null;
}

/**
 * One side of the set-aside documents: "quota" for those the service
 * refused at the monthly cap, "other" for the real failures, the
 * unreadable and the rejected ones. Without a group, all of them.
 */
export type SetAsideGroup = "quota" | "other";

/**
 * The organisation's documents the service could not read or set aside,
 * newest first, for the list's banner. With a `group`, one side only:
 * the banner reads the two apart so a thousand quota refusals never
 * push the one real failure past the limit.
 */
export async function listFailedDocuments(
  supabase: SupabaseClient,
  orgId: string,
  limit = 50,
  group?: SetAsideGroup,
): Promise<DocumentRow[]> {
  let request = supabase.from("documents").select("*").eq("org_id", orgId).in("status", SET_ASIDE_STATUSES);
  if (group === "quota") request = request.eq("status", "failed").like("error", QUOTA_ERROR_PATTERN);
  // A failure without a sentence is a real one; NOT LIKE alone would drop it (NULL is neither).
  if (group === "other") request = request.or(`error.is.null,error.not.like.${QUOTA_ERROR_PATTERN}`);
  const { data, error } = await request.order("updated_at", { ascending: false }).limit(limit);
  if (error) throw error;
  return (data ?? []) as unknown as DocumentRow[];
}
