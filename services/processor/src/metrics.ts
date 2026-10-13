/**
 * Usage counters since the process started: documents by outcome, pages
 * read, model and OCR calls, candidates purged, and what the last poll
 * saw. Kept in memory on purpose (one process on Railway, reset on every
 * deploy) and served by GET /metrics behind the shared secret, so the web
 * app's status page can show numbers without a metrics store. Nothing
 * here identifies a person or an organisation.
 */

export interface DocumentCounters {
  processed: number;
  failed: number;
  needsOcr: number;
  duplicates: number;
  quotaRefused: number;
  /** Classified by the model as something else than a CV, set aside. */
  rejected: number;
  /** Claimed by someone else or no longer queued when the work started. */
  skipped: number;
}

export type DocumentOutcome = keyof DocumentCounters;

export interface CallCounters {
  succeeded: number;
  failed: number;
}

export interface ProcessorMetrics {
  startedAt: string;
  uptimeSeconds: number;
  documents: DocumentCounters;
  /** PDF pages read (text layer or OCR). */
  pages: number;
  modelCalls: { structure: CallCounters; embed: CallCounters };
  ocrCalls: CallCounters;
  purgedCandidates: number;
  lastPollAt: string | null;
  /** Queued documents seen by the last poll, after that pass. */
  queueDepth: number;
}

const startedAt = new Date();
const documents: DocumentCounters = {
  processed: 0,
  failed: 0,
  needsOcr: 0,
  duplicates: 0,
  quotaRefused: 0,
  rejected: 0,
  skipped: 0,
};
let pages = 0;
const modelCalls = {
  structure: { succeeded: 0, failed: 0 },
  embed: { succeeded: 0, failed: 0 },
};
const ocrCalls: CallCounters = { succeeded: 0, failed: 0 };
let purgedCandidates = 0;
let lastPollAt: Date | null = null;
let queueDepth = 0;

export function countDocument(outcome: DocumentOutcome): void {
  documents[outcome] += 1;
}

export function countPages(count: number): void {
  if (Number.isFinite(count) && count > 0) pages += Math.floor(count);
}

export function countModelCall(kind: "structure" | "embed", ok: boolean): void {
  modelCalls[kind][ok ? "succeeded" : "failed"] += 1;
}

export function countOcrCall(ok: boolean): void {
  ocrCalls[ok ? "succeeded" : "failed"] += 1;
}

export function countPurged(count: number): void {
  if (Number.isFinite(count) && count > 0) purgedCandidates += Math.floor(count);
}

export function recordPoll(depth: number, at: Date = new Date()): void {
  lastPollAt = at;
  queueDepth = Number.isFinite(depth) && depth >= 0 ? Math.floor(depth) : 0;
}

export function readMetrics(now: Date = new Date()): ProcessorMetrics {
  return {
    startedAt: startedAt.toISOString(),
    uptimeSeconds: Math.max(0, Math.round((now.getTime() - startedAt.getTime()) / 1000)),
    documents: { ...documents },
    pages,
    modelCalls: {
      structure: { ...modelCalls.structure },
      embed: { ...modelCalls.embed },
    },
    ocrCalls: { ...ocrCalls },
    purgedCandidates,
    lastPollAt: lastPollAt ? lastPollAt.toISOString() : null,
    queueDepth,
  };
}

/** Test hook. */
export function resetMetrics(): void {
  for (const key of Object.keys(documents) as DocumentOutcome[]) documents[key] = 0;
  pages = 0;
  modelCalls.structure = { succeeded: 0, failed: 0 };
  modelCalls.embed = { succeeded: 0, failed: 0 };
  ocrCalls.succeeded = 0;
  ocrCalls.failed = 0;
  purgedCandidates = 0;
  lastPollAt = null;
  queueDepth = 0;
}
