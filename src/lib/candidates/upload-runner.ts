/**
 * Runs a planned import lot after lot: inside a lot a few files at a
 * time, each one hashed, looked up by hash in the organisation,
 * uploaded, then recorded as a documents row. A lot is finished when
 * every item of it reached a final state; the caller hears of it
 * (`onLotDone`, with the ids stored, so it can poke the processor) and
 * is asked before the next one starts (`shouldContinue`): a refusal
 * marks every item not yet started as skipped and resolves. Every
 * outside effect is injected (UploadDeps), so the sequence is tested
 * with fakes in upload-runner.test.ts and bound to supabase-js in
 * upload-browser.ts. The dispatch receives every step so the dialog can
 * render it.
 */
import {
  LOT_SIZE,
  UPLOAD_CONCURRENCY,
  planLots,
  type UploadAction,
  type UploadItem,
  type UploadStatus,
} from "./upload";

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

export interface RunOptions {
  /** Files per lot; LOT_SIZE by default. */
  lotSize?: number;
  /** Files in flight at once inside a lot; UPLOAD_CONCURRENCY by default. */
  concurrency?: number;
  /** Told when a lot starts: its items, its 1-based index and the number of lots. */
  onLotStart?: (lot: readonly UploadItem[], index: number, count: number) => void;
  /** Awaited after each lot with the ids of the documents it stored (maybe none). */
  onLotDone?: (lot: readonly UploadItem[], uploadedIds: string[]) => void | Promise<void>;
  /** Asked before each lot; false skips this lot and every later one. */
  shouldContinue?: () => boolean;
}

export interface RunResult {
  /** The number of lots the plan was cut into. */
  lotCount: number;
  /** How many of them ran to the end. */
  lotsDone: number;
  /** True when shouldContinue() refused a lot: the rest is skipped, "Reprendre" may send it. */
  stopped: boolean;
}

async function removeQuietly(deps: UploadDeps, path: string): Promise<void> {
  try {
    await deps.remove(path);
  } catch (error) {
    // A member may not delete objects (the policy keeps that to admins); the orphan is harmless.
    console.warn("[upload] object left behind", path, error);
  }
}

/** One file to its final state; returns that state so the lot knows what it stored. */
async function runOne(
  item: UploadItem,
  deps: UploadDeps,
  dispatch: (action: UploadAction) => void,
): Promise<UploadStatus> {
  dispatch({ type: "status", id: item.id, status: "hashing" });
  let sha256: string;
  try {
    sha256 = await deps.hash(item.file);
  } catch (error) {
    console.error(error);
    dispatch({ type: "failed", id: item.id, error: "hash" });
    return "failed";
  }
  dispatch({ type: "hashed", id: item.id, sha256 });
  try {
    if (await deps.findDuplicate(sha256)) {
      dispatch({ type: "status", id: item.id, status: "duplicate" });
      return "duplicate";
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
    return "failed";
  }
  let outcome: "ok" | "duplicate";
  try {
    outcome = await deps.insert(item, sha256);
  } catch (error) {
    console.error(error);
    await removeQuietly(deps, item.path);
    dispatch({ type: "failed", id: item.id, error: "insert" });
    return "failed";
  }
  if (outcome === "duplicate") {
    await removeQuietly(deps, item.path);
    dispatch({ type: "status", id: item.id, status: "duplicate" });
    return "duplicate";
  }
  dispatch({ type: "status", id: item.id, status: "uploaded" });
  return "uploaded";
}

/** Runs one lot, `concurrency` files at a time; resolves with the ids it stored once every item is final. */
async function runLot(
  lot: readonly UploadItem[],
  deps: UploadDeps,
  dispatch: (action: UploadAction) => void,
  concurrency: number,
): Promise<string[]> {
  const stored: string[] = [];
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < lot.length) {
      const item = lot[next];
      next += 1;
      if (!item) continue;
      const status = await runOne(item, deps, dispatch);
      if (status === "uploaded") stored.push(item.id);
    }
  };
  const workers = Math.max(1, Math.min(concurrency, lot.length));
  await Promise.all(Array.from({ length: workers }, () => worker()));
  // Workers finish in any order; the ids follow the lot's order, like the rows a person reads.
  const order = new Map(lot.map((item, index) => [item.id, index]));
  return stored.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
}

/** Runs every lot in turn and resolves when each item reached a final state (skipped included). */
export async function runUploads(
  items: readonly UploadItem[],
  deps: UploadDeps,
  dispatch: (action: UploadAction) => void,
  options: RunOptions = {},
): Promise<RunResult> {
  const lots = planLots(items, options.lotSize ?? LOT_SIZE);
  const concurrency = options.concurrency ?? UPLOAD_CONCURRENCY;
  let lotsDone = 0;
  for (let index = 0; index < lots.length; index += 1) {
    const lot = lots[index];
    if (!lot) continue;
    if (options.shouldContinue && !options.shouldContinue()) {
      for (const rest of lots.slice(index)) {
        for (const item of rest) dispatch({ type: "status", id: item.id, status: "skipped" });
      }
      return { lotCount: lots.length, lotsDone, stopped: true };
    }
    options.onLotStart?.(lot, index + 1, lots.length);
    const stored = await runLot(lot, deps, dispatch, concurrency);
    lotsDone += 1;
    if (options.onLotDone) await options.onLotDone(lot, stored);
  }
  return { lotCount: lots.length, lotsDone, stopped: false };
}
