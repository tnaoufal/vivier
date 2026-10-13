import { describe, expect, it } from "vitest";

import { planBatch, reduceUpload, type UploadAction, type UploadItem } from "./upload";
import { runUploads, type RunOptions, type UploadDeps } from "./upload-runner";

function pdf(name: string): File {
  return new File([name], name, { type: "application/pdf" });
}

function pdfs(count: number): File[] {
  return Array.from({ length: count }, (_, i) => pdf(`${i}.pdf`));
}

function harness(overrides: Partial<UploadDeps> = {}) {
  const calls: string[] = [];
  const deps: UploadDeps = {
    hash: async (file) => {
      calls.push(`hash:${file.name}`);
      return `sha-${file.name}`;
    },
    findDuplicate: async () => false,
    upload: async (path) => {
      calls.push(`upload:${path}`);
    },
    insert: async (item) => {
      calls.push(`insert:${item.id}`);
      return "ok";
    },
    remove: async (path) => {
      calls.push(`remove:${path}`);
    },
    ...overrides,
  };
  return { calls, deps };
}

/** Runs a plan; the options may be built from `current()`, the live state the dispatch keeps. */
async function run(
  files: File[],
  deps: UploadDeps,
  options: RunOptions | ((current: () => UploadItem[]) => RunOptions) = {},
) {
  let items: UploadItem[] = planBatch(files, "org", (() => {
    let n = 0;
    return () => `d${++n}`;
  })());
  const actions: UploadAction[] = [];
  const resolved = typeof options === "function" ? options(() => items) : options;
  const result = await runUploads(
    items,
    deps,
    (action) => {
      actions.push(action);
      items = reduceUpload(items, action);
    },
    resolved,
  );
  return { items, actions, result };
}

const inFlight = (items: readonly UploadItem[]) =>
  items.filter((item) => item.status === "hashing" || item.status === "uploading").length;

