/**
 * The four numbers of the dashboard, each a count read under RLS: active
 * candidates, documents still in the queue (with the size of the wave
 * they belong to, so the tile can draw their progress: up to three
 * requests while something is pending, one otherwise), open briefs,
 * candidates retained this calendar month. A count that could not be
 * read is null and the tile says so; nothing is estimated.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { readWaveCounts, readWaveStart, type WaveStart } from "@/lib/candidates/queries";

/** ISO instant of the first day of the month `now` is in, in the browser's time zone. */
export function monthStartIso(now: Date = new Date()): string {
  return new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0).toISOString();
}

export interface DashboardStats {
  candidates: number | null;
  /** queued or processing: the pending share of the wave. */
  processing: number | null;
  /** Every document of the wave in progress (progress.ts); 0 when nothing is pending, null when unread. */
  processingTotal: number | null;
  openBriefs: number | null;
  retainedThisMonth: number | null;
}

async function count(query: PromiseLike<{ count: number | null; error: unknown }>): Promise<number | null> {
  const { count: value, error } = await query;
  if (error) {
    console.error(error);
    return null;
  }
  return typeof value === "number" ? value : null;
}

/**
 * The wave's pending and total: null for what could not be read (the
 * tile shows a dash, never a zero). The pending count is one request;
 * when it was read, a failure of the wave's counts leaves it and takes
 * the bar alone.
 */
async function wave(supabase: SupabaseClient, orgId: string): Promise<{ pending: number | null; total: number | null }> {
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

export async function readDashboardStats(supabase: SupabaseClient, orgId: string): Promise<DashboardStats> {
  const head = { count: "exact" as const, head: true };
  const [candidates, processing, openBriefs, retainedThisMonth] = await Promise.all([
    count(supabase.from("candidates").select("id", head).eq("org_id", orgId).eq("status", "active")),
    wave(supabase, orgId),
    count(supabase.from("briefs").select("id", head).eq("org_id", orgId).eq("status", "open")),
    count(
      supabase
        .from("shortlist_items")
        .select("id", head)
        .eq("org_id", orgId)
        .eq("status", "retained")
        .gte("decided_at", monthStartIso()),
    ),
  ]);
  return {
    candidates,
    processing: processing.pending,
    processingTotal: processing.total,
    openBriefs,
    retainedThisMonth,
  };
}
