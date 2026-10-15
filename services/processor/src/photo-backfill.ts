/**
 * The photo backfill: the candidates read before the portrait existed
 * (every one of the pool on the day this was written) get theirs from the
 * maintenance pass, with no new reading of the CV's text and nothing sent
 * to a model. The pass lists the candidates without a photo that were
 * never checked (`candidates.photo_checked_at`), PHOTO_BACKFILL_BATCH at
 * a time, and for each reads page 1 of their newest CV with a text layer
 * exactly as the pipeline does (pdf.ts, photo.ts): the largest
 * portrait-shaped image, downscaled, encoded as a PNG, written to the
 * private `photos` bucket, its key on the row. Every candidate listed is
 * marked checked, portrait or not, so the pass never reads the same CV
 * twice: a scanned CV (its portrait is among the images the OCR cut out,
 * a billed call the pass never makes), a CV without a portrait, an
 * unreadable file or a failed write are settled with one log line each;
 * only a row the database refused to mark stays for the next pass.
 * PHOTO_BACKFILL_CONCURRENCY CVs are read at once, one PDF in memory per
 * worker, and a maintenance run loops over up to PHOTO_BACKFILL_PASSES
 * batches while rows remain, so a backlog of a thousand profiles is done
 * in a few hourly runs rather than a day.
 */
import { PHOTO_BUCKET, type Db } from "./db.js";
import { logError, logInfo, type LogFields } from "./log.js";
import type { PageImages } from "./pdf.js";
import { choosePhoto, photoFileOf, photoPathOf, type PhotoFile } from "./photo.js";
import type { PhotoCandidateRow, PhotoDocumentRow } from "./types.js";

/** Candidates listed per batch. */
export const PHOTO_BACKFILL_BATCH = 50;
/** Batches per maintenance run while rows remain: a bound on the run's length, not a target. */
export const PHOTO_BACKFILL_PASSES = 10;
/** CVs read at once; each worker holds one PDF in memory. */
export const PHOTO_BACKFILL_CONCURRENCY = 2;

/** What the pass reads and writes: the listing, the two marks, the CV's bytes and the photo's. */
export type PhotoDb = Pick<
  Db,
  "listCandidatesForPhoto" | "markPhotoChecked" | "setPhotoPath" | "downloadObject" | "uploadObject"
>;

/**
 * The images of page 1 of a PDF with a text layer (pdf.ts); a thrown
 * error means no photo. `context` names the candidate and the document
 * in the log, nothing else.
 */
export type PageImagesReader = (buffer: Buffer, context: LogFields) => Promise<PageImages>;

export interface PhotoBackfillDeps {
  db: PhotoDb;
  pageImages: PageImagesReader;
  /** Batches this run may list; PHOTO_BACKFILL_PASSES unless said. */
  passes?: number;
}

export interface PhotoBackfillReport {
  /** Candidates settled: checked once, with a photo or without. */
  photosChecked: number;
  /** Photos written. */
  photosFound: number;
  /** Candidates a step failed for (logged); settled all the same, unless the write itself failed. */
  photosFailed: number;
}

/**
 * One candidate's outcome: a photo written; none found (a scan, no
 * portrait, nothing readable), checked; a failure, logged and checked;
 * or a row the database refused to mark, left for the next pass.
 */
export type PhotoOutcome = "found" | "none" | "failed" | "unsettled";

/** Why a candidate's CVs give no portrait without a read: a scan (the OCR read it), or no document read from a text layer. */
export type UnreadReason = "scanned" | "unread";

/**
 * The CV the pass reads: the newest processed document read from its
 * text layer (or whose method is unknown: pdf.js will say). One the OCR
 * read is a scan: its portrait is among the images the OCR cut out, a
 * call the pass never makes. One read by nobody (`none`: a copy of a
 * file read under another row) is left too.
 */
export function primaryDocumentOf(row: PhotoCandidateRow): PhotoDocumentRow | null {
  const newestFirst = [...row.documents].sort((a, b) =>
    (b.processed_at ?? "").localeCompare(a.processed_at ?? ""),
  );
  return (
    newestFirst.find(
      (document) =>
        document.status === "processed" &&
        (document.extraction_method === "pdf-text" || document.extraction_method === null),
    ) ?? null
  );
}

export function unreadReasonOf(row: PhotoCandidateRow): UnreadReason {
  return row.documents.some((document) => document.extraction_method === "ocr")
    ? "scanned"
    : "unread";
}

/** Marks the candidate checked; "unsettled" when the database refused (the row is listed again next pass). */
async function settle(
  deps: PhotoBackfillDeps,
  row: PhotoCandidateRow,
  outcome: "none" | "failed",
): Promise<PhotoOutcome> {
  try {
    await deps.db.markPhotoChecked(row.id);
  } catch (error) {
    logError("photo_backfill_mark_failed", error, { candidateId: row.id, orgId: row.org_id });
    return "unsettled";
  }
  return outcome;
}

