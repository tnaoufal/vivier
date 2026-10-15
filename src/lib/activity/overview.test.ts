import { describe, expect, it } from "vitest";

import {
  analysisGlanceOf,
  lastActivityOf,
  retainedByShortlist,
  sortByActivity,
  type AnalysisFacts,
} from "./overview";

function triage(partial: Partial<AnalysisFacts>): AnalysisFacts {
  return { method: "triage", total: 40, assessed: 40, matches: 12, ...partial };
}

describe("analysisGlanceOf", () => {
  it("says nothing ran without an analysis", () => {
    expect(analysisGlanceOf(null)).toEqual({ kind: "none" });
    expect(analysisGlanceOf(undefined)).toEqual({ kind: "none" });
  });

  it("keeps a whole-pool analysis unfinished while its results are not all read", () => {
    expect(analysisGlanceOf(triage({ assessed: 10 }))).toEqual({ kind: "unfinished" });
    expect(analysisGlanceOf(triage({ total: 0, assessed: 0 }))).toEqual({ kind: "unfinished" });
  });

  it("counts the matches of a whole-pool analysis once something was read and the triage is unknown", () => {
    expect(analysisGlanceOf(triage({}))).toEqual({ kind: "matches", count: 12 });
  });

  it("reads the triage's progress when it is known", () => {
    expect(analysisGlanceOf(triage({ triagePending: 3, kept: 40 }))).toEqual({
      kind: "unfinished",
    });
    expect(analysisGlanceOf(triage({ triagePending: 0, kept: 45 }))).toEqual({
      kind: "unfinished",
    });
    expect(analysisGlanceOf(triage({ triagePending: 0, kept: 40 }))).toEqual({
      kind: "matches",
      count: 12,
    });
    // A triage that kept nobody is a finished analysis with nothing in it, not an unfinished one.
    expect(
      analysisGlanceOf(triage({ total: 0, assessed: 0, matches: 0, triagePending: 0, kept: 0 })),
    ).toEqual({ kind: "matches", count: 0 });
  });

  it("counts the matches of a retrieval once something was read", () => {
    expect(analysisGlanceOf({ method: "hybrid", total: 120, assessed: 30, matches: 7 })).toEqual({
      kind: "matches",
      count: 7,
    });
  });

  it("says a text-only analysis ranked its results, and 0 matches when it found nothing", () => {
    expect(analysisGlanceOf({ method: "text", total: 25, assessed: 0, matches: 0 })).toEqual({
      kind: "ranked",
      count: 25,
    });
    expect(analysisGlanceOf({ method: "text", total: 0, assessed: 0, matches: 0 })).toEqual({
      kind: "matches",
      count: 0,
    });
  });
});

describe("retainedByShortlist", () => {
  it("counts the retained items of each shortlist", () => {
    const counts = retainedByShortlist([
      { shortlist_id: "s1", status: "retained" },
      { shortlist_id: "s1", status: "to_review" },
      { shortlist_id: "s1", status: "retained" },
      { shortlist_id: "s2", status: "dismissed" },
    ]);
    expect(counts.get("s1")).toBe(2);
    expect(counts.get("s2")).toBe(0);
    expect(counts.has("s3")).toBe(false);
  });

  it("answers an empty map for no item", () => {
    expect(retainedByShortlist([]).size).toBe(0);
  });
});

describe("lastActivityOf", () => {
  it("picks the newest of the update, the analysis and the thread", () => {
    expect(
      lastActivityOf({
        updatedAt: "2026-10-01T10:00:00Z",
        analysedAt: "2026-10-03T10:00:00Z",
        threadAt: "2026-10-02T10:00:00Z",
      }),
    ).toBe("2026-10-03T10:00:00Z");
    expect(
      lastActivityOf({
        updatedAt: "2026-10-01T10:00:00Z",
        analysedAt: null,
        threadAt: "2026-10-05T10:00:00Z",
      }),
    ).toBe("2026-10-05T10:00:00Z");
  });

  it("falls back to the update when the rest is missing or unreadable", () => {
    expect(
      lastActivityOf({ updatedAt: "2026-10-01T10:00:00Z", analysedAt: null, threadAt: null }),
    ).toBe("2026-10-01T10:00:00Z");
    expect(
      lastActivityOf({ updatedAt: "2026-10-01T10:00:00Z", analysedAt: "?", threadAt: null }),
    ).toBe("2026-10-01T10:00:00Z");
    expect(
      lastActivityOf({ updatedAt: "?", analysedAt: "2026-10-01T10:00:00Z", threadAt: null }),
    ).toBe("2026-10-01T10:00:00Z");
  });
});

describe("sortByActivity", () => {
  it("puts the most recently active first and keeps the order of ties", () => {
    const rows = [
      { id: "a", lastActivityAt: "2026-10-01T10:00:00Z" },
      { id: "b", lastActivityAt: "2026-10-03T10:00:00Z" },
      { id: "c", lastActivityAt: "2026-10-03T10:00:00Z" },
      { id: "d", lastActivityAt: "not a date" },
    ];
    expect(sortByActivity(rows).map((row) => row.id)).toEqual(["b", "c", "a", "d"]);
  });

  it("leaves the rows given untouched", () => {
    const rows = [
      { id: "a", lastActivityAt: "2026-10-01T10:00:00Z" },
      { id: "b", lastActivityAt: "2026-10-02T10:00:00Z" },
    ];
    sortByActivity(rows);
    expect(rows.map((row) => row.id)).toEqual(["a", "b"]);
  });
});
