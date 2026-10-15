import { describe, expect, it } from "vitest";

import {
  failureKind,
  finalRankGroup,
  groupsOf,
  pendingRankGroups,
  rankable,
  readBatched,
  retryAfterMs,
  runPool,
  spansSeveralGroups,
} from "../src/analysis/batches.js";
import { ModelError } from "../src/model.js";
import type { Assessment, MatchResult } from "../src/types.js";

const NONE = new Set<string>();

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function result(id: string, assessment?: Partial<Assessment> | null): MatchResult {
  const base: MatchResult = {
    candidateId: id,
    score: 50,
    coverage: 1,
    blocked: false,
    verdicts: [],
    why: null,
    retrieval: { textRank: null, vectorRank: null },
  };
  if (assessment === null || assessment === undefined) return base;
  return {
    ...base,
    assessment: {
      decision: "fit",
      score: 80,
      summary: "",
      requirements: [],
      model: "m",
      ...assessment,
    },
  };
}

describe("runPool", () => {
  it("runs the items a few at a time, in order, and answers whether it was stopped", async () => {
    let active = 0;
    let peak = 0;
    const seen: number[] = [];
    const stopped = await runPool([1, 2, 3, 4, 5, 6], 2, async (item) => {
      active += 1;
      peak = Math.max(peak, active);
      seen.push(item);
      await tick();
      active -= 1;
    });
    expect(stopped).toBe(false);
    expect(peak).toBe(2);
    expect(seen).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("starts nothing new once shouldStop answers true, and lets the items in flight end", async () => {
    let stop = false;
    const done: number[] = [];
    const stopped = await runPool(
      [1, 2, 3, 4],
      2,
      async (item) => {
        await tick();
        done.push(item);
        if (item === 1) stop = true;
      },
      () => stop,
    );
    expect(stopped).toBe(true);
    expect(done).toEqual([1, 2]);
  });

  it("throws the worker's error once the items in flight have ended, and starts no other", async () => {
    const done: number[] = [];
    await expect(
      runPool([1, 2, 3, 4], 2, async (item) => {
        await tick();
        if (item === 1) throw new Error("boom");
        done.push(item);
      }),
    ).rejects.toThrow("boom");
    expect(done).toEqual([2]);
  });
});

describe("readBatched", () => {
  function cards(count: number, prefix = "c"): string[] {
    return Array.from({ length: count }, (_, index) => `${prefix}${index + 1}`);
  }

  it("reads a batch the model cannot answer again in halves, down to BATCH_MIN cards", async () => {
    const reads: number[] = [];
    const failures = new Map<string, number>();
    const settled: string[] = [];
    const report = await readBatched([cards(40)], 4, {
      read: async (part) => {
        reads.push(part.length);
        // A part that holds c1 fails while it is wider than ten cards.
        return !(part.includes("c1") && part.length > 10);
      },
      failed: async (part) => {
        for (const card of part) failures.set(card, (failures.get(card) ?? 0) + 1);
      },
      settle: async (part) => {
        settled.push(...part);
      },
    });
    expect(reads).toEqual([40, 20, 20, 10, 10]);
    expect(report).toEqual({ calls: 5, failures: 2, unreadable: 0, stopped: false });
    expect(failures.get("c1")).toBe(2);
    expect(failures.get("c40")).toBe(1);
    expect(settled).toEqual([]);
  });

  it("counts a part's failures at its size: a part of ten born of two splits gets its own two calls before it is settled", async () => {
    const reads: number[] = [];
    const settled: string[][] = [];
    const report = await readBatched([cards(40)], 4, {
      read: async (part) => {
        reads.push(part.length);
        // The part that holds c1 fails at every size.
        return !part.includes("c1");
      },
      failed: async () => undefined,
      settle: async (part) => {
        settled.push([...part]);
      },
    });
    expect(reads).toEqual([40, 20, 20, 10, 10, 10]);
    expect(settled).toEqual([cards(10)]);
    expect(report).toEqual({ calls: 6, failures: 4, unreadable: 10, stopped: false });
  });

  it("settles a part of BATCH_MIN cards or fewer once it failed twice", async () => {
    const reads: number[] = [];
    const settled: string[][] = [];
    const report = await readBatched([cards(8)], 4, {
      read: async (part) => {
        reads.push(part.length);
        return false;
      },
      failed: async () => undefined,
      settle: async (part) => {
        settled.push([...part]);
      },
    });
    expect(reads).toEqual([8, 8]);
    expect(settled).toEqual([cards(8)]);
    expect(report).toEqual({ calls: 2, failures: 2, unreadable: 8, stopped: false });
  });

  it("reads a small part once more before settling it, and stops between rounds when asked", async () => {
    let stop = false;
    const reads: string[][] = [];
    const report = await readBatched(
      [cards(5, "a"), cards(5, "b")],
      1,
      {
        read: async (part) => {
          reads.push([...part]);
          // The part that starts with a1 fails the first time only.
          if (part[0] !== "a1") return true;
          return reads.filter((read) => read[0] === "a1").length > 1;
        },
        failed: async () => undefined,
        settle: async () => {
          throw new Error("never settled here");
        },
      },
      () => stop,
    );
    expect(report).toEqual({ calls: 3, failures: 1, unreadable: 0, stopped: false });
    expect(reads.map((part) => part[0])).toEqual(["a1", "b1", "a1"]);
    stop = true;
    const stoppedReport = await readBatched(
      [cards(2)],
      1,
      {
        read: async () => true,
        failed: async () => undefined,
        settle: async () => undefined,
      },
      () => stop,
    );
    expect(stoppedReport).toEqual({ calls: 0, failures: 0, unreadable: 0, stopped: true });
  });

  it("throws what read() throws: the run fails on it", async () => {
    await expect(
      readBatched([cards(3)], 2, {
        read: async () => {
          throw new Error("db down");
        },
        failed: async () => undefined,
        settle: async () => undefined,
      }),
    ).rejects.toThrow("db down");
  });
});

describe("retryAfterMs", () => {
  const now = Date.parse("2026-10-15T10:00:00.000Z");
  const refusal = (headers: unknown) => new ModelError("x", { cause: { status: 429, headers } });

  it("reads the seconds or the date a Retry-After names, from a record or a Headers-like object", () => {
    expect(retryAfterMs(refusal({ "retry-after": "3" }), now)).toBe(3000);
    expect(
      retryAfterMs(
        refusal({ get: (name: string) => (name === "retry-after" ? "1.5" : null) }),
        now,
      ),
    ).toBe(1500);
    expect(retryAfterMs(refusal({ "retry-after": "Thu, 15 Oct 2026 10:00:20 GMT" }), now)).toBe(
      20000,
    );
  });

  it("answers 0 without a header, for one it cannot read, one in the past, or one longer than a minute", () => {
    expect(retryAfterMs(refusal(undefined), now)).toBe(0);
    expect(retryAfterMs(refusal({ "retry-after": "soon" }), now)).toBe(0);
    expect(retryAfterMs(refusal({ "retry-after": "Thu, 15 Oct 2026 09:59:00 GMT" }), now)).toBe(0);
    expect(retryAfterMs(refusal({ "retry-after": "61" }), now)).toBe(0);
    expect(retryAfterMs(refusal({ "retry-after": "60" }), now)).toBe(60000);
    expect(retryAfterMs(new ModelError("no cause"), now)).toBe(0);
    expect(retryAfterMs(new Error("not a model error"), now)).toBe(0);
  });
});

describe("failureKind", () => {
  it("reads the class of a failed call from the model error and its cause", () => {
    expect(failureKind(new ModelError("The model did not answer valid JSON"))).toBe("content");
    expect(failureKind(new ModelError("x", { cause: { status: 400 } }))).toBe("content");
    expect(failureKind(new ModelError("x", { cause: { status: 413 } }))).toBe("content");
    expect(failureKind(new ModelError("x", { cause: { status: 429 } }))).toBe("provider");
    expect(failureKind(new ModelError("x", { cause: { status: 500 } }))).toBe("provider");
    expect(failureKind(new ModelError("x", { cause: { status: 401 } }))).toBe("provider");
    expect(failureKind(new ModelError("x", { cause: new Error("Request timed out.") }))).toBe(
      "content",
    );
    expect(failureKind(new ModelError("x", { cause: new Error("connect ECONNREFUSED") }))).toBe(
      "provider",
    );
    expect(failureKind(new Error("db down"))).toBe("other");
    expect(failureKind("nope")).toBe("other");
  });
});

describe("the rank groups", () => {
  it("groups the ids by eight and never leaves one alone", () => {
    expect(groupsOf(["a"])).toEqual([]);
    expect(groupsOf(["a", "b"])).toEqual([["a", "b"]]);
    const nine = Array.from({ length: 9 }, (_, index) => `c${index + 1}`);
    expect(groupsOf(nine)).toEqual([
      ["c1", "c2", "c3", "c4", "c5", "c6", "c7"],
      ["c8", "c9"],
    ]);
  });

  it("compares the untiered retained and borderline results, best first, a lone one with tiered companions", () => {
    const results = [
      result("fit-low", { decision: "fit", score: 70 }),
      result("no-fit", { decision: "no_fit", score: 20 }),
      result("border", { decision: "borderline", score: 60 }),
      result("fit-high", { decision: "fit", score: 90 }),
      result("unread"),
    ];
    expect(rankable(results, NONE).map((entry) => entry.candidateId)).toEqual([
      "fit-high",
      "fit-low",
      "border",
    ]);
    expect(pendingRankGroups(results, NONE)).toEqual([["fit-high", "fit-low", "border"]]);
    expect(pendingRankGroups(results, new Set(["fit-high", "fit-low"]))).toEqual([]);
    const tiered = [
      result("a", { decision: "fit", score: 90, tier: "A" }),
      result("b", { decision: "fit", score: 85, tier: "B" }),
      result("fresh", { decision: "borderline", score: 60 }),
    ];
    expect(pendingRankGroups(tiered, NONE)).toEqual([["fresh", "a", "b"]]);
    expect(spansSeveralGroups(tiered, NONE)).toBe(false);
  });

  it("makes the final group of the A's alone, two at least, eight at most", () => {
    const results = [
      result("a1", { decision: "fit", score: 90, tier: "A" }),
      result("b1", { decision: "fit", score: 88, tier: "B" }),
      result("a2", { decision: "fit", score: 80, tier: "A" }),
      result("x", { decision: "borderline", score: 70, tier: "B" }),
    ];
    expect(finalRankGroup(results, NONE)).toEqual(["a1", "a2"]);
    expect(finalRankGroup(results, new Set(["a2"]))).toEqual([]);
    const many = Array.from({ length: 12 }, (_, index) =>
      result(`a${index}`, { decision: "fit", score: 99 - index, tier: "A" }),
    );
    expect(finalRankGroup(many, NONE)).toHaveLength(8);
    expect(spansSeveralGroups(many, NONE)).toBe(true);
  });
});
