import { describe, expect, it } from "vitest";

import {
  SHORTLIST_FILTERS,
  decisionLineOf,
  decisionTraceOf,
  filterItems,
  isShortlistFilter,
} from "./decision-line";

describe("the filter", () => {
  const items = [
    { id: "a", status: "to_review" },
    { id: "b", status: "retained" },
    { id: "c", status: "dismissed" },
    { id: "d", status: "retained" },
  ];

  it("knows the four filters", () => {
    expect(SHORTLIST_FILTERS).toEqual(["all", "to_review", "retained", "dismissed"]);
    expect(isShortlistFilter("all")).toBe(true);
    expect(isShortlistFilter("retained")).toBe(true);
    expect(isShortlistFilter("weird")).toBe(false);
  });

  it("keeps every row for all, else the rows of one status, in order", () => {
    expect(filterItems(items, "all").map((item) => item.id)).toEqual(["a", "b", "c", "d"]);
    expect(filterItems(items, "retained").map((item) => item.id)).toEqual(["b", "d"]);
    expect(filterItems(items, "to_review").map((item) => item.id)).toEqual(["a"]);
  });
});

describe("decisionLineOf", () => {
  it("names who retains or dismisses, with the moment", () => {
    expect(
      decisionLineOf({ status: "retained", decided_by: "u1", decided_at: "2026-10-15T10:52:00Z" }),
    ).toEqual({ kind: "retained", by: "u1", at: "2026-10-15T10:52:00Z" });
    expect(
      decisionLineOf({ status: "dismissed", decided_by: null, decided_at: "2026-10-15T10:52:00Z" }),
    ).toEqual({ kind: "dismissed", by: null, at: "2026-10-15T10:52:00Z" });
  });

  it("says a profile is to examine whatever an earlier decision stamped", () => {
    expect(
      decisionLineOf({ status: "to_review", decided_by: "u1", decided_at: "2026-10-15T10:52:00Z" }),
    ).toEqual({ kind: "toReview" });
    expect(decisionLineOf({ status: "to_review", decided_by: null, decided_at: null })).toEqual({
      kind: "toReview",
    });
  });
});

describe("decisionTraceOf", () => {
  const base = { added_by: "u0", created_at: "2026-10-14T09:00:00Z" };

  it("traces the decision taken, who and when", () => {
    expect(
      decisionTraceOf({
        ...base,
        status: "retained",
        decided_by: "u1",
        decided_at: "2026-10-15T10:52:00Z",
      }),
    ).toEqual({ kind: "retained", by: "u1", at: "2026-10-15T10:52:00Z" });
  });

  it("traces a profile put back under review", () => {
    expect(
      decisionTraceOf({
        ...base,
        status: "to_review",
        decided_by: "u2",
        decided_at: "2026-10-15T11:00:00Z",
      }),
    ).toEqual({ kind: "reviewed", by: "u2", at: "2026-10-15T11:00:00Z" });
  });

  it("falls back on who added the profile and when", () => {
    expect(
      decisionTraceOf({ ...base, status: "to_review", decided_by: null, decided_at: null }),
    ).toEqual({ kind: "added", by: "u0", at: "2026-10-14T09:00:00Z" });
  });
});
