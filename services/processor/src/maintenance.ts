/**
 * The maintenance pass (hourly by timer, or `POST /maintenance`): the
 * retention purge and the stale reset. `expired_candidates()` names the
 * candidates past their organisation's retention or with a withdrawn
 * consent; for each, the files of its documents are removed from the
 * `cvs` bucket first, then the candidate row (the cascade takes the
 * document rows). A candidate whose files could not be removed is left
 * for the next pass: a row must never outlive its files, nor the files
 * the row.
 */
import type { Db, ExpiredCandidate } from "./db.js";
import { logError, logInfo } from "./log.js";
import { countPurged } from "./metrics.js";

/** Candidates purged per pass; the rest wait for the next one. */
export const PURGE_BATCH = 100;

export interface MaintenanceReport {
  ranAt: string;
  purged: number;
  filesRemoved: number;
  failed: number;
  staleRequeued: number;
  staleFailed: number;
  ms: number;
}

export async function runMaintenance(deps: { db: Db; now: () => Date }): Promise<MaintenanceReport> {
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

  const report: MaintenanceReport = {
    ranAt,
    purged,
    filesRemoved,
    failed,
    staleRequeued,
    staleFailed,
    ms: Date.now() - started,
  };
  logInfo("maintenance", { ...report });
  return report;
}
