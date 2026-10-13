import { describe, expect, it } from "vitest";

import {
  LOT_SIZE,
  MAX_BATCH_FILES,
  MAX_FILE_BYTES,
  groupRejected,
  isFinalStatus,
  isPdf,
  planBatch,
  planLots,
  reduceUpload,
  resumeSkipped,
  retryFailed,
  skipUnfinished,
  summarizeUpload,
  uploadedIds,
  validateFiles,
} from "./upload";

function pdf(name: string, size = 10, type = "application/pdf"): File {
  const file = new File(["x"], name, { type });
  // File sizes are read-only; a stand-in size keeps the test free of large buffers.
  Object.defineProperty(file, "size", { value: size });
  return file;
}

function ids() {
  let n = 0;
  return () => `id-${++n}`;
}

describe("isPdf", () => {
  it("accepts the PDF type, or the extension when the type is empty", () => {
    expect(isPdf({ name: "cv.pdf", type: "application/pdf" })).toBe(true);
    expect(isPdf({ name: "cv.PDF", type: "" })).toBe(true);
    expect(isPdf({ name: "cv.docx", type: "" })).toBe(false);
    expect(isPdf({ name: "cv.pdf", type: "text/plain" })).toBe(false);
  });
});

describe("validateFiles", () => {
  it("refuses other types, empty and oversized files, with the reason", () => {
    const { accepted, rejected } = validateFiles([
      pdf("ok.pdf"),
      pdf("word.docx", 10, "application/msword"),
      pdf("empty.pdf", 0),
      pdf("big.pdf", MAX_FILE_BYTES + 1),
      pdf("limit.pdf", MAX_FILE_BYTES),
    ]);
    expect(accepted.map((f) => f.name)).toEqual(["ok.pdf", "limit.pdf"]);
    expect(rejected.map((r) => [r.file.name, r.reason])).toEqual([
      ["word.docx", "not_pdf"],
      ["empty.pdf", "empty"],
      ["big.pdf", "too_large"],
    ]);
  });

  it("caps an import at 10 000 files", () => {
    expect(MAX_BATCH_FILES).toBe(10_000);
    const files = Array.from({ length: MAX_BATCH_FILES + 2 }, (_, i) => pdf(`${i}.pdf`));
    const { accepted, rejected } = validateFiles(files);
    expect(accepted).toHaveLength(MAX_BATCH_FILES);
    expect(rejected).toHaveLength(2);
    expect(rejected.every((r) => r.reason === "too_many")).toBe(true);
  });
});

describe("groupRejected", () => {
  it("counts the refusals by reason in a fixed order, without the empty reasons", () => {
    const { rejected } = validateFiles([
      pdf("a.docx", 10, "text/plain"),
      pdf("big.pdf", MAX_FILE_BYTES + 1),
      pdf("b.docx", 10, "text/plain"),
      pdf("c.docx", 10, "text/plain"),
    ]);
    expect(groupRejected(rejected)).toEqual([
      { reason: "not_pdf", count: 3 },
      { reason: "too_large", count: 1 },
    ]);
    expect(groupRejected([])).toEqual([]);
  });

  it("stays one line per reason whatever the number of files", () => {
    const files = Array.from({ length: 500 }, (_, i) => pdf(`${i}.txt`, 10, "text/plain"));
    expect(groupRejected(validateFiles(files).rejected)).toEqual([{ reason: "not_pdf", count: 500 }]);
  });
});

describe("planLots", () => {
  it("cuts the plan into lots of the asked size, the last one shorter", () => {
    const items = Array.from({ length: 7 }, (_, i) => i);
    expect(planLots(items, 3)).toEqual([
      [0, 1, 2],
      [3, 4, 5],
      [6],
    ]);
    expect(planLots(items, 7)).toEqual([items]);
    expect(planLots(items, 100)).toEqual([items]);
  });

  it("makes no lot of nothing and never a lot smaller than one", () => {
    expect(planLots([], 3)).toEqual([]);
    expect(planLots([1, 2], 0)).toEqual([[1], [2]]);
  });

  it("sends 10 000 files in 100 lots of 100", () => {
    const lots = planLots(Array.from({ length: MAX_BATCH_FILES }, (_, i) => i));
    expect(LOT_SIZE).toBe(100);
    expect(lots).toHaveLength(100);
    expect(lots.every((lot) => lot.length === LOT_SIZE)).toBe(true);
  });
});

describe("planBatch", () => {
  it("gives each file an id and the organisation's object key", () => {
    let n = 0;
    const items = planBatch([pdf("a.pdf"), pdf("b.pdf")], "org-1", () => `id-${++n}`);
    expect(items.map((i) => i.path)).toEqual(["org-1/id-1.pdf", "org-1/id-2.pdf"]);
    expect(items.every((i) => i.status === "waiting" && i.error === null && i.sha256 === null)).toBe(true);
  });
});

