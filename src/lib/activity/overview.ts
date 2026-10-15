/**
 * The dashboard's reads under RLS and their pure parts, tested apart.
 * For the open briefs: where each one stands, read off the searches'
 * summary columns (never the results, which weigh megabytes), the
 * retained off the shortlist items' status column, the team's last
 * word off the threads, and the rows sorted by the last thing that
 * happened to them. For the pool: the active profiles and the CVs
 * being read. A secondary read that fails leaves its part empty (the
 * row then says "no analysis" honestly) rather than taking the page
 * down; a count that could not be read is null, never a zero.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { listBriefs, readLatestAnalyses, type AnalysisSummary } from "@/lib/briefs/queries";
import { readWaveCounts, readWaveStart, type WaveStart } from "@/lib/candidates/queries";
import type { BriefRow, ShortlistItemStatus } from "@/lib/db/types";
import { threadSummaries } from "@/lib/threads/queries";
import type { ThreadSummary } from "@/lib/threads/thread";

/** The most open briefs the dashboard shows, the most active first. */
export const OVERVIEW_BRIEFS = 8;
/** The most recently updated open briefs whose analyses and threads are read to find those. */
export const OVERVIEW_SCAN = 50;

/** What a row says of the newest analysis: nothing ran, it is not finished, N match, or N ranked without a model. */
export type AnalysisGlance =
  | { kind: "none" }
  | { kind: "unfinished" }
  | { kind: "matches"; count: number }
  | { kind: "ranked"; count: number };

/** The counts of a summary the glance reads; the triage's progress is optional (null when not read). */
export type AnalysisFacts = Pick<AnalysisSummary, "method" | "total" | "assessed" | "matches"> &
  Partial<Pick<AnalysisSummary, "triagePending" | "kept">>;

/**
 * The glance of an analysis. A whole-pool one is unfinished while its
 * results are not all read in full, while its triage has profiles left
 * or kept more than the results hold, and, when the triage's progress is
 * unknown, while nothing was read yet; done, its matches count. An
 * analysis of another method counts its matches once something was
 * read; without a model it ranked its results on text alone, which the
 * row says as such (an empty result is "0 matches" either way).
 */
export function analysisGlanceOf(analysis: AnalysisFacts | null | undefined): AnalysisGlance {
  if (!analysis) return { kind: "none" };
  if (analysis.method === "triage") {
    if (analysis.assessed < analysis.total) return { kind: "unfinished" };
    const pending = analysis.triagePending ?? null;
    const kept = analysis.kept ?? null;
    if (pending === null || kept === null) {
      return analysis.assessed === 0
        ? { kind: "unfinished" }
        : { kind: "matches", count: analysis.matches };
    }
    if (pending > 0 || kept > analysis.total) return { kind: "unfinished" };
    return { kind: "matches", count: analysis.matches };
  }
  if (analysis.assessed > 0 || analysis.total === 0)
    return { kind: "matches", count: analysis.matches };
  return { kind: "ranked", count: analysis.total };
}

/** One shortlist item as the overview reads it: its shortlist and the status the team gave. */
export interface ItemGlance {
  shortlist_id: string;
  status: ShortlistItemStatus;
}

/** How many items each shortlist has retained, by shortlist id; a shortlist seen without one answers 0. */
export function retainedByShortlist(items: readonly ItemGlance[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const seen = counts.get(item.shortlist_id) ?? 0;
    counts.set(item.shortlist_id, item.status === "retained" ? seen + 1 : seen);
  }
  return counts;
}

/** The newest readable instant among the brief's own update, its analysis and its thread. */
export function lastActivityOf(input: {
  updatedAt: string;
  analysedAt: string | null;
  threadAt: string | null;
}): string {
  let latest = input.updatedAt;
  let latestTime = Date.parse(input.updatedAt);
  for (const candidate of [input.analysedAt, input.threadAt]) {
    if (!candidate) continue;
    const time = Date.parse(candidate);
    if (Number.isNaN(time)) continue;
    if (Number.isNaN(latestTime) || time > latestTime) {
      latest = candidate;
      latestTime = time;
    }
  }
  return latest;
}

export interface BriefOverview {
  brief: Pick<BriefRow, "id" | "title" | "updated_at">;
  analysis: AnalysisGlance;
  /** When the newest analysis ran; null without one. */
  analysedAt: string | null;
  /** What the team retained on the brief's shortlist; 0 without a shortlist. */
  retained: number;
  /** The brief's thread, null while nobody wrote. */
  thread: ThreadSummary | null;
  /** The newest of the brief's update, its analysis and its thread: the rows' order. */
  lastActivityAt: string;
}

