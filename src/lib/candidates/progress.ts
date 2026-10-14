/**
 * The progress of the wave the service is reading. A wave is what the
 * organisation still has to read (queued or processing) plus what left
 * that queue since the earliest of them entered it. A document enters
 * the queue when it is uploaded or sent back (its updated_at moves on
 * every status change, so a re-queued batch is a wave of its own
 * whatever its files' age), and leaves it read, set aside, unreadable
 * or failed; a duplicate the service settles without a model call left
 * it too. A CV refused at the monthly cap is neither: it never entered
 * the reading, and the banner counts it apart. The throughput is what
 * left the queue over the last few minutes, the estimate what the
 * pending share would take at that rate. Once nothing is pending, the
 * wave a caller followed is counted from its start so the banner can
 * say how many it read. Pure and tested in progress.test.ts; the counts
 * come from readProcessingProgress() in queries.ts, which calls waveOf().
 */
import type { Locale } from "@/lib/db/types";

/** Minutes over which the throughput is counted: long enough to smooth one slow CV, short enough to follow a change. */
export const THROUGHPUT_WINDOW_MINUTES = 5;

/** The wave as the database counts it. */
export interface ProcessingWave {
  /** queued or processing */
  pending: number;
  /** pending plus done; for an ended wave, what it read. */
  total: number;
  /** Documents that left the queue since the wave began (the quota refusals apart). */
  done: number;
  /** ISO instant the earliest pending document entered the queue, or the start an ended wave was counted from; null without a wave. */
  startedAt: string | null;
  /** Documents that left the queue per minute over the window; null when none did (nothing to measure yet). */
  throughputPerMinute: number | null;
  /** pending divided by the throughput, in minutes; null without a throughput. */
  etaMinutes: number | null;
}

export interface WaveCounts {
  pending: number;
  /** Documents that left the queue at or after `startedAt`. */
  done: number;
  /** Documents that left the queue over the last `windowMinutes`. */
  leftInWindow: number;
  startedAt: string | null;
  windowMinutes?: number;
}

function whole(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

/**
 * The wave from the counts: pending plus what left the queue since its
 * start. With nothing pending, the ended wave the caller followed (its
 * done is its total, its start kept so the caller knows it was counted,
 * even to zero), or the empty wave without a start.
 */
export function waveOf(counts: WaveCounts): ProcessingWave {
  const pending = whole(counts.pending);
  const done = whole(counts.done);
  if (pending === 0) {
    return {
      pending: 0,
      total: done,
      done,
      startedAt: counts.startedAt,
      throughputPerMinute: null,
      etaMinutes: null,
    };
  }
  const window = counts.windowMinutes ?? THROUGHPUT_WINDOW_MINUTES;
  const left = whole(counts.leftInWindow);
  const throughputPerMinute = left > 0 && window > 0 ? left / window : null;
  return {
    pending,
    total: pending + done,
    done,
    startedAt: counts.startedAt,
    throughputPerMinute,
    etaMinutes: throughputPerMinute === null ? null : pending / throughputPerMinute,
  };
}

/**
 * The earlier of two ISO instants, so a page keeps the start of the wave
 * it follows while the queue's earliest document moves on; one that does
 * not parse is ignored.
 */
export function earliestOf(a: string | null, b: string | null): string | null {
  const timeA = a === null ? Number.NaN : Date.parse(a);
  const timeB = b === null ? Number.NaN : Date.parse(b);
  if (Number.isNaN(timeA)) return Number.isNaN(timeB) ? null : b;
  if (Number.isNaN(timeB)) return a;
  // The same instant written two ways (the database's offset, the browser's Z) answers b:
  // the caller passes the value it holds first, so an equal fresh reading wins and the
  // notation settles on the database's after the first read instead of alternating.
  return timeA < timeB ? a : b;
}

/** What the progress block shows, every number already rounded for a sentence. */
export interface ProcessingProgress {
  /** True while something is pending: the bar moves, the figures count. */
  active: boolean;
  done: number;
  total: number;
  pending: number;
  /** 0 to 100, whole; 99 at most while active, so the bar never says finished before the service does. */
  percent: number;
  /** CVs per minute, one decimal at most; null when nothing left the queue over the window. */
  throughput: number | null;
  /** Whole minutes left, at least 1; null without a throughput. */
  etaMinutes: number | null;
}

export function progressOf(wave: ProcessingWave): ProcessingProgress {
  const active = wave.pending > 0;
  const total = wave.total;
  let percent = total > 0 ? Math.round((100 * wave.done) / total) : 0;
  percent = Math.min(100, Math.max(0, percent));
  if (active && percent === 100) percent = 99;
  const throughput =
    wave.throughputPerMinute !== null && wave.throughputPerMinute > 0
      ? Math.max(0.1, Math.round(wave.throughputPerMinute * 10) / 10)
      : null;
  const etaMinutes =
    active && wave.etaMinutes !== null && Number.isFinite(wave.etaMinutes)
      ? Math.max(1, Math.ceil(wave.etaMinutes))
      : null;
  return { active, done: wave.done, total, pending: wave.pending, percent, throughput, etaMinutes };
}

/** "12,4" / "12.4": a throughput with one decimal at most, in the locale's notation. */
export function formatThroughput(locale: Locale, value: number): string {
  return new Intl.NumberFormat(locale === "fr" ? "fr-FR" : "en-GB", {
    maximumFractionDigits: 1,
  }).format(Number.isFinite(value) ? Math.max(0, value) : 0);
}
