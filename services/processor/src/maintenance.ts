/**
 * The maintenance pass (hourly by timer, or `POST /maintenance`): the
 * stale reset, the retention purge and the re-embed pass.
 *
 * Purge: `expired_candidates()` names the candidates past their
 * organisation's retention or with a withdrawn consent; for each, the
 * files of its documents are removed from the `cvs` bucket first, then
 * the candidate row (the cascade takes the document rows). A candidate
 * whose files could not be removed is left for the next pass: a row must
 * never outlive its files, nor the files the row.
 *
 * Re-embed: with a model, the active candidates still without a vector
 * (an embedding call that failed when the document was processed, a
 * model that answered the wrong width until it was fixed) get one, a
 * batch per pass, most recently updated first. A candidate with nothing
 * to embed (a heuristic profile: a name and contact details, no headline,
 * summary, skills or positions) is skipped and keeps its place in the
 * listing, so the pass pages past the skipped rows, up to
 * REEMBED_MAX_PAGES, until it has made its batch of calls: a hundred such
 * candidates at the top must not hide the ones below them for ever. The
 * first wrong-width answer stops the pass: every other call would fail
 * the same way, and one log line with the fix sentence says more than a
 * hundred.
 */
import type { Db, ExpiredCandidate } from "./db.js";
import {
  embeddingFixSentence,
  isDimensionMismatch,
  noteEmbeddingFailure,
  noteEmbeddingSuccess,
} from "./embedding.js";
import { logError, logInfo } from "./log.js";
import { countModelCall, countPurged } from "./metrics.js";
import { vectorLiteral, type Embedder, type Embedding } from "./model.js";
import { embeddingTextOf, profileOfRow } from "./structure.js";
import type { CandidateRow } from "./types.js";
import type { UsageRecorder } from "./usage.js";

/** Candidates purged per pass; the rest wait for the next one. */
export const PURGE_BATCH = 100;
/** Embedding calls per pass, and the size of each page listed; the rest wait for the next pass. */
export const REEMBED_BATCH = 100;
/** Pages of the listing read per pass when the rows have nothing to embed: a bound, not a target. */
export const REEMBED_MAX_PAGES = 10;

export interface MaintenanceReport {
  ranAt: string;
  purged: number;
  filesRemoved: number;
  failed: number;
  staleRequeued: number;
  staleFailed: number;
  reembedded: number;
  reembedFailed: number;
  /** Candidates listed with nothing to embed; they stay without a vector and are found by text. */
  reembedSkipped: number;
  ms: number;
}

export interface MaintenanceDeps {
  db: Db;
  now: () => Date;
  /** Null without a model: the re-embed pass is skipped. */
  embed: Embedder | null;
  /** Writes the `ai_usage` row of each embedding; never throws. */
  recordUsage: UsageRecorder;
  /** The embedding model's name, for the fix sentence. */
  embeddingModel?: string;
}

interface ReembedReport {
  reembedded: number;
  reembedFailed: number;
  reembedSkipped: number;
}

/** One candidate: embedded, failed (kept for the next pass), skipped (nothing to embed), or the pass must stop. */
type ReembedOutcome = "embedded" | "failed" | "skipped" | "mismatch";

async function reembedOne(deps: MaintenanceDeps, embed: Embedder, row: CandidateRow): Promise<ReembedOutcome> {
  // A profile with nothing to embed (no headline, summary, skills or
  // positions) stays without a vector: it is found by its text.
  const text = embeddingTextOf(profileOfRow(row));
  if (!text) return "skipped";
  let answer: Embedding;
  try {
    answer = await embed(text);
    countModelCall("embed", true);
    noteEmbeddingSuccess();
  } catch (error) {
    countModelCall("embed", false);
    noteEmbeddingFailure(error);
    if (isDimensionMismatch(error)) {
      logError("embedding_mismatch", error, {
        candidateId: row.id,
        orgId: row.org_id,
        fix: embeddingFixSentence(deps.embeddingModel ?? null, error.dimensions),
      });
      return "mismatch";
    }
    logError("reembed_failed", error, { candidateId: row.id, orgId: row.org_id });
    return "failed";
  }
  try {
    await deps.db.updateCandidate(row.id, { embedding: vectorLiteral(answer.vector) });
    await deps.recordUsage(row.org_id, "embed", answer.usage);
    return "embedded";
  } catch (error) {
    // The vector is computed again next pass: one call lost, no candidate.
    logError("reembed_write_failed", error, { candidateId: row.id, orgId: row.org_id });
    return "failed";
  }
}

