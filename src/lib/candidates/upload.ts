/**
 * The pure side of a CV import: which files are accepted and the refusals
 * grouped by reason, the plan (one document id and object key per file),
 * the lots the plan is cut into, the per-file state machine the dialog
 * renders, the batch summary, and the two re-plans a person may ask for
 * (resume what was stopped, retry what failed). The browser work
 * (hashing, storage, the documents row) is in upload-runner.ts; the
 * supabase-js bindings in upload-browser.ts. Tested in upload.test.ts.
 */

/** The bucket's own limit (26 214 400 bytes), repeated here so the browser refuses first. */
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
/** One import: validated once, then sent lot after lot. */
export const MAX_BATCH_FILES = 10_000;
/** Files per lot; the processor is poked after each lot, so profiles appear while the import runs. */
export const LOT_SIZE = 100;
/** Files hashed and uploaded at the same time inside a lot. */
export const UPLOAD_CONCURRENCY = 3;

export type RejectReason = "not_pdf" | "empty" | "too_large" | "too_many";

/** The order the refusal sentence lists its reasons in. */
export const REJECT_REASONS: readonly RejectReason[] = ["not_pdf", "empty", "too_large", "too_many"];

export interface RejectedFile {
  file: File;
  reason: RejectReason;
}

/** A PDF by its type, or by its extension when the browser gave no type. */
export function isPdf(file: Pick<File, "name" | "type">): boolean {
  if (file.type === "application/pdf") return true;
  return file.type === "" && /\.pdf$/i.test(file.name);
}

/** Splits a selection into what may be uploaded and what is refused, with the reason. */
export function validateFiles(files: readonly File[]): {
  accepted: File[];
  rejected: RejectedFile[];
} {
  const accepted: File[] = [];
  const rejected: RejectedFile[] = [];
  for (const file of files) {
    if (!isPdf(file)) rejected.push({ file, reason: "not_pdf" });
    else if (file.size <= 0) rejected.push({ file, reason: "empty" });
    else if (file.size > MAX_FILE_BYTES) rejected.push({ file, reason: "too_large" });
    else if (accepted.length >= MAX_BATCH_FILES) rejected.push({ file, reason: "too_many" });
    else accepted.push(file);
  }
  return { accepted, rejected };
}

export interface RejectedGroup {
  reason: RejectReason;
  count: number;
}

/**
 * The refusals counted by reason, in REJECT_REASONS order and without the
 * empty ones, so the dialog says one sentence ("12 fichiers refusés :
 * 10 ne sont pas des PDF, 2 dépassent 25 Mo") and never 10 000 lines.
 */
export function groupRejected(rejected: readonly RejectedFile[]): RejectedGroup[] {
  const counts = new Map<RejectReason, number>();
  for (const entry of rejected) counts.set(entry.reason, (counts.get(entry.reason) ?? 0) + 1);
  return REJECT_REASONS.flatMap((reason) => {
    const count = counts.get(reason) ?? 0;
    return count > 0 ? [{ reason, count }] : [];
  });
}

/** Cuts a list into lots of `size` in order; the last one may be shorter; nothing for an empty list. */
export function planLots<T>(items: readonly T[], size: number = LOT_SIZE): T[][] {
  const step = Math.max(1, Math.floor(size));
  const lots: T[][] = [];
  for (let at = 0; at < items.length; at += step) lots.push(items.slice(at, at + step));
  return lots;
}

export type UploadStatus = "waiting" | "hashing" | "uploading" | "uploaded" | "duplicate" | "failed" | "skipped";

/** The statuses an item does not leave on its own; "skipped" is an item the person stopped before it started. */
const FINAL_STATUSES: ReadonlySet<UploadStatus> = new Set<UploadStatus>(["uploaded", "duplicate", "failed", "skipped"]);

export function isFinalStatus(status: UploadStatus): boolean {
  return FINAL_STATUSES.has(status);
}

/** Why a file failed; the dialog turns it into a sentence. */
export type UploadErrorCode = "hash" | "upload" | "insert";

