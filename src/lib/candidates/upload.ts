/**
 * The pure side of a CV batch upload: which files are accepted, the plan
 * (one document id and object key per file), the per-file state machine
 * the dialog renders, and the batch summary. The browser work (hashing,
 * storage, the documents row) is in upload-runner.ts; the supabase-js
 * bindings in upload-browser.ts. Tested in upload.test.ts.
 */

/** The bucket's own limit (26 214 400 bytes), repeated here so the browser refuses first. */
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_BATCH_FILES = 200;
/** Files hashed and uploaded at the same time. */
export const UPLOAD_CONCURRENCY = 3;

export type RejectReason = "not_pdf" | "empty" | "too_large" | "too_many";

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

export type UploadStatus = "waiting" | "hashing" | "uploading" | "uploaded" | "duplicate" | "failed";

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
  /** Items that reached a final state. */
  done: number;
  uploaded: number;
  duplicate: number;
  failed: number;
  /** True while at least one item is still on its way. */
  active: boolean;
}

export function summarizeUpload(items: readonly UploadItem[]): UploadSummary {
  let uploaded = 0;
  let duplicate = 0;
  let failed = 0;
  for (const item of items) {
    if (item.status === "uploaded") uploaded += 1;
    else if (item.status === "duplicate") duplicate += 1;
    else if (item.status === "failed") failed += 1;
  }
  const done = uploaded + duplicate + failed;
  return { total: items.length, done, uploaded, duplicate, failed, active: items.length > 0 && done < items.length };
}

/** The ids of the documents that were stored, in batch order. */
export function uploadedIds(items: readonly UploadItem[]): string[] {
  return items.filter((item) => item.status === "uploaded").map((item) => item.id);
}
