import { describe, expect, it } from "vitest";

import {
  BRIEF_GROUPS,
  durationParts,
  groupCountsOf,
  groupOfSearch,
  isBriefGroup,
  runDurationMs,
  selectionOf,
  subjectIds,
} from "./groups";

describe("the groups", () => {
  it("knows the four groups and nothing else", () => {
    expect(BRIEF_GROUPS).toEqual(["matches", "near", "shortlist", "aside"]);
    expect(isBriefGroup("near")).toBe(true);
    expect(isBriefGroup("tab")).toBe(false);
    expect(isBriefGroup(undefined)).toBe(false);
  });

  it("reads the group a URL names, the old tab as a fallback, the matches by default", () => {
    expect(groupOfSearch({ g: "aside" })).toBe("aside");
    expect(groupOfSearch({ g: "aside", tab: "shortlist" })).toBe("aside");
    expect(groupOfSearch({ tab: "shortlist" })).toBe("shortlist");
    expect(groupOfSearch({ tab: "matches" })).toBe("matches");
    expect(groupOfSearch({ g: "weird" })).toBe("matches");
    expect(groupOfSearch({})).toBe("matches");
  });
});

describe("groupCountsOf", () => {
  it("counts the screened profiles with the near ones and the pending additions with the shortlist, once each", () => {
    expect(
      groupCountsOf({
        matches: 12,
        near: 4,
        screened: 5,
        shortlisted: ["a", "b"],
        pending: ["b", "c"],
        setAside: 1069,
      }),
    ).toEqual({ matches: 12, near: 9, shortlist: 3, aside: 1069 });
  });

  it("never counts below zero and needs no pending list", () => {
    expect(
      groupCountsOf({ matches: -1, near: Number.NaN, screened: 0, shortlisted: [], setAside: 0 }),
    ).toEqual({ matches: 0, near: 0, shortlist: 0, aside: 0 });
  });
});

describe("selectionOf", () => {
  const ids = ["c1", "c2", "c3"];

  it("keeps the row the URL names", () => {
    expect(selectionOf(ids, "c2")).toEqual({ index: 1, id: "c2", stale: false });
  });

  it("selects the first row when the URL names none, or one not in the list, and says the URL is stale", () => {
    expect(selectionOf(ids, undefined)).toEqual({ index: 0, id: "c1", stale: true });
    expect(selectionOf(ids, "c9")).toEqual({ index: 0, id: "c1", stale: true });
  });

  it("selects nothing in an empty list, whatever the URL says", () => {
    expect(selectionOf([], "c1")).toEqual({ index: -1, id: null, stale: false });
  });

  it("lists the ids of the rows in order", () => {
    expect(subjectIds([{ candidateId: "b" }, { candidateId: "a" }])).toEqual(["b", "a"]);
  });
});

describe("the duration of a run", () => {
  it("measures from the start to the end, and nothing without both", () => {
    expect(runDurationMs("2026-10-15T10:00:00Z", "2026-10-15T10:04:00Z")).toBe(240_000);
    expect(runDurationMs(null, "2026-10-15T10:04:00Z")).toBeNull();
    expect(runDurationMs("2026-10-15T10:00:00Z", null)).toBeNull();
    expect(runDurationMs("not a date", "2026-10-15T10:04:00Z")).toBeNull();
    expect(runDurationMs("2026-10-15T10:04:00Z", "2026-10-15T10:00:00Z")).toBeNull();
  });

  it("says the seconds under a minute, the minutes under an hour, then hours and minutes", () => {
    expect(durationParts(42_000)).toEqual({ unit: "seconds", count: 42 });
    expect(durationParts(240_000)).toEqual({ unit: "minutes", count: 4 });
    expect(durationParts(241_000)).toEqual({ unit: "minutes", count: 5 });
    expect(durationParts(3_900_000)).toEqual({ unit: "hours", count: 1, minutes: 5 });
    expect(durationParts(Number.NaN)).toEqual({ unit: "seconds", count: 0 });
  });
});