describe("runUploads", () => {
  it("hashes, uploads and inserts every file", async () => {
    const { calls, deps } = harness();
    const { items, result } = await run([pdf("a.pdf"), pdf("b.pdf")], deps);
    expect(items.map((i) => i.status)).toEqual(["uploaded", "uploaded"]);
    expect(items.map((i) => i.sha256)).toEqual(["sha-a.pdf", "sha-b.pdf"]);
    expect(calls).toContain("upload:org/d1.pdf");
    expect(calls).toContain("insert:d2");
    expect(calls.some((c) => c.startsWith("remove:"))).toBe(false);
    expect(result).toEqual({ lotCount: 1, lotsDone: 1, stopped: false });
  });

  it("marks a known hash as duplicate without uploading", async () => {
    const { calls, deps } = harness({ findDuplicate: async (sha) => sha === "sha-a.pdf" });
    const { items } = await run([pdf("a.pdf"), pdf("b.pdf")], deps);
    expect(items[0]?.status).toBe("duplicate");
    expect(items[1]?.status).toBe("uploaded");
    expect(calls).not.toContain("upload:org/d1.pdf");
  });

  it("treats the unique index as a duplicate and removes the object", async () => {
    const { calls, deps } = harness({ insert: async () => "duplicate" });
    const { items } = await run([pdf("a.pdf")], deps);
    expect(items[0]?.status).toBe("duplicate");
    expect(calls).toContain("remove:org/d1.pdf");
  });

  it("reports each failing step and keeps going", async () => {
    const { deps } = harness({
      hash: async (file) => {
        if (file.name === "h.pdf") throw new Error("no");
        return "sha";
      },
      upload: async (path) => {
        if (path.endsWith("d2.pdf")) throw new Error("bucket");
      },
      insert: async (item) => {
        if (item.id === "d3") throw new Error("row");
        return "ok";
      },
      findDuplicate: async () => {
        throw new Error("offline");
      },
    });
    const { items } = await run([pdf("h.pdf"), pdf("u.pdf"), pdf("i.pdf"), pdf("ok.pdf")], deps, { concurrency: 2 });
    expect(items.map((i) => [i.status, i.error])).toEqual([
      ["failed", "hash"],
      ["failed", "upload"],
      ["failed", "insert"],
      ["uploaded", null],
    ]);
  });

  it("never runs more files at once than asked inside a lot", async () => {
    let running = 0;
    let peak = 0;
    const { deps } = harness({
      upload: async () => {
        running += 1;
        peak = Math.max(peak, running);
        await new Promise((resolve) => setTimeout(resolve, 5));
        running -= 1;
      },
    });
    const { items } = await run(pdfs(7), deps, { concurrency: 3, lotSize: 4 });
    expect(items.every((i) => i.status === "uploaded")).toBe(true);
    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(1);
  });

  it("runs the lots one after the other and names each one", async () => {
    const seen: Array<{ lot: string[]; index: number; count: number; inFlight: number }> = [];
    let peak = 0;
    const { deps } = harness({
      upload: async () => {
        await new Promise((resolve) => setTimeout(resolve, 2));
      },
    });
    const { items, result } = await run(pdfs(5), deps, (current) => ({
      lotSize: 2,
      // More workers than a lot holds: only a lot run on its own keeps two files in flight at most.
      concurrency: 3,
      onLotStart: (lot, index, count) => {
        seen.push({ lot: lot.map((item) => item.id), index, count, inFlight: inFlight(current()) });
      },
      onLotDone: () => {
        peak = Math.max(peak, inFlight(current()));
      },
    }));
    expect(seen).toEqual([
      { lot: ["d1", "d2"], index: 1, count: 3, inFlight: 0 },
      { lot: ["d3", "d4"], index: 2, count: 3, inFlight: 0 },
      { lot: ["d5"], index: 3, count: 3, inFlight: 0 },
    ]);
    expect(peak).toBe(0);
    expect(items.every((i) => i.status === "uploaded")).toBe(true);
    expect(result).toEqual({ lotCount: 3, lotsDone: 3, stopped: false });
  });

  it("keeps two files at most in flight when a lot holds two", async () => {
    let running = 0;
    let peak = 0;
    const { deps } = harness({
      upload: async () => {
        running += 1;
        peak = Math.max(peak, running);
        await new Promise((resolve) => setTimeout(resolve, 3));
        running -= 1;
      },
    });
    await run(pdfs(6), deps, { lotSize: 2, concurrency: 3 });
    expect(peak).toBe(2);
  });

  it("hands each finished lot with the ids it stored, in the lot's order, and waits for the callback", async () => {
    const lots: string[][] = [];
    let callbackRunning = false;
    let uploadedDuringCallback = false;
    const { deps } = harness({
      findDuplicate: async (sha) => sha === "sha-2.pdf",
      upload: async (path) => {
        if (callbackRunning) uploadedDuringCallback = true;
        // The first file of a lot takes longer, so workers finish out of order.
        await new Promise((resolve) => setTimeout(resolve, path.endsWith("d1.pdf") ? 8 : 1));
      },
      insert: async (item) => (item.id === "d4" ? "duplicate" : "ok"),
    });
    const { items } = await run(pdfs(5), deps, {
      lotSize: 3,
      onLotDone: async (lot, uploadedIds) => {
        callbackRunning = true;
        await new Promise((resolve) => setTimeout(resolve, 5));
        callbackRunning = false;
        lots.push([`lot:${lot.length}`, ...uploadedIds]);
      },
    });
    expect(lots).toEqual([
      ["lot:3", "d1", "d2"],
      ["lot:2", "d5"],
    ]);
    expect(uploadedDuringCallback).toBe(false);
    expect(items.map((i) => i.status)).toEqual(["uploaded", "uploaded", "duplicate", "duplicate", "uploaded"]);
  });

  it("stops between lots when asked and marks what never started as skipped", async () => {
    let allow = true;
    const done: number[] = [];
    const { calls, deps } = harness();
    const { items, result } = await run(pdfs(7), deps, {
      lotSize: 2,
      shouldContinue: () => allow,
      onLotDone: (lot) => {
        done.push(lot.length);
        // Asked during the second lot: it finishes, the third never starts.
        if (done.length === 2) allow = false;
      },
    });
    expect(done).toEqual([2, 2]);
    expect(items.map((i) => i.status)).toEqual([
      "uploaded",
      "uploaded",
      "uploaded",
      "uploaded",
      "skipped",
      "skipped",
      "skipped",
    ]);
    expect(calls.filter((c) => c.startsWith("hash:"))).toHaveLength(4);
    expect(result).toEqual({ lotCount: 4, lotsDone: 2, stopped: true });
  });

  it("skips everything when the answer is no before the first lot", async () => {
    const { calls, deps } = harness();
    const { items, result } = await run(pdfs(3), deps, { lotSize: 2, shouldContinue: () => false });
    expect(items.every((i) => i.status === "skipped")).toBe(true);
    expect(calls).toEqual([]);
    expect(result).toEqual({ lotCount: 2, lotsDone: 0, stopped: true });
  });

  it("is not stopped when the answer turns to no during the last lot", async () => {
    let allow = true;
    const { deps } = harness({
      upload: async () => {
        allow = false;
      },
    });
    const { items, result } = await run(pdfs(2), deps, { lotSize: 2, shouldContinue: () => allow });
    expect(items.every((i) => i.status === "uploaded")).toBe(true);
    expect(result.stopped).toBe(false);
  });

  it("does nothing for an empty batch", async () => {
    const { calls, deps } = harness();
    const { items, actions, result } = await run([], deps);
    expect(items).toEqual([]);
    expect(actions).toEqual([]);
    expect(calls).toEqual([]);
    expect(result).toEqual({ lotCount: 0, lotsDone: 0, stopped: false });
  });
});
