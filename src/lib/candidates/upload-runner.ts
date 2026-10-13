/**
 * Runs a planned batch: for each file, hash, look for the same hash in
 * the organisation, upload the object, insert the documents row; a few
 * files at a time. Every outside effect is injected (UploadDeps), so the
 * sequence is tested with fakes in upload-runner.test.ts and bound to
 * supabase-js in upload-browser.ts. The dispatch receives every step so
 * the dialog can render it.
 */
import { UPLOAD_CONCURRENCY, type UploadAction, type UploadItem } from "./upload";

export interface UploadDeps {
  hash: (file: File) => Promise<string>;
  /** True when a document of the organisation already carries this hash. */
  findDuplicate: (sha256: string) => Promise<boolean>;
  /** Stores the object; throws when the bucket refuses. */
  upload: (path: string, file: File) => Promise<void>;
  /** Inserts the row; "duplicate" on the unique (org_id, sha256) index; throws otherwise. */
  insert: (item: UploadItem, sha256: string) => Promise<"ok" | "duplicate">;
  /** Removes the object stored a moment ago; best effort. */
  remove: (path: string) => Promise<void>;
}

async function removeQuietly(deps: UploadDeps, path: string): Promise<void> {
  try {
    await deps.remove(path);
  } catch (error) {
    // A member may not delete objects (the policy keeps that to admins); the orphan is harmless.
    console.warn("[upload] object left behind", path, error);
  }
}

async function runOne(item: UploadItem, deps: UploadDeps, dispatch: (action: UploadAction) => void): Promise<void> {
  dispatch({ type: "status", id: item.id, status: "hashing" });
  let sha256: string;
  try {
    sha256 = await deps.hash(item.file);
  } catch (error) {
    console.error(error);
    dispatch({ type: "failed", id: item.id, error: "hash" });
    return;
  }
  dispatch({ type: "hashed", id: item.id, sha256 });
  try {
    if (await deps.findDuplicate(sha256)) {
      dispatch({ type: "status", id: item.id, status: "duplicate" });
      return;
    }
  } catch (error) {
    // The look-up is a courtesy; the unique index decides below.
    console.warn("[upload] duplicate check failed", error);
  }
  dispatch({ type: "status", id: item.id, status: "uploading" });
  try {
    await deps.upload(item.path, item.file);
  } catch (error) {
    console.error(error);
    dispatch({ type: "failed", id: item.id, error: "upload" });
    return;
  }
  let outcome: "ok" | "duplicate";
  try {
    outcome = await deps.insert(item, sha256);
  } catch (error) {
    console.error(error);
    await removeQuietly(deps, item.path);
    dispatch({ type: "failed", id: item.id, error: "insert" });
    return;
  }
  if (outcome === "duplicate") {
    await removeQuietly(deps, item.path);
    dispatch({ type: "status", id: item.id, status: "duplicate" });
    return;
  }
  dispatch({ type: "status", id: item.id, status: "uploaded" });
}

/** Runs every item, `concurrency` at a time, and resolves when all reached a final state. */
export async function runUploads(
  items: readonly UploadItem[],
  deps: UploadDeps,
  dispatch: (action: UploadAction) => void,
  concurrency: number = UPLOAD_CONCURRENCY,
): Promise<void> {
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const item = items[next];
      next += 1;
      if (item) await runOne(item, deps, dispatch);
    }
  };
  const workers = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: workers }, () => worker()));
}
