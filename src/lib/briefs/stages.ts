/**
 * The stages the browser drives after a search. A whole-pool search
 * (method "triage") starts with two of its own: the triage, every
 * profile of the snapshot sorted by métier in batches of
 * TRIAGE_BATCH_MAX, TRIAGE_CONCURRENCY calls at once (the batches that
 * failed sent once more at the end), then the promotion, one call that
 * brings the profiles kept into the results. Then, for every search, as
 * pure reads of its stored results: the reading of the profiles (every
 * result without an assessment, batches of ASSESS_BATCH_MAX,
 * READ_CONCURRENCY at once), the second opinion (every retained result
 * without a challenge, batches of CHALLENGE_BATCH_MAX), the comparative
 * tiering (every retained or borderline result without a tier, groups
 * of RANK_GROUP_MAX sorted by score) and, when the tiering took more
 * than one group, one final comparison of the A's of every group, so
 * the order of what is presented is one comparison and not several.
 * "Resume" reads the same lists from a stored search, so an interrupted
 * analysis picks up where it stopped; a candidate gone from the pool
 * (`skip`) is settled and never sent again. runPool() runs a stage's
 * batches a few at a time. Tested in stages.test.ts.
 */
import type { MatchResult } from "@/lib/db/types";

import { ASSESS_BATCH_MAX, compareTiered, tierOf } from "./assessment";
import { RANK_GROUP_MAX, RANK_GROUP_MIN } from "./ranking";

/** The stages every search goes through once its results exist. */
export type AnalysisStage = "read" | "challenge" | "rank" | "final";

/**
 * Every stage of an analysis, in order: a whole-pool search's triage and
 * promotion, then the four stages of AnalysisStage. Kept apart from it
 * so the progress keys built from AnalysisStage
 * (briefs.search.stage.*, briefs.search.progress.*) stay complete until
 * the two new ones are written.
 */
export type AnalysisStep = "triage" | "promote" | AnalysisStage;

/** The steps in the order an analysis takes them. */
export const ANALYSIS_STEPS: readonly AnalysisStep[] = [
  "triage",
  "promote",
  "read",
  "challenge",
  "rank",
  "final",
];

/** The most candidates one second-opinion call takes. */
export const CHALLENGE_BATCH_MAX = 6;

/** How many reading calls the browser keeps in flight at once: their write-backs merge entry by entry, so two batches add up. */
export const READ_CONCURRENCY = 2;

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

/**
 * How many candidates the three stages still have to send, a candidate
 * once per stage and per group: whether anything is left. A number shown
 * as profiles reads pendingProfiles().
 */
export function pendingCount(results: readonly MatchResult[], skip: ReadonlySet<string>): number {
  return (
    pendingReads(results, skip).length +
    pendingChallenges(results, skip).length +
    pendingRanks(results, skip).reduce((sum, group) => sum + group.length, 0)
  );
}

/**
 * How many distinct profiles the three stages still have to settle, for
 * the band and the end of a run: a retained profile neither challenged
 * nor tiered counts once, and the tiered companions an untiered one is
 * compared with do not count.
 */
export function pendingProfiles(
  results: readonly MatchResult[],
  skip: ReadonlySet<string>,
): number {
  const ids = new Set<string>([
    ...pendingReads(results, skip),
    ...pendingChallenges(results, skip),
  ]);
  if (pendingRanks(results, skip).length)
    for (const result of rankable(results, skip))
      if (tierOf(result) === null) ids.add(result.candidateId);
  return ids.size;
}

/** The ids in batches of `size`. */
export function batchesOf(ids: readonly string[], size: number): string[][] {
  const out: string[][] = [];
  for (let index = 0; index < ids.length; index += size) out.push(ids.slice(index, index + size));
  return out;
}

/**
 * True when nothing is left to send: no profile of the snapshot waits
 * for the triage (`triagePending`, 0 for a search without one) and the
 * three stages after it have nothing pending.
 */
export function analysisComplete(
  triagePending: number,
  results: readonly MatchResult[],
  skip: ReadonlySet<string>,
): boolean {
  return triagePending <= 0 && pendingCount(results, skip) === 0;
}

/** What a pool of workers did: the items answered, the items failed, and whether it stopped before starting them all. */
export interface PoolOutcome<T> {
  /** In the order given. */
  done: T[];
  /** In the order given: the worker threw or answered null. */
  failed: T[];
  /** True when shouldStop() kept at least one item from starting; those items are in neither list. */
  stopped: boolean;
}

/**
 * Runs `worker` on the items, `concurrency` at most at once, starting
 * them in the order given, each as soon as a place frees up. Once
 * shouldStop() answers true no new item starts (the ones in flight end
 * and are counted). A worker that throws or answers null fails its item;
 * nothing else stops the pool, so one failed batch never loses the
 * others.
 */
export async function runPool<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T) => Promise<R | null>,
  shouldStop: () => boolean = () => false,
): Promise<PoolOutcome<T>> {
  const width = Number.isFinite(concurrency) ? Math.max(1, Math.floor(concurrency)) : 1;
  // Each item boxed with its place, so an item that is itself undefined is still an item.
  const queue = items.map((item, index) => ({ item, index }));
  const outcomes: ("done" | "failed" | null)[] = items.map(() => null);
  let next = 0;
  let stopped = false;
  const lane = async (): Promise<void> => {
    for (;;) {
      const entry = queue[next];
      if (!entry) return;
      if (shouldStop()) {
        stopped = true;
        return;
      }
      next += 1;
      try {
        const answer = await worker(entry.item);
        outcomes[entry.index] = answer === null ? "failed" : "done";
      } catch {
        outcomes[entry.index] = "failed";
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(width, items.length) }, () => lane()));
  return {
    done: items.filter((_, index) => outcomes[index] === "done"),
    failed: items.filter((_, index) => outcomes[index] === "failed"),
    stopped,
  };
}
