import { describe, expect, it } from "vitest";

import { planBatch, reduceUpload, type UploadAction, type UploadItem } from "./upload";
import { runUploads, type UploadDeps } from "./upload-runner";

function pdf(name: string): File {
  return new File([name], name, { type: "application/pdf" });
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

async function run(files: File[], deps: UploadDeps, concurrency = 3) {
  let items: UploadItem[] = planBatch(files, "org", (() => {
    let n = 0;
    return () => `d${++n}`;
  })());
  const actions: UploadAction[] = [];
  await runUploads(items, deps, (action) => {
    actions.push(action);
    items = reduceUpload(items, action);
  }, concurrency);
  return { items, actions };
}

describe("runUploads", () => {
  it("hashes, uploads and inserts every file", async () => {
    const { calls, deps } = harness();
    const { items } = await run([pdf("a.pdf"), pdf("b.pdf")], deps);
    expect(items.map((i) => i.status)).toEqual(["uploaded", "uploaded"]);
    expect(items.map((i) => i.sha256)).toEqual(["sha-a.pdf", "sha-b.pdf"]);
    expect(calls).toContain("upload:org/d1.pdf");
    expect(calls).toContain("insert:d2");
    expect(calls.some((c) => c.startsWith("remove:"))).toBe(false);
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
    const { items } = await run([pdf("h.pdf"), pdf("u.pdf"), pdf("i.pdf"), pdf("ok.pdf")], deps, 2);
    expect(items.map((i) => [i.status, i.error])).toEqual([
      ["failed", "hash"],
      ["failed", "upload"],
      ["failed", "insert"],
      ["uploaded", null],
    ]);
  });

  it("never runs more files at once than asked", async () => {
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
    const { items } = await run(Array.from({ length: 7 }, (_, i) => pdf(`${i}.pdf`)), deps, 3);
    expect(items.every((i) => i.status === "uploaded")).toBe(true);
    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(1);
  });

  it("does nothing for an empty batch", async () => {
    const { calls, deps } = harness();
    const { items, actions } = await run([], deps);
    expect(items).toEqual([]);
    expect(actions).toEqual([]);
    expect(calls).toEqual([]);
  });
});
