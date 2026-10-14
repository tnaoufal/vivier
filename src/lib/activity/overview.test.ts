import { describe, expect, it } from "vitest";

import { countByShortlist, countItems, isProposed, latestPerBrief } from "./overview";

describe("latestPerBrief", () => {
  it("keeps the newest search of each brief whatever the order", () => {
    const latest = latestPerBrief([
      { brief_id: "a", match_count: 10, created_at: "2026-10-01T10:00:00Z" },
      { brief_id: "a", match_count: 42, created_at: "2026-10-03T10:00:00Z" },
      { brief_id: "b", match_count: 7, created_at: "2026-10-02T10:00:00Z" },
      { brief_id: "a", match_count: 20, created_at: "2026-10-02T10:00:00Z" },
    ]);
    expect(latest.get("a")?.match_count).toBe(42);
    expect(latest.get("b")?.match_count).toBe(7);
    expect(latest.size).toBe(2);
  });

  it("ignores a search without a brief", () => {
    expect(latestPerBrief([{ brief_id: null, match_count: 1, created_at: "2026-10-01T10:00:00Z" }]).size).toBe(0);
  });
});

describe("isProposed", () => {
  it("is a fit with tier A or no tier yet", () => {
    expect(isProposed({ decision: "fit", tier: "A" })).toBe(true);
    expect(isProposed({ decision: "fit", tier: null })).toBe(true);
    expect(isProposed({ decision: "fit", tier: "B" })).toBe(false);
    expect(isProposed({ decision: "borderline", tier: "A" })).toBe(false);
    expect(isProposed({ decision: null, tier: null })).toBe(false);
  });
});

describe("countItems", () => {
  it("counts the team's statuses and the model's proposals apart", () => {
    const counts = countItems([
      { status: "to_review", decision: "fit", tier: "A" },
      { status: "retained", decision: "fit", tier: null },
      { status: "dismissed", decision: "fit", tier: "A" },
      { status: "to_review", decision: "borderline", tier: "B" },
      { status: "retained", decision: null, tier: null },
    ]);
    expect(counts).toEqual({ present: 2, retained: 2, toReview: 2, total: 5 });
  });

  it("answers zeros for an empty shortlist", () => {
    expect(countItems([])).toEqual({ present: 0, retained: 0, toReview: 0, total: 0 });
  });
});

describe("countByShortlist", () => {
  it("groups the items by shortlist", () => {
    const counts = countByShortlist([
      { shortlist_id: "s1", status: "retained", decision: "fit", tier: "A" },
      { shortlist_id: "s2", status: "to_review", decision: "no_fit", tier: null },
      { shortlist_id: "s1", status: "to_review", decision: "fit", tier: "C" },
    ]);
    expect(counts.get("s1")).toEqual({ present: 1, retained: 1, toReview: 1, total: 2 });
    expect(counts.get("s2")).toEqual({ present: 0, retained: 0, toReview: 1, total: 1 });
    expect(counts.has("s3")).toBe(false);
  });
});
