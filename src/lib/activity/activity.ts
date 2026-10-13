/**
 * Reading the activity log under RLS: a page of rows for an organisation
 * (newest first, optionally one family of kinds) and the names of the
 * briefs and candidates those rows point at, so the feed can say
 * "Jean Dupont" rather than an id. A row that points at something gone
 * simply gets no name (the sentence then uses a generic word).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { ActivityRow, OrgRole, ProfileRow } from "@/lib/db/types";
import { memberName } from "@/lib/org/org-context";

import type { ActivityFamily, ActivityNames } from "./describe";

export const ACTIVITY_PAGE = 50;

export interface ActivityPageOptions {
  family: ActivityFamily | null;
  /** Zero-based, inclusive bounds as for PostgREST's range. */
  from: number;
  to: number;
}

export async function readActivities(
  supabase: SupabaseClient,
  orgId: string,
  options: ActivityPageOptions,
): Promise<ActivityRow[]> {
  let query = supabase
    .from("activities")
    .select("*")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(options.from, options.to);
  if (options.family) query = query.like("kind", `${options.family}.%`);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as ActivityRow[];
}

/** The titles and names the rows point at, read in two queries at most. */
export async function readActivityTargets(
  supabase: SupabaseClient,
  rows: ActivityRow[],
): Promise<Pick<ActivityNames, "briefs" | "candidates">> {
  const briefIds = unique(rows.map((row) => row.brief_id));
  const candidateIds = unique(rows.map((row) => row.candidate_id));
  const briefs = new Map<string, string>();
  const candidates = new Map<string, string>();
  const [briefRows, candidateRows] = await Promise.all([
    briefIds.length ? supabase.from("briefs").select("id, title").in("id", briefIds) : null,
    candidateIds.length ? supabase.from("candidates").select("id, full_name").in("id", candidateIds) : null,
  ]);
  if (briefRows) {
    if (briefRows.error) console.error(briefRows.error);
    for (const row of (briefRows.data ?? []) as { id: string; title: string }[]) briefs.set(row.id, row.title);
  }
  if (candidateRows) {
    if (candidateRows.error) console.error(candidateRows.error);
    for (const row of (candidateRows.data ?? []) as { id: string; full_name: string | null }[]) {
      if (row.full_name?.trim()) candidates.set(row.id, row.full_name.trim());
    }
  }
  return { briefs, candidates };
}

/** People by id, from the organisation context's members map. */
export function memberNames(members: Map<string, ProfileRow & { role: OrgRole }>): Map<string, string> {
  const names = new Map<string, string>();
  for (const [id, profile] of members) names.set(id, memberName(profile, id.slice(0, 8)));
  return names;
}

function unique(ids: (string | null)[]): string[] {
  return Array.from(new Set(ids.filter((id): id is string => typeof id === "string" && id.length > 0)));
}
