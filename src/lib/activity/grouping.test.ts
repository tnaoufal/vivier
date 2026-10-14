import { describe, expect, it } from "vitest";

import { dayKey, groupByDay, labelOfDay, splitActor } from "./grouping";

/** 14 October 2026, 15:30 local. */
const now = new Date(2026, 9, 14, 15, 30);

/** A local instant of that calendar, as an ISO string. */
function at(day: number, hour: number): string {
  return new Date(2026, 9, day, hour).toISOString();
}

describe("dayKey", () => {
  it("writes the local calendar day", () => {
    expect(dayKey(at(14, 9))).toBe("2026-10-14");
    expect(dayKey(at(3, 23))).toBe("2026-10-03");
  });

  it("answers the empty key for an unreadable date", () => {
    expect(dayKey("not a date")).toBe("");
  });
});

describe("labelOfDay", () => {
  it("names today and yesterday, then dates", () => {
    expect(labelOfDay("2026-10-14", now)).toEqual({ kind: "today" });
    expect(labelOfDay("2026-10-13", now)).toEqual({ kind: "yesterday" });
    expect(labelOfDay("2026-10-01", now)).toEqual({ kind: "date", iso: "2026-10-01" });
  });

  it("crosses a month boundary for yesterday", () => {
    const firstOfMonth = new Date(2026, 10, 1, 8);
    expect(labelOfDay("2026-10-31", firstOfMonth)).toEqual({ kind: "yesterday" });
  });
});

describe("groupByDay", () => {
  it("groups consecutive rows of one day, newest first", () => {
    const groups = groupByDay(
      [
        { id: 1, created_at: at(14, 14) },
        { id: 2, created_at: at(14, 9) },
        { id: 3, created_at: at(13, 18) },
        { id: 4, created_at: at(2, 10) },
      ],
      now,
    );
    expect(groups.map((group) => group.key)).toEqual(["2026-10-14", "2026-10-13", "2026-10-02"]);
    expect(groups[0]?.rows.map((row) => row.id)).toEqual([1, 2]);
    expect(groups[0]?.label).toEqual({ kind: "today" });
    expect(groups[1]?.label).toEqual({ kind: "yesterday" });
    expect(groups[2]?.label).toEqual({ kind: "date", iso: "2026-10-02" });
  });

  it("keeps an unreadable date with the group before it", () => {
    const groups = groupByDay([{ created_at: at(14, 9) }, { created_at: "?" }], now);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.rows).toHaveLength(2);
  });

  it("answers no group for no row", () => {
    expect(groupByDay([], now)).toEqual([]);
  });
});

describe("splitActor", () => {
  it("separates the actor's name from the rest of the sentence", () => {
    expect(splitActor("Ana Lu a retenu Jean Dupont.", "Ana Lu")).toEqual(["Ana Lu", " a retenu Jean Dupont."]);
  });

  it("leaves a sentence whole when it does not start with the name", () => {
    expect(splitActor("cv.pdf a été traité.", "Ana Lu")).toEqual(["", "cv.pdf a été traité."]);
    expect(splitActor("cv.pdf a été traité.", null)).toEqual(["", "cv.pdf a été traité."]);
    expect(splitActor("Ana", "")).toEqual(["", "Ana"]);
  });
});
