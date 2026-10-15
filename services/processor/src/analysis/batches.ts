/**
 * The pure mechanics of a run's batches, apart from the steps so they
 * can be tested without a database or a model: a pool that runs items
 * a few at a time and stops taking new ones when asked (runPool); the
 * batched reader of the triage and the screening, which reads the
 * batches through the pool, reads a batch the model could not answer
 * again in halves (splitBatch) down to BATCH_MIN cards, and settles a
 * part that small once it failed BATCH_FAILURES_MAX times at that size
 * (settlesUnknown), so no batch is retried forever (readBatched); the
 * class of a failed call (failureKind: the content a smaller batch may
 * get past, or the provider, the same for any batch) and the wait a
 * provider's refusal names (retryAfterMs); and the groups the tiering
 * compares, the same makers the web app drove the stages with
 * (pendingRankGroups, finalRankGroup). Tested in
 * analysis-batches.test.ts.
 */
import {
  BATCH_MIN,
  compareTiered,
  RANK_GROUP_MAX,
  RANK_GROUP_MIN,
  settlesUnknown,
  splitBatch,
  tierOf,
  type MatchResult,
} from "@vivier/analysis";

import { ModelError } from "../model.js";

/**
 * Runs `worker` on the items, `concurrency` at most at once, in the
 * order given, each as soon as a place frees up. Once shouldStop()
 * answers true no new item starts (the ones in flight end). A worker
 * that throws stops the pool the same way, and the error is thrown
 * once the items in flight have ended: a batch's failure is the
 * worker's to settle, a thrown error is the run's. Answers true when
 * shouldStop() kept at least one item from starting.
 */
export async function runPool<T>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
  shouldStop: () => boolean = () => false,
): Promise<boolean> {
  const width = Number.isFinite(concurrency) ? Math.max(1, Math.floor(concurrency)) : 1;
  // The lanes share the state through one object: a closure's assignment is invisible to the narrowing below.
  const state: { next: number; stopped: boolean; failure: { error: unknown } | null } = {
    next: 0,
    stopped: false,
    failure: null,
  };
  const lane = async (): Promise<void> => {
    for (;;) {
      if (state.failure) return;
      if (state.next >= items.length) return;
      if (shouldStop()) {
        state.stopped = true;
        return;
      }
      const item = items[state.next];
      state.next += 1;
      if (item === undefined) continue;
      try {
        await worker(item);
      } catch (error) {
        state.failure = { error };
        return;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(width, items.length) }, () => lane()));
  if (state.failure) throw state.failure.error;
  return state.stopped;
}

/** What a batched read needs from its step: the call, the failure's account, the settlement. */
export interface BatchReader<T> {
  /** One call on a part: true once its items are written; false when the model could not answer it (a content failure). Throws for anything the run must fail on. */
  read(part: readonly T[]): Promise<boolean>;
  /** One more failed call on the part's items, kept on their rows (the attempts a person sees). */
  failed(part: readonly T[]): Promise<void>;
  /** The part is settled as unreadable, written as such. */
  settle(part: readonly T[]): Promise<void>;
}

/** A batch still to read, with the failed calls it took at its present size: a split starts its halves at none. */
interface PendingPart<T> {
  part: readonly T[];
  failures: number;
}

export interface BatchReport {
  /** Calls made, the failed ones included. */
  calls: number;
  /** Calls the model could not answer. */
  failures: number;
  /** Items settled as unreadable. */
  unreadable: number;
  /** True when shouldStop() kept at least one part from being read. */
  stopped: boolean;
}

/**
 * Reads the batches through the pool, round by round: a batch the
 * model could not answer counts one failure for its cards, then is
 * read again in the next round in halves when it holds more than
 * BATCH_MIN cards, as it is when it does not, and a part of BATCH_MIN
 * cards or fewer that failed BATCH_FAILURES_MAX times at that size is
 * settled instead. The failures are counted at the part's size: what
 * a batch of forty could not get past says nothing of a part of ten,
 * which the model may well answer, so every part gets its own two
 * calls (the rows' attempts count every failed call all the same). A
 * part that is read is written at once, so a stop between two rounds
 * loses nothing.
 */