describe("reduceUpload and summarizeUpload", () => {
  it("moves one item at a time and sums the batch", () => {
    let items = planBatch([pdf("a.pdf"), pdf("b.pdf"), pdf("c.pdf")], "org", () => crypto.randomUUID());
    const [a, b, c] = items;
    if (!a || !b || !c) throw new Error("three items expected");
    items = reduceUpload(items, { type: "status", id: a.id, status: "hashing" });
    items = reduceUpload(items, { type: "hashed", id: a.id, sha256: "abc" });
    items = reduceUpload(items, { type: "status", id: a.id, status: "uploaded" });
    items = reduceUpload(items, { type: "failed", id: b.id, error: "upload" });
    expect(items[0]?.sha256).toBe("abc");
    expect(items[1]?.error).toBe("upload");
    expect(items[2]?.status).toBe("waiting");
    expect(summarizeUpload(items)).toEqual({
      total: 3,
      done: 2,
      uploaded: 1,
      duplicate: 0,
      failed: 1,
      skipped: 0,
      active: true,
    });
    items = reduceUpload(items, { type: "status", id: c.id, status: "duplicate" });
    expect(summarizeUpload(items).active).toBe(false);
    expect(uploadedIds(items)).toEqual([a.id]);
  });

  it("counts a skipped item apart from the done ones and as final", () => {
    let items = planBatch([pdf("a.pdf"), pdf("b.pdf")], "org", ids());
    items = reduceUpload(items, { type: "status", id: "id-1", status: "uploaded" });
    items = reduceUpload(items, { type: "status", id: "id-2", status: "skipped" });
    expect(summarizeUpload(items)).toEqual({
      total: 2,
      done: 1,
      uploaded: 1,
      duplicate: 0,
      failed: 0,
      skipped: 1,
      active: false,
    });
    expect(isFinalStatus("skipped")).toBe(true);
    expect(isFinalStatus("waiting")).toBe(false);
    expect(isFinalStatus("uploading")).toBe(false);
  });

  it("clears the error when an item moves again", () => {
    const [item] = planBatch([pdf("a.pdf")], "org", () => "x");
    if (!item) throw new Error("one item expected");
    const failed = reduceUpload([item], { type: "failed", id: "x", error: "insert" });
    const again = reduceUpload(failed, { type: "status", id: "x", status: "waiting" });
    expect(again[0]?.error).toBeNull();
    expect(summarizeUpload([])).toEqual({
      total: 0,
      done: 0,
      uploaded: 0,
      duplicate: 0,
      failed: 0,
      skipped: 0,
      active: false,
    });
  });
});

describe("skipUnfinished", () => {
  it("marks what was still on its way as skipped and leaves the final items", () => {
    let items = planBatch([pdf("a.pdf"), pdf("b.pdf"), pdf("c.pdf"), pdf("d.pdf")], "org", ids());
    items = reduceUpload(items, { type: "status", id: "id-1", status: "uploaded" });
    items = reduceUpload(items, { type: "status", id: "id-2", status: "uploading" });
    items = reduceUpload(items, { type: "failed", id: "id-3", error: "upload" });
    const next = skipUnfinished(items);
    expect(next.map((i) => i.status)).toEqual(["uploaded", "skipped", "failed", "skipped"]);
    expect(resumeSkipped(next).resumed.map((i) => i.id)).toEqual(["id-2", "id-4"]);
  });
});

describe("resumeSkipped", () => {
  it("puts the skipped items back to waiting with their ids and leaves the rest", () => {
    let items = planBatch([pdf("a.pdf"), pdf("b.pdf"), pdf("c.pdf")], "org", ids());
    items = reduceUpload(items, { type: "status", id: "id-1", status: "uploaded" });
    items = reduceUpload(items, { type: "status", id: "id-2", status: "skipped" });
    items = reduceUpload(items, { type: "status", id: "id-3", status: "skipped" });
    const { items: next, resumed } = resumeSkipped(items);
    expect(next.map((i) => i.status)).toEqual(["uploaded", "waiting", "waiting"]);
    expect(resumed.map((i) => i.id)).toEqual(["id-2", "id-3"]);
    expect(resumeSkipped(next).resumed).toEqual([]);
  });
});

describe("retryFailed", () => {
  it("replaces each failed item in place by a fresh one for the same file", () => {
    let items = planBatch([pdf("a.pdf"), pdf("b.pdf"), pdf("c.pdf")], "org", ids());
    items = reduceUpload(items, { type: "status", id: "id-1", status: "uploaded" });
    items = reduceUpload(items, { type: "failed", id: "id-2", error: "insert" });
    items = reduceUpload(items, { type: "status", id: "id-3", status: "duplicate" });
    let n = 10;
    const { items: next, retried } = retryFailed(items, "org", () => `new-${++n}`);
    expect(next.map((i) => i.id)).toEqual(["id-1", "new-11", "id-3"]);
    expect(next[1]?.path).toBe("org/new-11.pdf");
    expect(next[1]?.file.name).toBe("b.pdf");
    expect(next[1]?.status).toBe("waiting");
    expect(next[1]?.error).toBeNull();
    expect(retried).toHaveLength(1);
    expect(retried[0]).toBe(next[1]);
    expect(summarizeUpload(next).failed).toBe(0);
  });

  it("changes nothing when nothing failed", () => {
    const items = planBatch([pdf("a.pdf")], "org", ids());
    const { items: next, retried } = retryFailed(items, "org", () => "unused");
    expect(next).toEqual(items);
    expect(retried).toEqual([]);
  });

  it("leaves the skipped items unsent: a retry after a stop still waits for a resume", () => {
    let items = planBatch([pdf("a.pdf"), pdf("b.pdf"), pdf("c.pdf")], "org", ids());
    items = reduceUpload(items, { type: "failed", id: "id-1", error: "upload" });
    items = reduceUpload(items, { type: "status", id: "id-2", status: "skipped" });
    items = reduceUpload(items, { type: "status", id: "id-3", status: "skipped" });
    const { items: next, retried } = retryFailed(items, "org", () => "fresh");
    expect(retried.map((i) => i.id)).toEqual(["fresh"]);
    expect(summarizeUpload(next).skipped).toBe(2);
    expect(resumeSkipped(next).resumed.map((i) => i.id)).toEqual(["id-2", "id-3"]);
  });
});