/** The rows newest activity first; two rows of one instant keep their order. */
export function sortByActivity<Row extends Pick<BriefOverview, "lastActivityAt">>(
  rows: readonly Row[],
): Row[] {
  return rows
    .map((row, index) => ({ row, index, time: Date.parse(row.lastActivityAt) }))
    .sort((a, b) => {
      const at = Number.isNaN(a.time) ? -Infinity : a.time;
      const bt = Number.isNaN(b.time) ? -Infinity : b.time;
      return bt - at || a.index - b.index;
    })
    .map((entry) => entry.row);
}

/** The retained count of each brief's shortlist, from two reads; a failed read leaves every brief at 0. */
async function readRetained(
  supabase: SupabaseClient,
  orgId: string,
  briefIds: readonly string[],
): Promise<Map<string, number>> {
  const retained = new Map<string, number>();
  const shortlists = await supabase
    .from("shortlists")
    .select("id, brief_id")
    .eq("org_id", orgId)
    .in("brief_id", [...briefIds]);
  if (shortlists.error) {
    console.error(shortlists.error);
    return retained;
  }
  const lists = (shortlists.data ?? []) as { id: string; brief_id: string }[];
  if (!lists.length) return retained;
  const items = await supabase
    .from("shortlist_items")
    .select("shortlist_id, status")
    .eq("org_id", orgId)
    .in(
      "shortlist_id",
      lists.map((list) => list.id),
    );
  if (items.error) {
    console.error(items.error);
    return retained;
  }
  const counts = retainedByShortlist((items.data ?? []) as unknown as ItemGlance[]);
  for (const list of lists) retained.set(list.brief_id, counts.get(list.id) ?? 0);
  return retained;
}

/**
 * The open briefs with where each stands, the most recently active
 * first: the briefs (the fifty most recently updated at most), then in
 * parallel their newest analyses (summary columns), their shortlists'
 * retained counts and their threads' last message. A secondary read
 * that fails leaves its part empty.
 */
export async function readBriefsOverview(
  supabase: SupabaseClient,
  orgId: string,
  limit: number = OVERVIEW_BRIEFS,
): Promise<BriefOverview[]> {
  const briefs = (await listBriefs(supabase, orgId, "open")).slice(0, OVERVIEW_SCAN);
  if (!briefs.length) return [];
  const ids = briefs.map((brief) => brief.id);
  const empty = <T>(caught: unknown): Map<string, T> => {
    console.error(caught);
    return new Map<string, T>();
  };
  const [analyses, retained, threads] = await Promise.all([
    readLatestAnalyses(supabase, orgId, ids).catch(empty<AnalysisSummary>),
    readRetained(supabase, orgId, ids),
    threadSummaries(supabase, orgId, ids).catch(empty<ThreadSummary>),
  ]);
  const rows = briefs.map((brief): BriefOverview => {
    const analysis = analyses.get(brief.id) ?? null;
    const thread = threads.get(brief.id) ?? null;
    return {
      brief: { id: brief.id, title: brief.title, updated_at: brief.updated_at },
      analysis: analysisGlanceOf(analysis),
      analysedAt: analysis?.createdAt ?? null,
      retained: retained.get(brief.id) ?? 0,
      thread,
      lastActivityAt: lastActivityOf({
        updatedAt: brief.updated_at,
        analysedAt: analysis?.createdAt ?? null,
        threadAt: thread?.lastAt ?? null,
      }),
    };
  });
  return sortByActivity(rows).slice(0, Math.max(0, limit));
}

export interface PoolGlance {
  /** Active profiles; null when the count could not be read. */
  candidates: number | null;
  /** Documents queued or being read; null when unread. */
  processing: number | null;
  /** Every document of the wave in progress; 0 when nothing is pending, null when unread. */
  processingTotal: number | null;
}

/**
 * The wave's pending and total: null for what could not be read. The
 * pending count is one request; when it was read, a failure of the
 * wave's counts leaves it and takes the bar alone.
 */
async function wave(
  supabase: SupabaseClient,
  orgId: string,
): Promise<{ pending: number | null; total: number | null }> {
  let start: WaveStart;
  try {
    start = await readWaveStart(supabase, orgId);
  } catch (error) {
    console.error(error);
    return { pending: null, total: null };
  }
  if (start.pending === 0) return { pending: 0, total: 0 };
  try {
    const read = await readWaveCounts(supabase, orgId, start);
    return { pending: start.pending, total: read.total };
  } catch (error) {
    console.error(error);
    return { pending: start.pending, total: null };
  }
}

/** One glance at the pool: the active profiles (a HEAD count) and the CVs being read. Never throws. */
export async function readPoolGlance(supabase: SupabaseClient, orgId: string): Promise<PoolGlance> {
  const [candidates, processing] = await Promise.all([
    supabase
      .from("candidates")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId)
      .eq("status", "active")
      .then(({ count, error }) => {
        if (error) {
          console.error(error);
          return null;
        }
        return typeof count === "number" ? count : null;
      }),
    wave(supabase, orgId),
  ]);
  return { candidates, processing: processing.pending, processingTotal: processing.total };
}
