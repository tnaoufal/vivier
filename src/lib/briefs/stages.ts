/**
 * The stages the browser drives after a search, as pure reads of a
 * search's stored results: the reading of the profiles (every result
 * without an assessment, batches of ASSESS_BATCH_MAX), the second
 * opinion (every retained result without a challenge, batches of
 * CHALLENGE_BATCH_MAX), the comparative tiering (every retained or
 * borderline result without a tier, groups of RANK_GROUP_MAX sorted by
 * score) and, when the tiering took more than one group, one final
 * comparison of the A's of every group, so the order of what is
 * presented is one comparison and not several. "Resume" reads the same
 * lists from a stored search, so an interrupted analysis picks up where
 * it stopped; a candidate gone from the pool (`skip`) is settled and
 * never sent again. Tested in stages.test.ts.
 */
import type { MatchResult } from "@/lib/db/types";

import { ASSESS_BATCH_MAX, compareTiered, tierOf } from "./assessment";
import { RANK_GROUP_MAX, RANK_GROUP_MIN } from "./ranking";

export type AnalysisStage = "read" | "challenge" | "rank" | "final";

/** The most candidates one second-opinion call takes. */
export const CHALLENGE_BATCH_MAX = 6;

/** The ids of the results no model read yet, not settled. */
export function pendingReads(results: readonly MatchResult[], skip: ReadonlySet<string>): string[] {
  return results
    .filter((result) => !result.assessment && !skip.has(result.candidateId))
    .map((result) => result.candidateId);
}

/** The ids of the retained results the second opinion has not seen, not settled. */
export function pendingChallenges(
  results: readonly MatchResult[],
  skip: ReadonlySet<string>,
): string[] {
  return results
    .filter(
      (result) =>
        result.assessment?.decision === "fit" &&
        !result.assessment.challenge &&
        !skip.has(result.candidateId),
    )
    .map((result) => result.candidateId);
}

/** The retained and borderline results with an assessment, not settled, best score first. */
export function rankable(
  results: readonly MatchResult[],
  skip: ReadonlySet<string>,
): MatchResult[] {
  return results
    .filter((result) => {
      const decision = result.assessment?.decision;
      return (decision === "fit" || decision === "borderline") && !skip.has(result.candidateId);
    })
    .sort(compareTiered);
}

/**
 * The ids in groups of `size` at most; a last group of one takes one
 * from the group before it, since one candidate alone cannot be
 * compared. A single id makes no group at all.
 */
export function groupsOf(ids: readonly string[], size: number = RANK_GROUP_MAX): string[][] {
  if (ids.length < RANK_GROUP_MIN) return [];
  const groups: string[][] = [];
  for (let index = 0; index < ids.length; index += size)
    groups.push(ids.slice(index, index + size));
  const last = groups[groups.length - 1];
  const previous = groups[groups.length - 2];
  if (last && previous && last.length < RANK_GROUP_MIN) {
    const moved = previous.pop();
    if (moved !== undefined) last.unshift(moved);
  }
  return groups;
}

/**
 * The groups the tiering still has to compare: the rankable results
 * without a tier, best score first, in groups of RANK_GROUP_MAX. When
 * one alone lacks a tier, it is compared with the best already tiered
 * (they are tiered again with it); when nothing is rankable in pairs,
 * nothing is sent.
 */
export function pendingRanks(
  results: readonly MatchResult[],
  skip: ReadonlySet<string>,
): string[][] {
  const candidates = rankable(results, skip);
  const untiered = candidates.filter((result) => tierOf(result) === null);
  if (!untiered.length || candidates.length < RANK_GROUP_MIN) return [];
  if (untiered.length === 1) {
    const companions = candidates
      .filter((result) => tierOf(result) !== null)
      .slice(0, RANK_GROUP_MAX - 1);
    return [[...untiered, ...companions].map((result) => result.candidateId)];
  }
  return groupsOf(
    untiered.map((result) => result.candidateId),
    RANK_GROUP_MAX,
  );
}

/**
 * The one last group the tiering compares when it took several groups:
 * the retained results at tier A, not settled, best first, RANK_GROUP_MAX
 * at most, so the A's of different groups are ordered against each
 * other once. Nothing when fewer than two are A.
 */
export function finalRankGroup(
  results: readonly MatchResult[],
  skip: ReadonlySet<string>,
): string[][] {
  const best = rankable(results, skip)
    .filter((result) => result.assessment?.decision === "fit" && tierOf(result) === "A")
    .slice(0, RANK_GROUP_MAX)
    .map((result) => result.candidateId);
  return best.length < RANK_GROUP_MIN ? [] : [best];
}

/** How many candidates the three stages still have to send, for the "resume" button and the method line. */
export function pendingCount(results: readonly MatchResult[], skip: ReadonlySet<string>): number {
  return (
    pendingReads(results, skip).length +
    pendingChallenges(results, skip).length +
    pendingRanks(results, skip).reduce((sum, group) => sum + group.length, 0)
  );
}

/** The ids in batches of `size`. */
export function batchesOf(ids: readonly string[], size: number): string[][] {
  const out: string[][] = [];
  for (let index = 0; index < ids.length; index += size) out.push(ids.slice(index, index + size));
  return out;
}
