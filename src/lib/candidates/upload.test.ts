import { describe, expect, it } from "vitest";

import {
  MAX_BATCH_FILES,
  MAX_FILE_BYTES,
  isPdf,
  planBatch,
  reduceUpload,
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

  it("caps a batch at 200 files", () => {
    const files = Array.from({ length: MAX_BATCH_FILES + 2 }, (_, i) => pdf(`${i}.pdf`));
    const { accepted, rejected } = validateFiles(files);
    expect(accepted).toHaveLength(MAX_BATCH_FILES);
    expect(rejected).toHaveLength(2);
    expect(rejected[0]?.reason).toBe("too_many");
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
      active: true,
    });
    items = reduceUpload(items, { type: "status", id: c.id, status: "duplicate" });
    expect(summarizeUpload(items).active).toBe(false);
    expect(uploadedIds(items)).toEqual([a.id]);
  });

  it("clears the error when an item moves again", () => {
    const [item] = planBatch([pdf("a.pdf")], "org", () => "x");
    if (!item) throw new Error("one item expected");
    const failed = reduceUpload([item], { type: "failed", id: "x", error: "insert" });
    const again = reduceUpload(failed, { type: "status", id: "x", status: "waiting" });
    expect(again[0]?.error).toBeNull();
    expect(summarizeUpload([])).toEqual({ total: 0, done: 0, uploaded: 0, duplicate: 0, failed: 0, active: false });
  });
});
