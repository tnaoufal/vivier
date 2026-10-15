/**
 * The analysis as a job of the processor. The web app's runSearch
 * stores a searches row with status queued and pokes POST
 * /analyses/:searchId; the runner claims the queued rows and the
 * running rows whose heartbeat went stale (a lost poke, a crash, a
 * redeploy) at boot and every ANALYSIS_POLL_INTERVAL_MS, ANALYSIS_MAX_RUNS
 * at a time, and runs each one through the steps of steps.ts: the
 * stage is written before a step runs, the progress and the heartbeat
 * after every batch, the stop flag read between batches. A run ends
 * done (status done, finished_at, the progress at its total), stopped
 * (a person asked; what was stored stays and "Reprendre" queues the
 * same row), or failed (any thrown error: a short code on the row, the
 * stage kept, the cause in the log; the row is claimed again only once
 * a person queues it). A SIGTERM lets the batches in flight end, writes
 * their progress and leaves the row running with its heartbeat
 * cleared, so the next boot claims it at once (a crash leaves the
 * heartbeat: the row is claimed once it is ANALYSIS_STALE_MS old).
 * Never a retry by itself, never a model call outside a claimed run.
 */
import { assessFailedError, nextStage, STAGE_ORDER } from "@vivier/analysis";

import { logError, logInfo } from "../log.js";
import type { SearchJobRow } from "../types.js";
import {
  AnalysisFailure,
  prepareRun,
  remainingWork,
  RunControl,
  runStep,
  type RunnerDeps,
} from "./steps.js";

/** A running row whose heartbeat is older than this lost its processor. */
export const ANALYSIS_STALE_MS = 120_000;
/** The heartbeat written while a long call keeps a run from finishing a batch. */
export const HEARTBEAT_MS = 30_000;
/** Steps one run may take before it is called stuck: every stage, each once more on a resume, and room for the stages that read again. */
const MAX_STEPS = STAGE_ORDER.length * 3;

export type RunStatus = "done" | "stopped" | "failed" | "interrupted";

export interface RunOutcome {
  searchId: string;
  status: RunStatus;
  /** The failure's code, on a failed run. */
  code?: string;
  ms: number;
}

/**
 * One claimed run, from its first remaining step to its end state. The
 * steps read what is left from the database each time (remainingWork)
 * and the package's nextStage() names the next one, so a run resumed
 * after a stop or a crash picks up where it was.
 */
export async function runAnalysis(
  search: SearchJobRow,
  deps: RunnerDeps,
  options: { shuttingDown?: () => boolean } = {},
): Promise<RunOutcome> {
  const startedAt = Date.now();
  const shuttingDown = options.shuttingDown ?? (() => false);
  const control = new RunControl(deps, search.id, shuttingDown, search.stop_requested);
  const timer = setInterval(() => {
    void control.heartbeat().catch((error: unknown) => {
      logError("analysis_heartbeat_failed", error, { searchId: search.id });
    });
  }, HEARTBEAT_MS);
  timer.unref();
  const now = () => deps.now().toISOString();
  let stage: string | null = search.stage;
  try {
    if (!deps.complete) throw new AnalysisFailure("model_unavailable");
    const ctx = await prepareRun(search, deps, control);
    for (let step = 0; ; step += 1) {
      if (step >= MAX_STEPS) {
        throw new AnalysisFailure("processor_error", {
          cause: new Error(`the run took more than ${MAX_STEPS} steps`),
        });
      }
      const work = await remainingWork(ctx);
      if (control.stopRequested) break;
      if (shuttingDown()) break;
      const next = nextStage(work);
      if (!next) {
        await control.idle();
        const total = Math.max(1, control.last.total);
        await deps.db.patchSearch(search.id, {
          status: "done",
          stage: null,
          progress_done: total,
          progress_total: total,
          finished_at: now(),
          heartbeat_at: now(),
          error: assessFailedError(ctx.readFailures),
        });
        const ms = Date.now() - startedAt;
        logInfo("analysis_done", {
          searchId: search.id,
          orgId: search.org_id,
          ms,
          readFailures: ctx.readFailures,
        });
        return { searchId: search.id, status: "done", ms };
      }
      stage = next;
      const outcome = await runStep(ctx, next);
      if (outcome.stopped && control.interrupted()) break;
    }
    // No batch runs any more: the heartbeat timer stops before the last writes, so no beat lands after them.
    clearInterval(timer);
    await control.idle();
    if (control.stopRequested) {
      await deps.db.patchSearch(search.id, {
        status: "stopped",
        stop_requested: false,
        finished_at: now(),
        heartbeat_at: now(),
      });
      const ms = Date.now() - startedAt;
      logInfo("analysis_stopped", { searchId: search.id, orgId: search.org_id, stage, ms });
      return { searchId: search.id, status: "stopped", ms };
    }
    // The process shuts down: the progress is written, the row stays running
    // for the next boot, its heartbeat cleared so that boot claims it at once
    // instead of after ANALYSIS_STALE_MS. A release that fails leaves the
    // heartbeat: the row is then claimed as stale, later.
    await deps.db.patchSearch(search.id, { heartbeat_at: null }).catch((error: unknown) => {
      logError("analysis_release_failed", error, { searchId: search.id });
    });
    const ms = Date.now() - startedAt;
    logInfo("analysis_interrupted", { searchId: search.id, orgId: search.org_id, stage, ms });
    return { searchId: search.id, status: "interrupted", ms };
  } catch (error) {
    const failure =
      error instanceof AnalysisFailure
        ? error
        : new AnalysisFailure("processor_error", { cause: error });
    logError("analysis_failed", error, {
      searchId: search.id,
      orgId: search.org_id,
      stage,
      code: failure.code,
    });
    await control.idle().catch(() => undefined);
    try {
      await deps.db.patchSearch(search.id, {
        status: "failed",
        error: failure.code,
        finished_at: now(),
        heartbeat_at: now(),
      });
    } catch (patchError) {
      logError("analysis_fail_unwritten", patchError, { searchId: search.id });
    }
    return {
      searchId: search.id,
      status: "failed",
      code: failure.code,
      ms: Date.now() - startedAt,
    };
  } finally {
    clearInterval(timer);
  }
}

