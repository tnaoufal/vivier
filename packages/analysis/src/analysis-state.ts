/**
 * The pure state machine of an analysis run by the processor: the
 * statuses a searches row goes through (queued, running, stopped, done,
 * failed), the stages in their order (the brief's reading, the snapshot
 * of the pool, the triage, the screening, the promotion, the full
 * reading, the second opinion, the tiering, the final comparison), the
 * stage the remaining work decides (nextStage: every stage is
 * idempotent and reads what it lacks from the database, so a stopped or
 * crashed run resumes where it was), and the overall progress a stage's
 * own count gives (progressOf: each stage owns a span of the bar, so
 * the bar never goes back). Shared by the runner and the page; tested
 * in analysis-state.test.ts.
 */

export type AnalysisStatus = "queued" | "running" | "stopped" | "done" | "failed";

export const ANALYSIS_STATUSES: readonly AnalysisStatus[] = [
  "queued",
  "running",
  "stopped",
  "done",
  "failed",
];

export function isAnalysisStatus(value: unknown): value is AnalysisStatus {
  return typeof value === "string" && (ANALYSIS_STATUSES as readonly string[]).includes(value);
}

/** True for a status nothing runs under any more: the row is read, never worked on, until a person starts it again. */
export function isTerminalStatus(status: AnalysisStatus): boolean {
  return status === "stopped" || status === "done" || status === "failed";
}

/** The error a done run carries when promoted profiles could not be read twice: "assess_failed:N". */
export const ASSESS_FAILED_PREFIX = "assess_failed:";

/** The error of a done run with `count` failed full readings; null when every reading answered. */
export function assessFailedError(count: number): string | null {
  return Number.isInteger(count) && count > 0 ? `${ASSESS_FAILED_PREFIX}${count}` : null;
}

/** How many full readings a done run's error says failed (its profiles stay unassessed until the run is queued again); 0 for any other error or none. */
export function unreadOf(error: string | null | undefined): number {
  if (typeof error !== "string" || !error.startsWith(ASSESS_FAILED_PREFIX)) return 0;
  const count = Number(error.slice(ASSESS_FAILED_PREFIX.length));
  return Number.isInteger(count) && count > 0 ? count : 0;
}

export type AnalysisStage =
  | "reading"
  | "snapshot"
  | "triage"
  | "screening"
  | "promotion"
  | "assessing"
  | "challenging"
  | "ranking"
  | "final";

/** The stages in the order a run takes them. */
export const STAGE_ORDER: readonly AnalysisStage[] = [
  "reading",
  "snapshot",
  "triage",
  "screening",
  "promotion",
  "assessing",
  "challenging",
  "ranking",
  "final",
];

export function isAnalysisStage(value: unknown): value is AnalysisStage {
  return typeof value === "string" && (STAGE_ORDER as readonly string[]).includes(value);
}

/** The place of a stage in the order, 0 first. */
export function stageIndex(stage: AnalysisStage): number {
  return STAGE_ORDER.indexOf(stage);
}

/** What a run still has to do, as the runner reads it from the database before each step. */
export interface RemainingWork {
  /** True when the brief was never read, or read from another text (needsDerivation): one model call before anything else. */
  briefUnread: boolean;
  /** True once the snapshot of the pool was taken (start_triage ran, the pool size is written), even for an empty pool. */
  snapshotTaken: boolean;
  /** Rows of the snapshot without a verdict. */
  triagePending: number;
  /** Kept rows (yes, close) not screened yet. */
  screenPending: number;
  /** True while a promotable row (the best by score, a forced one) is not in the results yet. */
  promotionPending: boolean;
  /** Results without an assessment. */
  assessPending: number;
  /** Retained results without a second opinion. */
  challengePending: number;
  /** Retained or borderline results without a tier, when there are enough of them to compare. */
  rankPending: number;
  /** True while the one last comparison of the A's of several groups is due. */
  finalPending: boolean;
}

/**
 * The stage the remaining work calls for, the first in order that has
 * something left; null when nothing is left and the run is done.
 */
export function nextStage(work: RemainingWork): AnalysisStage | null {
  if (work.briefUnread) return "reading";
  if (!work.snapshotTaken) return "snapshot";
  if (work.triagePending > 0) return "triage";
  if (work.screenPending > 0) return "screening";
  if (work.promotionPending) return "promotion";
  if (work.assessPending > 0) return "assessing";
  if (work.challengePending > 0) return "challenging";
  if (work.rankPending > 0) return "ranking";
  if (work.finalPending) return "final";
  return null;
}

/**
 * The span of the progress bar each stage owns, in percent: the triage
 * and the full reading take most of a run's time (one call per forty
 * cards, one call per profile read), the rest is a few calls or none.
 */
export const STAGE_SPANS: Readonly<Record<AnalysisStage, readonly [number, number]>> = {
  reading: [0, 2],
  snapshot: [2, 4],
  triage: [4, 44],
  screening: [44, 64],
  promotion: [64, 66],
  assessing: [66, 90],
  challenging: [90, 95],
  ranking: [95, 99],
  final: [99, 100],
};

/**
 * The overall progress, 0..100, of a run at `stage` with `done` of
 * `total` of that stage's items settled: the start of the stage's span
 * plus its share of it (nothing of it when the stage has no items),
 * rounded. No stage, when a run is done, is 100.
 */
export function progressOf(stage: AnalysisStage | null, done: number, total: number): number {
  if (stage === null) return 100;
  const [start, end] = STAGE_SPANS[stage];
  const share =
    Number.isFinite(total) && total > 0 && Number.isFinite(done)
      ? Math.min(1, Math.max(0, done / total))
      : 0;
  return Math.max(0, Math.min(100, Math.round(start + (end - start) * share)));
}
