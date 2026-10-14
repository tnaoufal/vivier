/**
 * Pure helpers behind what the briefs pages show, kept apart from the
 * analysis itself (assessment.ts and its rules are the frozen part):
 * the muted line of a brief card, the status filter of the list, the
 * newest analysis of each brief and what it counted (kept current from
 * the realtime rows themselves), the tier a result card names only when
 * its group does not already say it, and the turn each card takes when
 * a list unfolds (a batch that lands rises in one card after the other,
 * a card already on screen never moves again). Tested in
 * presentation.test.ts.
 */
import type { AssessmentTier, BriefRow, BriefStatus, MatchResult } from "@/lib/db/types";

import { bucketResults } from "./assessment";

/** The first non-empty line of a text, trimmed; "" when there is none. */
export function firstLine(text: string | null | undefined): string {
  if (!text) return "";
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed) return trimmed;
  }
  return "";
}

/**
 * The muted line under a brief's title: the domain of its role profile
 * when one was written (what the job is in the market), else the first
 * line of the need; "" when the brief states neither.
 */
export function briefSubtitle(brief: Pick<BriefRow, "description" | "role_profile">): string {
  const domain = brief.role_profile?.domain?.trim();
  if (domain) return domain;
  return firstLine(brief.description);
}

export type BriefFilter = BriefStatus | "all";

export const BRIEF_FILTERS: readonly BriefFilter[] = ["all", "open", "draft", "closed"];

export function isBriefFilter(value: unknown): value is BriefFilter {
  return typeof value === "string" && (BRIEF_FILTERS as readonly string[]).includes(value);
}

/** The rows the filter keeps, in the order given. */
export function filterBriefs<T extends Pick<BriefRow, "status">>(
  rows: readonly T[],
  filter: BriefFilter,
): T[] {
  return filter === "all" ? [...rows] : rows.filter((row) => row.status === filter);
}

/** How many rows each filter would show, for the counts next to the options. */
export function countByFilter<T extends Pick<BriefRow, "status">>(
  rows: readonly T[],
): Record<BriefFilter, number> {
  const counts: Record<BriefFilter, number> = { all: rows.length, open: 0, draft: 0, closed: 0 };
  for (const row of rows) counts[row.status] += 1;
  return counts;
}

/** The newest row of each brief, whatever order the rows come in; a row without a brief is skipped. */
export function latestPerBrief<T extends { brief_id: string | null; created_at: string }>(
  rows: readonly T[],
): Map<string, T> {
  const latest = new Map<string, T>();
  for (const row of rows) {
    if (!row.brief_id) continue;
    const kept = latest.get(row.brief_id);
    if (!kept || Date.parse(row.created_at) > Date.parse(kept.created_at))
      latest.set(row.brief_id, row);
  }
  return latest;
}

/** What an analysis counted: its results, how many the model read, how many are to present. */
export interface AnalysisDigest {
  total: number;
  assessed: number;
  present: number;
}

export function digestResults(results: readonly MatchResult[]): AnalysisDigest {
  const buckets = bucketResults(results);
  return {
    total: results.length,
    assessed: results.length - buckets.unassessed.length,
    present: buckets.present.length,
  };
}

/** The newest analysis of a brief as its card says it: when it ran and what it counted. */
export interface LatestAnalysis extends AnalysisDigest {
  searchId: string;
  createdAt: string;
}

/**
 * The analysis a realtime change of a search carries, read off the row
 * itself (an analysis patches its results batch after batch): its
 * brief, when it ran and what it counted. Null when the row lacks one
 * of them (realtime leaves out a value too large to carry), so the
 * caller reads the analyses again instead.
 */
export function analysisOfRow(
  row: Readonly<Record<string, unknown>>,
): { briefId: string; analysis: LatestAnalysis } | null {
  const id = row["id"];
  const briefId = row["brief_id"];
  const createdAt = row["created_at"];
  const results: unknown = row["results"];
  if (typeof id !== "string" || typeof briefId !== "string" || typeof createdAt !== "string")
    return null;
  if (!Array.isArray(results)) return null;
  return {
    briefId,
    analysis: { searchId: id, createdAt, ...digestResults(results as MatchResult[]) },
  };
}

/**
 * The newest analyses once one search changed: the change takes its
 * brief's place when it is the same search or a newer one, so a late
 * patch of an older search never hides the newest. The map given is
 * left untouched; it is answered as is when nothing changes.
 */
export function withAnalysis(
  latest: ReadonlyMap<string, LatestAnalysis>,
  briefId: string,
  analysis: LatestAnalysis,
): ReadonlyMap<string, LatestAnalysis> {
  const kept = latest.get(briefId);
  if (
    kept &&
    kept.searchId !== analysis.searchId &&
    Date.parse(analysis.createdAt) <= Date.parse(kept.createdAt)
  )
    return latest;
  const next = new Map(latest);
  next.set(briefId, analysis);
  return next;
}

/** The groups the results of an analysis sit in, each under its own title. */
export type ResultGroupName = "present" | "deeper" | "setAside" | "unassessed" | "ranked";

/**
 * The group whose title a tier repeats: "to present" for A, "to dig
 * into" for B; null for C, which no group is named after. A card shows
 * its tier only when it sits in another group, so the pill never says
 * what the heading above it already said.
 */
export function tierGroup(tier: AssessmentTier): ResultGroupName | null {
  if (tier === "A") return "present";
  if (tier === "B") return "deeper";
  return null;
}

/**
 * The turn each key takes in a list that unfolds: a key already known
 * keeps the turn it was given (so a card on screen never animates
 * again), the new keys count from 0 in the order given (so a batch
 * that lands rises in one card after the other). Keys known before but
 * absent now are forgotten.
 */
export function arrivalIndexes(
  known: ReadonlyMap<string, number>,
  keys: readonly string[],
): Map<string, number> {
  const next = new Map<string, number>();
  let arrived = 0;
  for (const key of keys) {
    if (next.has(key)) continue;
    const turn = known.get(key);
    if (turn === undefined) {
      next.set(key, arrived);
      arrived += 1;
    } else {
      next.set(key, turn);
    }
  }
  return next;
}
