import { describe, expect, it } from "vitest";

import type { MatchResult } from "@/lib/db/types";

import {
  assigneesByShortlist,
  compareItems,
  countByItem,
  countByShortlist,
  countByStatus,
  coveragePercent,
  groupByStatus,
  scorePercent,
  tallyVotes,
  totalOf,
  verdictCounts,
  votesByItem,
} from "./tally";

describe("tallyVotes", () => {
  it("counts up and down and marks the caller's vote", () => {
    const votes = [
      { user_id: "a", value: 1 as const },
      { user_id: "b", value: 1 as const },
      { user_id: "c", value: -1 as const },
    ];
    expect(tallyVotes(votes, "c")).toEqual({ up: 2, down: 1, mine: -1 });
    expect(tallyVotes(votes, "a")).toEqual({ up: 2, down: 1, mine: 1 });
    expect(tallyVotes(votes, "zzz")).toEqual({ up: 2, down: 1, mine: null });
    expect(tallyVotes(votes, null)).toEqual({ up: 2, down: 1, mine: null });
  });

  it("ignores a value the database would never store", () => {
    const votes = [{ user_id: "a", value: 3 as unknown as 1 }];
    expect(tallyVotes(votes, "a")).toEqual({ up: 0, down: 0, mine: null });
  });

  it("groups votes by item", () => {
    const grouped = votesByItem([
      { shortlist_item_id: "i1", user_id: "a" },
      { shortlist_item_id: "i2", user_id: "a" },
      { shortlist_item_id: "i1", user_id: "b" },
    ]);
    expect(grouped.get("i1")?.map((v) => v.user_id)).toEqual(["a", "b"]);
    expect(grouped.get("i2")?.length).toBe(1);
    expect(grouped.get("i3")).toBeUndefined();
  });
});

describe("countByItem", () => {
  it("counts comments per item and skips rows without one", () => {
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

const match: MatchResult = {
  candidateId: "c1",
  score: 72.4,
  coverage: 0.8,
  blocked: false,
  verdicts: [
    { criterionId: "k1", verdict: "match", evidence: "React since 2019" },
    { criterionId: "k2", verdict: "match", evidence: null },
    { criterionId: "k3", verdict: "partial", evidence: "B2 English" },
    { criterionId: "k4", verdict: "missing", evidence: null },
    { criterionId: "k5", verdict: "not_stated", evidence: null },
  ],
  why: null,
  retrieval: { textRank: 1, vectorRank: null },
};

describe("verdictCounts", () => {
  it("counts each verdict", () => {
    expect(verdictCounts(match)).toEqual({ match: 2, partial: 1, missing: 1, not_stated: 1 });
  });

  it("answers null without a match and ignores verdicts it does not know", () => {
    expect(verdictCounts(null)).toBeNull();
    expect(verdictCounts(undefined)).toBeNull();
    const odd = { verdicts: [{ criterionId: "x", verdict: "maybe", evidence: null }] } as unknown as MatchResult;
    expect(verdictCounts(odd)).toEqual({ match: 0, partial: 0, missing: 0, not_stated: 0 });
  });
});

describe("percentages", () => {
  it("round the score and the coverage, clamped", () => {
    expect(scorePercent(match)).toBe(72);
    expect(coveragePercent(match)).toBe(80);
    expect(scorePercent({ score: 140 })).toBe(100);
    expect(coveragePercent({ coverage: -1 })).toBe(0);
  });

  it("answer null when there is nothing to show", () => {
    expect(scorePercent(null)).toBeNull();
    expect(scorePercent({ score: Number.NaN })).toBeNull();
    expect(coveragePercent(undefined)).toBeNull();
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
  });

  it("counts statuses and leaves the unknown out", () => {
    const counts = countByStatus(items);
    expect(counts).toEqual({ to_review: 3, retained: 1, dismissed: 1 });
    expect(totalOf(counts)).toBe(5);
  });
});

describe("list page helpers", () => {
  const rows = [
    { shortlist_id: "s1", status: "to_review", assigned_to: "u1" },
    { shortlist_id: "s1", status: "retained", assigned_to: "u1" },
    { shortlist_id: "s1", status: "to_review", assigned_to: null },
    { shortlist_id: "s2", status: "dismissed", assigned_to: "u2" },
    { shortlist_id: "s2", status: "dismissed", assigned_to: "u3" },
  ];

  it("counts per shortlist", () => {
    const counts = countByShortlist(rows);
    expect(counts.get("s1")).toEqual({ to_review: 2, retained: 1, dismissed: 0 });
    expect(counts.get("s2")).toEqual({ to_review: 0, retained: 0, dismissed: 2 });
    expect(counts.get("s3")).toBeUndefined();
  });

  it("lists distinct assignees per shortlist", () => {
    const assignees = assigneesByShortlist(rows);
    expect(assignees.get("s1")).toEqual(["u1"]);
    expect(assignees.get("s2")).toEqual(["u2", "u3"]);
  });
});