export interface RunnerOptions {
  /** How often the queued and the stale rows are claimed; 0 for pokes and the boot alone. */
  intervalMs: number;
  /** Runs this process holds at once. */
  maxRuns: number;
  /** The name written on the rows this process holds (hostname and pid). */
  name: string;
}

/**
 * The claimer: at boot, every intervalMs and on each poke it takes up
 * to maxRuns minus the runs in flight (claimAnalyses: one conditional
 * write per row, so two processors never hold the same run) and starts
 * each one. Two claim passes never overlap: a claim asked while one
 * runs joins it, and one more pass follows, since the row it was about
 * may have landed after the running pass read the table (the web app
 * inserts the row, then pokes). A row this process already runs is
 * never started twice, even when its own heartbeat went stale behind a
 * long call.
 */
export class AnalysisRunner {
  private readonly active = new Map<string, Promise<RunOutcome>>();
  private timer: NodeJS.Timeout | null = null;
  private claiming: Promise<number> | null = null;
  /** True when a claim was asked while a pass ran: that pass ends with another. */
  private claimAgain = false;
  private stopping = false;

  constructor(
    private readonly deps: RunnerDeps,
    private readonly options: RunnerOptions,
  ) {}

  /** Runs in flight. */
  get running(): number {
    return this.active.size;
  }

  /** The boot's claim, then the timer's. */
  start(): void {
    this.stopping = false;
    void this.claim();
    if (this.timer || this.options.intervalMs <= 0) return;
    this.timer = setInterval(() => {
      void this.claim();
    }, this.options.intervalMs);
  }

  /** No new claim, no new batch: the runs in flight end their batches and leave their rows running. */
  stop(): void {
    this.stopping = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** A poke (POST /analyses/:searchId): a claim pass now, not awaited by the route. */
  poke(searchId: string): void {
    logInfo("analysis_requested", { searchId });
    void this.claim();
  }

  /** One claim pass; answers how many runs it started (the running pass's count when one runs, 0 when there is no room). */
  claim(): Promise<number> {
    if (this.stopping) return Promise.resolve(0);
    if (this.claiming) {
      this.claimAgain = true;
      return this.claiming;
    }
    this.claiming = this.claimOnce()
      .catch((error: unknown): number => {
        logError("analysis_claim_failed", error);
        return 0;
      })
      .finally(() => {
        this.claiming = null;
        if (this.claimAgain && !this.stopping) {
          this.claimAgain = false;
          void this.claim();
        }
      });
    return this.claiming;
  }

  private async claimOnce(): Promise<number> {
    const room = this.options.maxRuns - this.active.size;
    if (room <= 0) return 0;
    const staleBefore = new Date(this.deps.now().getTime() - ANALYSIS_STALE_MS);
    const rows = await this.deps.db.claimAnalyses(this.options.name, staleBefore, room);
    let started = 0;
    for (const row of rows) {
      if (this.active.has(row.id)) continue;
      logInfo("analysis_claimed", {
        searchId: row.id,
        orgId: row.org_id,
        stage: row.stage,
        resumed: row.started_at !== null && row.stage !== null,
      });
      const run = runAnalysis(row, this.deps, { shuttingDown: () => this.stopping }).catch(
        (error: unknown): RunOutcome => {
          logError("analysis_crashed", error, { searchId: row.id });
          return { searchId: row.id, status: "failed", code: "processor_error", ms: 0 };
        },
      );
      this.active.set(row.id, run);
      void run.finally(() => {
        this.active.delete(row.id);
      });
      started += 1;
    }
    return started;
  }

  /** Waits for the runs in flight, up to `timeoutMs`; true when all ended. */
  async drain(timeoutMs: number): Promise<boolean> {
    if (this.active.size === 0) return true;
    const timeout = new Promise<boolean>((resolve) => {
      setTimeout(() => resolve(false), timeoutMs).unref();
    });
    const finished = Promise.all([...this.active.values()]).then(() => true);
    return Promise.race([finished, timeout]);
  }
}
