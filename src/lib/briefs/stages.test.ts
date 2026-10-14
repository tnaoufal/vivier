import { describe, expect, it } from "vitest";

import type { Assessment, AssessmentChallenge, MatchResult } from "@/lib/db/types";

import { ASSESS_BATCH_MAX } from "./assessment";
import { RANK_GROUP_MAX } from "./ranking";
import {
  batchesOf,
  CHALLENGE_BATCH_MAX,
  finalRankGroup,
  groupsOf,
  pendingChallenges,
  pendingCount,
  pendingRanks,
  pendingReads,
  rankable,
} from "./stages";

function assessed(
  decision: Assessment["decision"],
  score: number,
  extra: Partial<Assessment> = {},
): Assessment {
  return { decision, score, summary: "s", requirements: [], model: "m", ...extra };
}

function result(id: string, assessment?: Assessment): MatchResult {
  const base: MatchResult = {
    candidateId: id,
    score: 50,
    coverage: 1,
    blocked: false,
    verdicts: [],
    why: null,
    retrieval: { textRank: null, vectorRank: null },
  };
  return assessment ? { ...base, assessment } : base;
}

const confirmed: AssessmentChallenge = { verdict: "confirmed", reason: null, evidence: null };
const none = new Set<string>();

const results: MatchResult[] = [
  result("u1"),
  result("f1", assessed("fit", 80)),
  result("f2", assessed("fit", 90, { challenge: confirmed })),
  result("b1", assessed("borderline", 60)),
  result("n1", assessed("no_fit", 20)),
  result("u2"),
  result("f3", assessed("fit", 70, { challenge: confirmed, tier: "A" })),
];

describe("pendingReads and pendingChallenges", () => {
  it("name the results no model read, then the retained ones without a second opinion, the settled ones left out", () => {
    expect(pendingReads(results, none)).toEqual(["u1", "u2"]);
    expect(pendingReads(results, new Set(["u1"]))).toEqual(["u2"]);
    expect(pendingChallenges(results, none)).toEqual(["f1"]);
    expect(pendingChallenges(results, new Set(["f1"]))).toEqual([]);
    expect(CHALLENGE_BATCH_MAX).toBe(6);
  });
});

describe("rankable and pendingRanks", () => {
  it("compares the retained and borderline results, best first, those without a tier in groups", () => {
    expect(rankable(results, none).map((entry) => entry.candidateId)).toEqual([
      "f3",
      "f2",
      "f1",
      "b1",
    ]);
    expect(pendingRanks(results, none)).toEqual([["f2", "f1", "b1"]]);
    expect(pendingRanks(results, new Set(["f1"]))).toEqual([["f2", "b1"]]);
  });

  it("sends one untiered result with the best tiered ones, since one alone cannot be compared", () => {
    const tiered: MatchResult[] = [
      result("a", assessed("fit", 90, { tier: "A" })),
      result("b", assessed("borderline", 70, { tier: "B" })),
      result("c", assessed("fit", 80)),
    ];
    expect(pendingRanks(tiered, none)).toEqual([["c", "a", "b"]]);
    const alone = [result("c", assessed("fit", 80)), result("n", assessed("no_fit", 10))];
    expect(pendingRanks(alone, none)).toEqual([]);
    const done = [
      result("a", assessed("fit", 90, { tier: "A" })),
      result("b", assessed("fit", 70, { tier: "B" })),
    ];
    expect(pendingRanks(done, none)).toEqual([]);
    expect(pendingRanks([], none)).toEqual([]);
  });

  it("cuts groups of eight and never leaves one alone at the end", () => {
    const ids = Array.from({ length: 9 }, (_, index) => `c${index}`);
    const groups = groupsOf(ids);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toHaveLength(7);
    expect(groups[1]).toEqual(["c7", "c8"]);
    expect(groupsOf(ids.slice(0, 8))).toEqual([ids.slice(0, 8)]);
    expect(groupsOf(ids.slice(0, 1))).toEqual([]);
    expect(groupsOf([])).toEqual([]);
    const seventeen = groupsOf(Array.from({ length: 17 }, (_, index) => `c${index}`));
    expect(seventeen.map((group) => group.length)).toEqual([8, 7, 2]);
    expect(groupsOf(ids, 3).map((group) => group.length)).toEqual([3, 3, 3]);
    expect(groupsOf(ids.slice(0, 7), 3).map((group) => group.length)).toEqual([3, 2, 2]);
    expect(RANK_GROUP_MAX).toBe(8);
  });
});

describe("finalRankGroup", () => {
  it("compares the A's of every group once, best first, eight at most, never one alone", () => {
    const tiered: MatchResult[] = [
      result("a1", assessed("fit", 90, { tier: "A" })),
      result("b1", assessed("fit", 85, { tier: "B" })),
      result("a2", assessed("fit", 80, { tier: "A" })),
      result("c1", assessed("borderline", 70, { tier: "C" })),
      result("a3", assessed("fit", 95, { tier: "A" })),
      result("u1"),
    ];
    expect(finalRankGroup(tiered, none)).toEqual([["a3", "a1", "a2"]]);
    // A settled candidate is left out; one A alone is nothing to compare.
    expect(finalRankGroup(tiered, new Set(["a1", "a2"]))).toEqual([]);
    expect(finalRankGroup(results, none)).toEqual([]);
    expect(finalRankGroup([], none)).toEqual([]);
    const many = Array.from({ length: 10 }, (_, index) =>
      result(`a${index}`, assessed("fit", 60 + index, { tier: "A" })),
    );
    const group = finalRankGroup(many, none);
    expect(group).toHaveLength(1);
    expect(group[0]).toHaveLength(RANK_GROUP_MAX);
    expect(group[0]?.[0]).toBe("a9");
  });
});

describe("pendingCount and batchesOf", () => {
  it("add up what the three stages still have to send", () => {
    // Two to read, one to challenge, three to rank.
    expect(pendingCount(results, none)).toBe(6);
    expect(pendingCount([], none)).toBe(0);
    expect(batchesOf(["a", "b", "c", "d", "e", "f", "g"], ASSESS_BATCH_MAX)).toEqual([
      ["a", "b", "c", "d", "e", "f"],
      ["g"],
    ]);
    expect(batchesOf([], 6)).toEqual([]);
  });
});
