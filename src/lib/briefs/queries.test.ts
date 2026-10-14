import { describe, expect, it } from "vitest";

import { analysisOfSummary, SEARCH_SUMMARY_COLUMNS } from "./queries";

describe("SEARCH_SUMMARY_COLUMNS", () => {
  it("names the summary columns a list reads, never the results", () => {
    const columns = SEARCH_SUMMARY_COLUMNS.split(",").map((column) => column.trim());
    for (const column of [
      "id",
      "created_at",
      "method",
      "pool_size",
      "result_count",
      "assessed_count",
      "match_count",
      "near_count",
    ])
      expect(columns).toContain(column);
    expect(columns).not.toContain("results");
    expect(columns).not.toContain("*");
  });
});

describe("analysisOfSummary", () => {
  it("reads an analysis off the summary columns of a row", () => {
    expect(
      analysisOfSummary({
        id: "s1",
        brief_id: "b1",
        created_at: "2026-10-14T09:00:00Z",
        method: "triage",
        pool_size: 1091,
        result_count: 140,
        assessed_count: 96,
        match_count: 12,
        near_count: 9,
        results: "never read",
      }),
    ).toEqual({
      briefId: "b1",
      analysis: {
        searchId: "s1",
        createdAt: "2026-10-14T09:00:00Z",
        method: "triage",
        poolSize: 1091,
        total: 140,
        assessed: 96,
        matches: 12,
        near: 9,
        present: 12,
      },
    });
  });

  it("reads a missing count as 0, a missing pool size as null and an unknown method as text", () => {
    const read = analysisOfSummary({
      id: "s2",
      brief_id: "b2",
      created_at: "2026-10-14T09:00:00Z",
      method: "other",
      result_count: -3,
      match_count: Number.NaN,
    });
    expect(read?.analysis).toEqual({
      searchId: "s2",
      createdAt: "2026-10-14T09:00:00Z",
      method: "text",
      poolSize: null,
      total: 0,
      assessed: 0,
      matches: 0,
      near: 0,
      present: 0,
    });
  });

  it("answers null for a row without its id, its brief or its date", () => {
    expect(analysisOfSummary({ brief_id: "b", created_at: "2026-10-14" })).toBeNull();
    expect(analysisOfSummary({ id: "s", created_at: "2026-10-14" })).toBeNull();
    expect(analysisOfSummary({ id: "s", brief_id: null, created_at: "2026-10-14" })).toBeNull();
    expect(analysisOfSummary({ id: "s", brief_id: "b" })).toBeNull();
  });
});