/**
 * One candidate: their newest readable CV is downloaded, its first page's
 * images read, the portrait (when there is one) written to the bucket
 * and named on the row. Whatever happens, the candidate is marked
 * checked, so a CV is never read twice by this pass; the only exception
 * is a mark the database refused, which the next pass retries.
 */
export async function backfillOne(
  deps: PhotoBackfillDeps,
  row: PhotoCandidateRow,
): Promise<PhotoOutcome> {
  const context: LogFields = { candidateId: row.id, orgId: row.org_id };
  const document = primaryDocumentOf(row);
  if (!document) {
    logInfo("photo_backfill_none", { ...context, reason: unreadReasonOf(row) });
    return settle(deps, row, "none");
  }
  const documentContext: LogFields = { ...context, documentId: document.id };
  let file: PhotoFile | null;
  try {
    // The PDF lives in this block only: one in memory per worker.
    const buffer = await deps.db.downloadObject(document.storage_path);
    const page = await deps.pageImages(buffer, documentContext);
    const image = choosePhoto(page.images, page.pageWidth);
    file = image ? photoFileOf(image) : null;
  } catch (error) {
    logError("photo_backfill_read_failed", error, documentContext);
    return settle(deps, row, "failed");
  }
  if (!file) {
    logInfo("photo_backfill_none", { ...documentContext, reason: "no portrait" });
    return settle(deps, row, "none");
  }
  const path = photoPathOf(row.org_id, row.id, file.contentType);
  try {
    await deps.db.uploadObject(PHOTO_BUCKET, path, file.bytes, file.contentType);
  } catch (error) {
    logError("photo_backfill_write_failed", error, { ...documentContext, path });
    return settle(deps, row, "failed");
  }
  try {
    await deps.db.setPhotoPath(row.id, path);
  } catch (error) {
    // The file is in the bucket and no row names it yet: the next pass
    // reads the CV again and writes the key (the upload is an upsert),
    // and should the person leave first, the purge takes both keys a
    // photo of theirs can have.
    logError("photo_backfill_mark_failed", error, { ...documentContext, path });
    return "unsettled";
  }
  logInfo("photo_backfill_found", {
    ...documentContext,
    path,
    contentType: file.contentType,
    bytes: file.bytes.byteLength,
  });
  return "found";
}

/** One batch, PHOTO_BACKFILL_CONCURRENCY candidates at a time; answers how many rows were settled. */
async function runBatch(
  deps: PhotoBackfillDeps,
  rows: readonly PhotoCandidateRow[],
  report: PhotoBackfillReport,
): Promise<number> {
  const queue = [...rows];
  let settled = 0;
  const worker = async (): Promise<void> => {
    for (let row = queue.shift(); row !== undefined; row = queue.shift()) {
      const outcome = await backfillOne(deps, row);
      switch (outcome) {
        case "found":
          settled += 1;
          report.photosChecked += 1;
          report.photosFound += 1;
          break;
        case "none":
          settled += 1;
          report.photosChecked += 1;
          break;
        case "failed":
          settled += 1;
          report.photosChecked += 1;
          report.photosFailed += 1;
          break;
        case "unsettled":
          report.photosFailed += 1;
          break;
      }
    }
  };
  const workers = Math.min(PHOTO_BACKFILL_CONCURRENCY, queue.length);
  await Promise.all(Array.from({ length: workers }, worker));
  return settled;
}

/**
 * The pass: batches of PHOTO_BACKFILL_BATCH candidates, up to `passes`
 * of them, while a full batch comes back and settles at least one row (a
 * batch that settled nothing would be listed again as it is). The report
 * sums the run; one log line gives it with the batches read and whether
 * rows remain for the next run.
 */
export async function photoBackfillPass(deps: PhotoBackfillDeps): Promise<PhotoBackfillReport> {
  const started = Date.now();
  const passes = Math.max(0, Math.floor(deps.passes ?? PHOTO_BACKFILL_PASSES));
  const report: PhotoBackfillReport = { photosChecked: 0, photosFound: 0, photosFailed: 0 };
  let batches = 0;
  let more = false;
  while (batches < passes) {
    let rows: PhotoCandidateRow[];
    try {
      rows = await deps.db.listCandidatesForPhoto(PHOTO_BACKFILL_BATCH);
    } catch (error) {
      logError("photo_backfill_lookup_failed", error, { batch: batches });
      break;
    }
    if (rows.length === 0) {
      more = false;
      break;
    }
    batches += 1;
    const settled = await runBatch(deps, rows, report);
    more = rows.length >= PHOTO_BACKFILL_BATCH;
    if (settled === 0 || !more) break;
  }
  if (batches > 0) {
    logInfo("photo_backfill", { batches, more, ...report, ms: Date.now() - started });
  }
  return report;
}
