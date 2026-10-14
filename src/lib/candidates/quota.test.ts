import { describe, expect, it } from "vitest";

import {
  QUOTA_ERROR_PATTERN,
  QUOTA_ERROR_PREFIX,
  REQUEUE_POKE_CHUNK,
  REQUEUE_UPDATE_CHUNK,
  beyondQuota,
  isQuotaFailure,
  planPokes,
  planRequeue,
  quotaRemaining,
} from "./quota";
import { FAILURE_MESSAGES } from "../../../services/processor/src/messages";

/**
 * The processor's own sentence, read from its source so that editing
 * FAILURE_MESSAGES.quota without the prefix here breaks this test: the
 * browser must keep recognising what the service writes.
 */
const PROCESSOR_SENTENCE: string = FAILURE_MESSAGES.quota;

describe("isQuotaFailure", () => {
  it("recognises the processor's sentence on a failed document", () => {
    expect(PROCESSOR_SENTENCE.startsWith(QUOTA_ERROR_PREFIX)).toBe(true);
    expect(QUOTA_ERROR_PATTERN).toBe("Quota mensuel%");
    expect(isQuotaFailure({ status: "failed", error: PROCESSOR_SENTENCE })).toBe(true);
  });

  it("leaves real failures, other statuses and empty sentences alone", () => {
    expect(isQuotaFailure({ status: "failed", error: "Le fichier n'a pas pu être lu." })).toBe(
      false,
    );
    expect(isQuotaFailure({ status: "failed", error: null })).toBe(false);
    expect(isQuotaFailure({ status: "failed", error: "" })).toBe(false);
    expect(isQuotaFailure({ status: "failed", error: " Quota mensuel de CV atteint." })).toBe(
      false,
    );
    expect(isQuotaFailure({ status: "queued", error: PROCESSOR_SENTENCE })).toBe(false);
    expect(isQuotaFailure({ status: "processed", error: PROCESSOR_SENTENCE })).toBe(false);
    expect(isQuotaFailure({ status: "rejected", error: PROCESSOR_SENTENCE })).toBe(false);
  });
});

describe("quotaRemaining", () => {
  it("is the room left in the month, never negative", () => {
    expect(quotaRemaining(200, 0)).toBe(200);
    expect(quotaRemaining(200, 150)).toBe(50);
    expect(quotaRemaining(200, 200)).toBe(0);
    expect(quotaRemaining(200, 1190)).toBe(0);
    expect(quotaRemaining(200, -5)).toBe(200);
  });

  it("counts the queue against the room: the service claims it first", () => {
    expect(quotaRemaining(200, 150, 30)).toBe(20);
    expect(quotaRemaining(200, 150, 50)).toBe(0);
    expect(quotaRemaining(200, 150, 80)).toBe(0);
    expect(quotaRemaining(200, 0, 1190)).toBe(0);
    expect(quotaRemaining(200, 150, 0)).toBe(50);
    expect(quotaRemaining(200, 150, -3)).toBe(50);
    expect(quotaRemaining(200, 150.9, 29.9)).toBe(21);
  });

  it("answers 0 when a number cannot be read", () => {
    expect(quotaRemaining(Number.NaN, 10)).toBe(0);
    expect(quotaRemaining(200, Number.NaN)).toBe(0);
    expect(quotaRemaining(200, 10, Number.NaN)).toBe(0);
    expect(quotaRemaining(Number.POSITIVE_INFINITY, 10)).toBe(0);
  });
});

describe("beyondQuota", () => {
  it("counts the files past the remaining quota", () => {
    expect(beyondQuota(1190, 200)).toBe(990);
    expect(beyondQuota(50, 200)).toBe(0);
    expect(beyondQuota(200, 200)).toBe(0);
    expect(beyondQuota(3, 0)).toBe(3);
    expect(beyondQuota(3, -1)).toBe(3);
    expect(beyondQuota(0, 0)).toBe(0);
    expect(beyondQuota(Number.NaN, 5)).toBe(0);
  });
});

function ids(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `id-${index + 1}`);
}

describe("planRequeue", () => {
  it("takes the first ids up to the remaining quota and says how many wait", () => {
    const plan = planRequeue(ids(980), 150);
    expect(plan.ids).toHaveLength(150);
    expect(plan.ids[0]).toBe("id-1");
    expect(plan.ids[149]).toBe("id-150");
    expect(plan.left).toBe(830);
  });

  it("cuts the update into chunks of 100 ids, in order", () => {
    const plan = planRequeue(ids(250), 250);
    expect(REQUEUE_UPDATE_CHUNK).toBe(100);
    expect(plan.updates.map((chunk) => chunk.length)).toEqual([100, 100, 50]);
    expect(plan.updates[0]?.[0]).toBe("id-1");
    expect(plan.updates[2]?.[49]).toBe("id-250");
    expect(plan.updates.flat()).toEqual(plan.ids);
  });

  it("takes every id when the quota has room for all of them", () => {
    const plan = planRequeue(ids(30), 200);
    expect(plan.ids).toHaveLength(30);
    expect(plan.updates).toEqual([ids(30)]);
    expect(plan.left).toBe(0);
  });

  it("re-queues nothing at the cap, or when the remaining count cannot be read", () => {
    for (const remaining of [0, -3, Number.NaN, Number.NEGATIVE_INFINITY]) {
      const plan = planRequeue(ids(5), remaining);
      expect(plan.ids).toEqual([]);
      expect(plan.updates).toEqual([]);
      expect(plan.left).toBe(5);
    }
  });

  it("drops duplicate ids before counting and rounds a fractional remaining count down", () => {
    const plan = planRequeue(["a", "b", "a", "c"], 2.9);
    expect(plan.ids).toEqual(["a", "b"]);
    expect(plan.left).toBe(1);
  });

  it("plans nothing for an empty list", () => {
    expect(planRequeue([], 10)).toEqual({ ids: [], updates: [], left: 0 });
  });
});

describe("planPokes", () => {
  it("cuts the re-queued ids into pokes of 500 at most", () => {
    expect(REQUEUE_POKE_CHUNK).toBe(500);
    expect(planPokes(ids(1200)).map((chunk) => chunk.length)).toEqual([500, 500, 200]);
    expect(planPokes(ids(500))).toEqual([ids(500)]);
    expect(planPokes([])).toEqual([]);
  });
});