export interface UploadItem {
  /** The documents row id, also the stem of the object key. */
  id: string;
  file: File;
  /** The object key in the `cvs` bucket: <orgId>/<id>.pdf */
  path: string;
  status: UploadStatus;
  error: UploadErrorCode | null;
  sha256: string | null;
}

/** One item per accepted file, with a fresh id and its object key. */
export function planBatch(files: readonly File[], orgId: string, makeId: () => string): UploadItem[] {
  return files.map((file) => {
    const id = makeId();
    return { id, file, path: `${orgId}/${id}.pdf`, status: "waiting", error: null, sha256: null };
  });
}

export type UploadAction =
  | { type: "status"; id: string; status: Exclude<UploadStatus, "failed"> }
  | { type: "hashed"; id: string; sha256: string }
  | { type: "failed"; id: string; error: UploadErrorCode };

/** The state after an action; items it does not name are left as they are. */
export function reduceUpload(items: readonly UploadItem[], action: UploadAction): UploadItem[] {
  return items.map((item) => {
    if (item.id !== action.id) return item;
    switch (action.type) {
      case "status":
        return { ...item, status: action.status, error: null };
      case "hashed":
        return { ...item, sha256: action.sha256 };
      case "failed":
        return { ...item, status: "failed", error: action.error };
      default:
        return item;
    }
  });
}

export interface UploadSummary {
  total: number;
  /** Items the service answered for: uploaded, duplicate or failed. Skipped ones are not done. */
  done: number;
  uploaded: number;
  duplicate: number;
  failed: number;
  /** Items the person stopped before they started; "Reprendre" sends them. */
  skipped: number;
  /** True while at least one item is still on its way. */
  active: boolean;
}

export function summarizeUpload(items: readonly UploadItem[]): UploadSummary {
  let uploaded = 0;
  let duplicate = 0;
  let failed = 0;
  let skipped = 0;
  for (const item of items) {
    if (item.status === "uploaded") uploaded += 1;
    else if (item.status === "duplicate") duplicate += 1;
    else if (item.status === "failed") failed += 1;
    else if (item.status === "skipped") skipped += 1;
  }
  const done = uploaded + duplicate + failed;
  return {
    total: items.length,
    done,
    uploaded,
    duplicate,
    failed,
    skipped,
    active: done + skipped < items.length,
  };
}

/** The ids of the documents that were stored, in batch order. */
export function uploadedIds(items: readonly UploadItem[]): string[] {
  return items.filter((item) => item.status === "uploaded").map((item) => item.id);
}

/** Every item not yet final marked skipped: what a run that broke off (the client itself failed) leaves for "Reprendre". */
export function skipUnfinished(items: readonly UploadItem[]): UploadItem[] {
  return items.map((item) => (isFinalStatus(item.status) ? item : { ...item, status: "skipped", error: null }));
}

/** The skipped items put back to waiting, so a stopped import resumes with the same ids (nothing was started). */
export function resumeSkipped(items: readonly UploadItem[]): { items: UploadItem[]; resumed: UploadItem[] } {
  const resumed: UploadItem[] = [];
  const next = items.map((item) => {
    if (item.status !== "skipped") return item;
    const revived: UploadItem = { ...item, status: "waiting", error: null };
    resumed.push(revived);
    return revived;
  });
  return { items: next, resumed };
}

/**
 * The failed items replaced, in place, by fresh ones for the same files.
 * A new id because a member may not delete objects: the one a failed
 * insert left behind would make the same key refuse a second upload.
 */
export function retryFailed(
  items: readonly UploadItem[],
  orgId: string,
  makeId: () => string,
): { items: UploadItem[]; retried: UploadItem[] } {
  const retried: UploadItem[] = [];
  const next = items.map((item) => {
    if (item.status !== "failed") return item;
    const [fresh] = planBatch([item.file], orgId, makeId);
    if (!fresh) return item;
    retried.push(fresh);
    return fresh;
  });
  return { items: next, retried };
}
