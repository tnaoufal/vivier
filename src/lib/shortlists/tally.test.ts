import { describe, expect, it } from "vitest";

import {
  ITEM_STATUSES,
  compareItems,
  countByItem,
  countByStatus,
  decisionsFrom,
  groupByStatus,
  isItemStatus,
} from "./tally";

describe("statuses", () => {
  it("knows the three statuses and nothing else", () => {
    expect(ITEM_STATUSES).toEqual(["to_review", "retained", "dismissed"]);
    expect(isItemStatus("retained")).toBe(true);
    expect(isItemStatus("weird")).toBe(false);
    expect(isItemStatus(null)).toBe(false);
  });

  it("offers the two decisions that apply, the main one first, never the current status", () => {
    expect(decisionsFrom("to_review")).toEqual(["retained", "dismissed"]);
    expect(decisionsFrom("retained")).toEqual(["dismissed", "to_review"]);
    expect(decisionsFrom("dismissed")).toEqual(["retained", "to_review"]);
    for (const status of ITEM_STATUSES) {
      expect(decisionsFrom(status)).toHaveLength(2);
      expect(decisionsFrom(status)).not.toContain(status);
    }
  });
});

describe("countByItem", () => {
  it("counts the thread's messages per item and skips rows without one", () => {
    const counts = countByItem([
      { shortlist_item_id: "i1" },
      { shortlist_item_id: "i1" },
      { shortlist_item_id: null },
      { shortlist_item_id: "i2" },
    ]);
    expect(counts.get("i1")).toBe(2);
    expect(counts.get("i2")).toBe(1);
    expect(counts.size).toBe(2);
  });
});

describe("groupByStatus", () => {
  const items = [
    { id: "d", status: "dismissed", position: 0, created_at: "2026-10-01T10:00:00Z" },
    { id: "b", status: "to_review", position: 2, created_at: "2026-10-01T09:00:00Z" },
    { id: "a", status: "to_review", position: 1, created_at: "2026-10-01T11:00:00Z" },
    { id: "c", status: "to_review", position: 2, created_at: "2026-10-01T08:00:00Z" },
    { id: "r", status: "retained", position: 0, created_at: "2026-10-01T10:00:00Z" },
    { id: "x", status: "weird", position: 0, created_at: "2026-10-01T10:00:00Z" },
  ];

  it("splits by status and orders by position then creation", () => {
    const groups = groupByStatus(items);
    expect(groups.to_review.map((i) => i.id)).toEqual(["a", "c", "b"]);
    expect(groups.retained.map((i) => i.id)).toEqual(["r"]);
    expect(groups.dismissed.map((i) => i.id)).toEqual(["d"]);
  });

  it("compares two items in a stable way", () => {
    const first = { position: 1, created_at: "2026-10-01T10:00:00Z" };
    const same = { position: 1, created_at: "2026-10-01T10:00:00Z" };
    expect(compareItems(first, same)).toBe(0);
    expect(compareItems(first, { position: 0, created_at: "2026-10-02T10:00:00Z" })).toBe(1);
    expect(compareItems(first, { position: 1, created_at: "2026-10-02T10:00:00Z" })).toBe(-1);
  });

  it("counts statuses and leaves the unknown out", () => {
    expect(countByStatus(items)).toEqual({ to_review: 3, retained: 1, dismissed: 1 });
    expect(countByStatus([])).toEqual({ to_review: 0, retained: 0, dismissed: 0 });
  });
});