export async function readBatched<T>(
  batches: readonly (readonly T[])[],
  concurrency: number,
  reader: BatchReader<T>,
  shouldStop: () => boolean = () => false,
): Promise<BatchReport> {
  const report: BatchReport = { calls: 0, failures: 0, unreadable: 0, stopped: false };
  let pending: PendingPart<T>[] = batches
    .filter((batch) => batch.length > 0)
    .map((part) => ({ part, failures: 0 }));
  while (pending.length > 0) {
    const next: PendingPart<T>[] = [];
    const stopped = await runPool(
      pending,
      concurrency,
      async ({ part, failures }) => {
        report.calls += 1;
        if (await reader.read(part)) return;
        report.failures += 1;
        await reader.failed(part);
        const failed = failures + 1;
        if (settlesUnknown(part.length, failed)) {
          await reader.settle(part);
          report.unreadable += part.length;
        } else if (part.length > BATCH_MIN) {
          const [first, second] = splitBatch(part);
          next.push({ part: first, failures: 0 }, { part: second, failures: 0 });
        } else {
          next.push({ part, failures: failed });
        }
      },
      shouldStop,
    );
    if (stopped) {
      report.stopped = true;
      break;
    }
    pending = next;
  }
  return report;
}

/**
 * The class of a failed model call: "content" when a smaller batch may
 * get past it (the model answered no valid JSON, or the call was
 * refused for what it carried: 400, 413, 422, or timed out), "provider"
 * when the failure is the same for any batch (the key, the rate, a
 * server error, the network), "other" for anything that is not a model
 * failure (the database, a bug): the run fails on it as it is.
 */
export function failureKind(error: unknown): "content" | "provider" | "other" {
  if (!(error instanceof ModelError)) return "other";
  const cause = error.cause;
  if (cause === undefined || cause === null) return "content";
  const status = (cause as { status?: unknown }).status;
  if (typeof status === "number") {
    return status === 400 || status === 413 || status === 422 ? "content" : "provider";
  }
  const name = cause instanceof Error ? `${cause.name} ${cause.message}` : String(cause);
  return /timeout|timed out/i.test(name) ? "content" : "provider";
}

/** A Retry-After longer than this is not waited for: the ladder's last step covers a minute, and a provider down for longer fails the run. */
export const RETRY_AFTER_MAX_MS = 60_000;

/** One header of a provider's answer, whether the SDK carries them as a Headers object (openai 5) or a plain record (openai 4). */
function headerOf(headers: unknown, name: string): string | null {
  if (!headers || typeof headers !== "object") return null;
  const get = (headers as { get?: unknown }).get;
  const value =
    typeof get === "function"
      ? (get as (name: string) => unknown).call(headers, name)
      : (headers as Record<string, unknown>)[name];
  return typeof value === "string" ? value : null;
}

/**
 * The wait a provider's refusal names (a Retry-After header: seconds,
 * or a date), in milliseconds; 0 when the error carries none, when it
 * cannot be read, or when it is longer than RETRY_AFTER_MAX_MS. The
 * caller waits the longer of it and its own ladder's step.
 */
export function retryAfterMs(error: unknown, now: number = Date.now()): number {
  if (!(error instanceof ModelError) || !error.cause || typeof error.cause !== "object") return 0;
  const raw = headerOf((error.cause as { headers?: unknown }).headers, "retry-after");
  if (!raw) return 0;
  const seconds = Number(raw);
  const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(raw) - now;
  return ms > 0 && ms <= RETRY_AFTER_MAX_MS ? Math.round(ms) : 0;
}

/** The results the tiering compares: retained or borderline, assessed, not settled this run, best first. */
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
 * without a tier, best first, in groups of RANK_GROUP_MAX. When one
 * alone lacks a tier, it is compared with the best already tiered
 * (tiered again with it); when nothing is rankable in pairs, nothing.
 */
export function pendingRankGroups(
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
 * The one last group the tiering compares when it took several: the
 * retained results at tier A, best first, RANK_GROUP_MAX at most, so
 * the A's of different groups are ordered against each other once.
 * Nothing when fewer than two are A.
 */
export function finalRankGroup(
  results: readonly MatchResult[],
  skip: ReadonlySet<string>,
): string[] {
  const best = rankable(results, skip)
    .filter((result) => result.assessment?.decision === "fit" && tierOf(result) === "A")
    .slice(0, RANK_GROUP_MAX)
    .map((result) => result.candidateId);
  return best.length < RANK_GROUP_MIN ? [] : best;
}

/** True when the tiering spans several groups: the final comparison of the A's is then due once the groups are tiered. */
export function spansSeveralGroups(
  results: readonly MatchResult[],
  skip: ReadonlySet<string>,
): boolean {
  return rankable(results, skip).length > RANK_GROUP_MAX;
}
