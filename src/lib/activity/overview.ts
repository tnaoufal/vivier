/**
 * The dashboard's "open briefs" column: for the few most recently
 * touched open briefs, where each one stands. The last analysis is read
 * from the searches' summary columns (when, how many profiles match:
 * `match_count`, kept by merge_search_results; the results themselves
 * stay in the database, they weigh megabytes); the
 * shortlist's counts come from its items' three small columns (the
 * status the team gave, the decision and the tier the model gave), so
 * the card can say "3 proposed (model), 1 retained" without loading a board.
 * The pure parts (one search per brief, the counts) are tested apart.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { listBriefs } from "@/lib/briefs/queries";
import type { BriefRow, ShortlistItemStatus } from "@/lib/db/types";

/** The most open briefs the dashboard shows. */
export const OVERVIEW_BRIEFS = 4;

/** A search's summary: the brief it ran for, when, and how many profiles match. */
export interface SearchGlance {
  brief_id: string | null;
  match_count: number;
  created_at: string;
}

/** One shortlist item as the overview reads it: the team's status, the model's decision and tier. */
export interface ItemGlance {
  shortlist_id: string;
  status: ShortlistItemStatus;
  decision: string | null;
  tier: string | null;
}

export interface ShortlistCounts {
  /** The model's "fit" with tier A (or not tiered yet), not dismissed by the team: the proposals. */
  present: number;
  /** What the team retained. */
  retained: number;
  /** What the team has still to decide on. */
  toReview: number;
  /** Every item, whatever its status. */
  total: number;
}

export interface BriefOverview {
  brief: Pick<BriefRow, "id" | "title" | "status" | "criteria" | "updated_at">;
  /** The latest analysis (when, how many matches), null when none ran. */
  lastSearch: { at: string; matches: number } | null;
  /** The shortlist's counts, null when the brief has no shortlist yet. */
  shortlist: ShortlistCounts | null;
}

/** The newest search of each brief, from rows in any order. */
export function latestPerBrief(rows: readonly SearchGlance[]): Map<string, SearchGlance> {
  const latest = new Map<string, SearchGlance>();
  for (const row of rows) {
    if (!row.brief_id) continue;
    const seen = latest.get(row.brief_id);
    if (!seen || Date.parse(row.created_at) > Date.parse(seen.created_at)) latest.set(row.brief_id, row);
  }
  return latest;
}

/** True when the model's reading of this item says "present": a fit, tier A or not tiered yet. */
export function isProposed(item: Pick<ItemGlance, "decision" | "tier">): boolean {
  return item.decision === "fit" && (item.tier === null || item.tier === "A");
}

/** The counts of one shortlist's items. */
export function countItems(items: readonly Pick<ItemGlance, "status" | "decision" | "tier">[]): ShortlistCounts {
  const counts: ShortlistCounts = { present: 0, retained: 0, toReview: 0, total: 0 };
  for (const item of items) {
    counts.total += 1;
    if (item.status === "retained") counts.retained += 1;
    if (item.status === "to_review") counts.toReview += 1;
    if (item.status !== "dismissed" && isProposed(item)) counts.present += 1;
  }
  return counts;
}

/** The counts of every shortlist, by shortlist id. */
export function countByShortlist(items: readonly ItemGlance[]): Map<string, ShortlistCounts> {
  const grouped = new Map<string, ItemGlance[]>();
  for (const item of items) {
    const list = grouped.get(item.shortlist_id);
    if (list) list.push(item);
    else grouped.set(item.shortlist_id, [item]);
  }
  const counts = new Map<string, ShortlistCounts>();
  for (const [id, list] of grouped) counts.set(id, countItems(list));
  return counts;
}

/**
 * The open briefs' overview, three reads after the briefs: the recent
 * searches of those briefs (a few per brief at most), their shortlists,
 * and the items' glance columns. A failed secondary read leaves its part
 * null (the card then says "no analysis" or "empty shortlist" honestly)
 * rather than taking the whole column down.
 */
export async function readBriefsOverview(
  supabase: SupabaseClient,
  orgId: string,
  limit: number = OVERVIEW_BRIEFS,
): Promise<BriefOverview[]> {
  const briefs = (await listBriefs(supabase, orgId, "open")).slice(0, Math.max(0, limit));
  if (!briefs.length) return [];
  const ids = briefs.map((brief) => brief.id);

  const [searches, shortlists] = await Promise.all([
    supabase
      .from("searches")
      .select("brief_id, match_count, created_at")
      .eq("org_id", orgId)
      .in("brief_id", ids)
      .order("created_at", { ascending: false })
      .limit(ids.length * 8),
    supabase.from("shortlists").select("id, brief_id").eq("org_id", orgId).in("brief_id", ids),
  ]);
  if (searches.error) console.error(searches.error);
  if (shortlists.error) console.error(shortlists.error);
  const latest = latestPerBrief((searches.data ?? []) as SearchGlance[]);
  const lists = (shortlists.data ?? []) as { id: string; brief_id: string }[];

  let counts = new Map<string, ShortlistCounts>();
  if (lists.length) {
    const items = await supabase
      .from("shortlist_items")
      .select("shortlist_id, status, decision:match->assessment->>decision, tier:match->assessment->>tier")
      .eq("org_id", orgId)
      .in(
        "shortlist_id",
        lists.map((list) => list.id),
      );
    if (items.error) console.error(items.error);
    else counts = countByShortlist((items.data ?? []) as unknown as ItemGlance[]);
  }
  const shortlistOf = new Map(lists.map((list) => [list.brief_id, list.id]));

  return briefs.map((brief) => {
    const search = latest.get(brief.id);
    const shortlistId = shortlistOf.get(brief.id);
    return {
      brief: { id: brief.id, title: brief.title, status: brief.status, criteria: brief.criteria, updated_at: brief.updated_at },
      lastSearch: search ? { at: search.created_at, matches: search.match_count } : null,
      shortlist: shortlistId ? (counts.get(shortlistId) ?? { present: 0, retained: 0, toReview: 0, total: 0 }) : null,
    };
  });
}
