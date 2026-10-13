/**
 * The poller: every POLL_INTERVAL_MS it puts stale documents back in the
 * queue, then takes queued documents in batches of PROCESSOR_CONCURRENCY
 * and processes them through one semaphore until the queue is empty or
 * the pass is stopped. Two passes never overlap. `schedule()` is the same
 * semaphore for `POST /process`; `drain()` lets a shutdown wait for the
 * documents in flight.
 */
import { logError, logInfo } from "./log.js";
import { recordPoll } from "./metrics.js";
import { processDocument, type PipelineDeps, type ProcessOutcome } from "./pipeline.js";

/** Rounds of listing per pass: a flood of uploads is drained in several passes, not one endless one. */
const MAX_ROUNDS_PER_PASS = 50;

class Semaphore {
  private readonly limit: number;
  private active = 0;
  private readonly queue: Array<() => void> = [];

  constructor(limit: number) {
    this.limit = Math.max(1, Math.floor(limit));
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    this.active++;
    try {
      return await task();
    } finally {
      this.active--;
      const next = this.queue.shift();
      if (next) next();
    }
  }
}

export interface PollerOptions {
  intervalMs: number;
  concurrency: number;
}

export interface PollReport {
  /** Documents this pass handed to the pipeline. */
  processed: number;
  /** Queued documents left after the pass. */
  queued: number;
}

export class Poller {
  private readonly semaphore: Semaphore;
  private readonly tracked = new Set<Promise<ProcessOutcome>>();
  private timer: NodeJS.Timeout | null = null;
  private passRunning = false;
  private stopped = false;

  constructor(
    private readonly deps: PipelineDeps,
    private readonly options: PollerOptions,
  ) {
    this.semaphore = new Semaphore(options.concurrency);
  }

  /** Documents scheduled and not finished (waiting on the semaphore or running). */
  get inFlight(): number {
    return this.tracked.size;
  }

  start(): void {
    if (this.timer || this.options.intervalMs <= 0) return;
    this.stopped = false;
    this.timer = setInterval(() => {
      void this.poll();
    }, this.options.intervalMs);
    void this.poll();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Queues documents by id behind the semaphore; answers how many were queued. Not awaited. */
  schedule(ids: string[]): number {
    let accepted = 0;
    for (const id of ids) {
      this.track(id);
      accepted += 1;
    }
    return accepted;
  }

  private track(id: string): Promise<ProcessOutcome> {
    const promise: Promise<ProcessOutcome> = this.semaphore
      .run(() => processDocument(id, this.deps))
      .catch((error: unknown): ProcessOutcome => {
        logError("process_crashed", error, { documentId: id });
        return "failed";
      });
    this.tracked.add(promise);
    void promise.finally(() => {
      this.tracked.delete(promise);
    });
    return promise;
  }

  /** One pass; null when a pass is already running or the poller is stopped. */
  async poll(): Promise<PollReport | null> {
    if (this.passRunning || this.stopped) return null;
    this.passRunning = true;
    try {
      try {
        const reset = await this.deps.db.resetStale(this.deps.now());
        if (reset.requeued > 0 || reset.failed > 0) logInfo("stale_reset", { ...reset });
      } catch (error) {
        logError("stale_reset_failed", error);
      }
      let processed = 0;
      for (let round = 0; round < MAX_ROUNDS_PER_PASS && !this.stopped; round++) {
        const ids = await this.deps.db.listQueued(this.options.concurrency);
        if (ids.length === 0) break;
        await Promise.all(ids.map((id) => this.track(id)));
        processed += ids.length;
        if (ids.length < this.options.concurrency) break;
      }
      const queued = await this.deps.db.countQueued();
      recordPoll(queued);
      return { processed, queued };
    } catch (error) {
      logError("poll_failed", error);
      return null;
    } finally {
      this.passRunning = false;
    }
  }

  /** Waits for the documents in flight, up to `timeoutMs`; true when all finished. */
  async drain(timeoutMs: number): Promise<boolean> {
    if (this.tracked.size === 0) return true;
    // unref: the timer must not keep the process alive once the work is done.
    const timeout = new Promise<boolean>((resolve) => {
      setTimeout(() => resolve(false), timeoutMs).unref();
    });
    const finished = Promise.all([...this.tracked]).then(() => true);
    return Promise.race([finished, timeout]);
  }
}