async function reembedPass(deps: MaintenanceDeps, embed: Embedder): Promise<ReembedReport> {
  const { db } = deps;
  const report: ReembedReport = { reembedded: 0, reembedFailed: 0, reembedSkipped: 0 };
  let calls = 0;
  // The listing is read by offset. A row that got its vector leaves the
  // listing; a skipped or failed row keeps its place, so the next page
  // starts after the rows of this one that are still without a vector.
  let offset = 0;
  let pages = 0;
  while (pages < REEMBED_MAX_PAGES && calls < REEMBED_BATCH) {
    let rows: CandidateRow[] = [];
    try {
      rows = await db.listCandidatesWithoutEmbedding(REEMBED_BATCH, offset);
    } catch (error) {
      logError("reembed_lookup_failed", error, { page: pages, offset });
      break;
    }
    pages += 1;
    let stayed = 0;
    for (const row of rows) {
      if (calls >= REEMBED_BATCH) break;
      const outcome = await reembedOne(deps, embed, row);
      switch (outcome) {
        case "embedded":
          calls += 1;
          report.reembedded += 1;
          break;
        case "failed":
          calls += 1;
          stayed += 1;
          report.reembedFailed += 1;
          break;
        case "skipped":
          stayed += 1;
          report.reembedSkipped += 1;
          break;
        case "mismatch":
          report.reembedFailed += 1;
          return report;
      }
    }
    if (rows.length < REEMBED_BATCH) break;
    offset += stayed;
  }
  if (report.reembedSkipped > 0 && report.reembedded === 0 && report.reembedFailed === 0) {
    // Visible on purpose: a pass that only skips looks healthy in the counts.
    logInfo("reembed_skipped", { skipped: report.reembedSkipped, pages });
  }
  return report;
}

export async function runMaintenance(deps: MaintenanceDeps): Promise<MaintenanceReport> {
  const started = Date.now();
  const ranAt = deps.now().toISOString();
  const { db } = deps;

  let staleRequeued = 0;
  let staleFailed = 0;
  try {
    const reset = await db.resetStale(deps.now());
    staleRequeued = reset.requeued;
    staleFailed = reset.failed;
  } catch (error) {
    logError("stale_reset_failed", error);
  }

  let expired: ExpiredCandidate[] = [];
  try {
    expired = await db.expiredCandidates(PURGE_BATCH);
  } catch (error) {
    logError("expired_lookup_failed", error);
  }

  let purged = 0;
  let filesRemoved = 0;
  let failed = 0;
  for (const item of expired) {
    try {
      const documents = await db.listDocumentsOfCandidate(item.candidate_id);
      const paths = documents.map((document) => document.storage_path);
      if (paths.length > 0) await db.removeObjects(paths);
      await db.deleteCandidate(item.candidate_id);
      purged += 1;
      filesRemoved += paths.length;
      logInfo("purged", {
        candidateId: item.candidate_id,
        orgId: item.org_id,
        reason: item.reason,
        files: paths.length,
      });
    } catch (error) {
      failed += 1;
      logError("purge_failed", error, { candidateId: item.candidate_id, orgId: item.org_id });
    }
  }
  countPurged(purged);

  const reembed: ReembedReport = deps.embed
    ? await reembedPass(deps, deps.embed)
    : { reembedded: 0, reembedFailed: 0, reembedSkipped: 0 };

  const report: MaintenanceReport = {
    ranAt,
    purged,
    filesRemoved,
    failed,
    staleRequeued,
    staleFailed,
    reembedded: reembed.reembedded,
    reembedFailed: reembed.reembedFailed,
    reembedSkipped: reembed.reembedSkipped,
    ms: Date.now() - started,
  };
  logInfo("maintenance", { ...report });
  return report;
}
