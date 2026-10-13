/**
 * The four numbers of the dashboard, each a count read under RLS: active
 * candidates, documents still in the queue, open briefs, candidates
 * retained this calendar month. A count that could not be read is null
 * and the tile says so; nothing is estimated.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

/** ISO instant of the first day of the month `now` is in, in the browser's time zone. */
export function monthStartIso(now: Date = new Date()): string {
  return new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0).toISOString();
}

export interface DashboardStats {
  candidates: number | null;
  processing: number | null;
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

export async function readDashboardStats(supabase: SupabaseClient, orgId: string): Promise<DashboardStats> {
  const head = { count: "exact" as const, head: true };
  const [candidates, processing, openBriefs, retainedThisMonth] = await Promise.all([
    count(supabase.from("candidates").select("id", head).eq("org_id", orgId).eq("status", "active")),
    count(supabase.from("documents").select("id", head).eq("org_id", orgId).in("status", ["queued", "processing"])),
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
  return { candidates, processing, openBriefs, retainedThisMonth };
}
