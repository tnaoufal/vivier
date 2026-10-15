import { describe, expect, it } from "vitest";

import { formatDate } from "@/lib/i18n";

import {
  distinct,
  excerpt,
  groupByDay,
  isMine,
  isPending,
  lots,
  mentionPath,
  mentionsOf,
  mergeMessages,
  resolveTarget,
  summarizeThreads,
  targetColumn,
  targetColumns,
  targetIdsOf,
  targetOf,
  threadKey,
  type TargetNames,
} from "./thread";

/** 14 October 2026, 15:30 local. */
const now = new Date(2026, 9, 14, 15, 30);

/** A local instant of that calendar, as an ISO string. */
function at(day: number, hour: number): string {
  return new Date(2026, 9, day, hour).toISOString();
}

describe("targets", () => {
  it("names the column of each target and builds it back", () => {
    expect(targetColumn({ briefId: "b1" })).toEqual({ column: "brief_id", id: "b1" });
    expect(targetColumn({ candidateId: "c1" })).toEqual({ column: "candidate_id", id: "c1" });
    expect(targetColumn({ shortlistItemId: "i1" })).toEqual({
      column: "shortlist_item_id",
      id: "i1",
    });
    expect(targetOf("brief_id", "b1")).toEqual({ briefId: "b1" });
    expect(targetOf("candidate_id", "c1")).toEqual({ candidateId: "c1" });
    expect(targetOf("shortlist_item_id", "i1")).toEqual({ shortlistItemId: "i1" });
  });

  it("keys a thread by its column and id", () => {
    expect(threadKey({ candidateId: "c1" })).toBe("candidate_id:c1");
  });

  it("fills the one column of a row", () => {
    expect(targetColumns({ briefId: "b1" })).toEqual({
      brief_id: "b1",
      candidate_id: null,
      shortlist_item_id: null,
    });
    expect(targetColumns({ shortlistItemId: "i1" })).toEqual({
      brief_id: null,
      candidate_id: null,
      shortlist_item_id: "i1",
    });
  });
});

describe("lots and distinct", () => {
  it("cuts a list in order, the last lot shorter", () => {
    expect(lots([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(lots([], 2)).toEqual([]);
    expect(lots([1, 2], 0)).toEqual([[1], [2]]);
  });

  it("keeps each value once and drops empty ones", () => {
    expect(distinct(["a", null, "b", "a", undefined, ""])).toEqual(["a", "b"]);
  });
});

describe("isMine and mentionsOf", () => {
  it("knows the caller's messages", () => {
    expect(isMine({ author_id: "u1" }, "u1")).toBe(true);
    expect(isMine({ author_id: "u1" }, "u2")).toBe(false);
    expect(isMine({ author_id: "u1" }, null)).toBe(false);
    expect(isMine({ author_id: "u1" }, "")).toBe(false);
  });

  it("tells a message sent but not read back yet", () => {
    expect(isPending({ id: "pending:3" })).toBe(true);
    expect(isPending({ id: "0f2a6c1e-1b2c-4d3e-8f90-a1b2c3d4e5f6" })).toBe(false);
  });

  it("reads the mentioned members through the shortlist's reader", () => {
    const members = [{ id: "u1", name: "Ana" }];
    expect(mentionsOf("hi @Ana", members)).toEqual(["u1"]);
    expect(mentionsOf("plain", members)).toEqual([]);
  });
});

describe("excerpt", () => {
  it("collapses whitespace and leaves a short body whole", () => {
    expect(excerpt("hello  world\n ok")).toBe("hello world ok");
    expect(excerpt("a".repeat(80))).toBe("a".repeat(80));
  });

  it("cuts at a word and counts the ellipsis in the limit", () => {
    const body = "word ".repeat(30).trim();
    const result = excerpt(body, 80);
    expect(result).toBe(`${"word ".repeat(15).trim()}…`);
    expect(result.length).toBeLessThanOrEqual(80);
  });

  it("cuts inside a word when no space is near enough", () => {
    const noSpace = excerpt("x".repeat(100), 80);
    expect(noSpace).toBe(`${"x".repeat(79)}…`);
    const earlySpace = excerpt(`ab ${"c".repeat(100)}`, 80);
    expect(earlySpace.startsWith("ab c")).toBe(true);
    expect(earlySpace.length).toBe(80);
    expect(earlySpace.endsWith("…")).toBe(true);
  });
});

describe("groupByDay", () => {
  it("groups consecutive messages of one day, oldest first", () => {
    const days = groupByDay(
      [
        { id: 1, created_at: at(2, 10) },
        { id: 2, created_at: at(13, 9) },
        { id: 3, created_at: at(13, 18) },
        { id: 4, created_at: at(14, 10) },
      ],
      "fr",
      now,
    );
    expect(days.map((day) => day.key)).toEqual(["2026-10-02", "2026-10-13", "2026-10-14"]);
    const first = days[0]?.label;
    expect(first).toEqual({ kind: "date", text: formatDate("fr", "2026-10-02T12:00:00") });
    expect(first?.kind === "date" ? first.text : "").toMatch(/2026/);
    expect(days[1]?.label).toEqual({ kind: "yesterday" });
    expect(days[1]?.messages.map((message) => message.id)).toEqual([2, 3]);
    expect(days[2]?.label).toEqual({ kind: "today" });
  });

  it("writes the date for the locale", () => {
    const days = groupByDay([{ created_at: at(2, 10) }], "en", now);
    expect(days[0]?.label).toEqual({ kind: "date", text: formatDate("en", "2026-10-02T12:00:00") });
  });

  it("keeps an unreadable date with the group before it, or alone without a date", () => {
    expect(groupByDay([{ created_at: at(14, 9) }, { created_at: "?" }], "fr", now)).toHaveLength(1);
    const alone = groupByDay([{ created_at: "?" }], "fr", now);
    expect(alone).toHaveLength(1);
    expect(alone[0]?.key).toBe("");
    expect(alone[0]?.label).toEqual({ kind: "date", text: "" });
  });

  it("answers no day for no message", () => {
    expect(groupByDay([], "fr", now)).toEqual([]);
  });
});

describe("mergeMessages", () => {
  const a = { id: "a" };
  const b = { id: "b" };
  const c = { id: "c" };

  it("keeps the read rows and appends the pending ones it does not know", () => {
    const merged = mergeMessages([a, b], [{ id: "b" }, c]);
    expect(merged.map((message) => message.id)).toEqual(["a", "b", "c"]);
    expect(merged[1]).toBe(b);
  });

  it("hides what was removed, read or pending", () => {
    expect(mergeMessages([a, b], [c], new Set(["a"])).map((m) => m.id)).toEqual(["b", "c"]);
    expect(mergeMessages([a, b], [c], new Set(["c"])).map((m) => m.id)).toEqual(["a", "b"]);
    expect(mergeMessages([], [])).toEqual([]);
  });
});

describe("summarizeThreads", () => {
  it("counts per brief and keeps the latest message, whatever the order", () => {
    const map = summarizeThreads([
      {
        brief_id: "b1",
        author_id: "u2",
        body: "second  line\nhere",
        created_at: "2026-10-14T10:00:00Z",
      },
      { brief_id: "b1", author_id: "u1", body: "first", created_at: "2026-10-13T10:00:00Z" },
      { brief_id: "b2", author_id: "u3", body: "x", created_at: "2026-10-01T10:00:00Z" },
      { brief_id: null, author_id: "u3", body: "skip", created_at: "2026-10-01T10:00:00Z" },
    ]);
    expect(map.size).toBe(2);
    expect(map.get("b1")).toEqual({
      count: 2,
      lastAt: "2026-10-14T10:00:00Z",
      lastAuthorId: "u2",
      lastExcerpt: "second line here",
    });
    expect(map.get("b2")).toEqual({
      count: 1,
      lastAt: "2026-10-01T10:00:00Z",
      lastAuthorId: "u3",
      lastExcerpt: "x",
    });
  });

  it("lets the later row win on an equal moment", () => {
    const map = summarizeThreads([
      { brief_id: "b1", author_id: "u1", body: "A", created_at: "2026-10-14T10:00:00Z" },
      { brief_id: "b1", author_id: "u2", body: "B", created_at: "2026-10-14T10:00:00Z" },
    ]);
    expect(map.get("b1")?.lastExcerpt).toBe("B");
    expect(map.get("b1")?.lastAuthorId).toBe("u2");
  });
});

describe("mention targets", () => {
  const names: TargetNames = {
    briefs: new Map([["b1", "Dev"]]),
    candidates: new Map<string, string | null>([
      ["c1", "Ana"],
      ["c2", null],
    ]),
    items: new Map([["i1", { shortlist_id: "s1", candidate_id: "c1" }]]),
  };

  it("lists the distinct ids per kind", () => {
    expect(
      targetIdsOf([
        { brief_id: "b1", candidate_id: null, shortlist_item_id: null },
        { brief_id: "b1", candidate_id: "c1", shortlist_item_id: null },
        { brief_id: null, candidate_id: null, shortlist_item_id: "i1" },
      ]),
    ).toEqual({ briefIds: ["b1"], candidateIds: ["c1"], itemIds: ["i1"] });
  });

  it("names a brief, a candidate and a shortlisted candidate", () => {
    expect(
      resolveTarget({ brief_id: "b1", candidate_id: null, shortlist_item_id: null }, names),
    ).toEqual({
      kind: "brief",
      id: "b1",
      label: "Dev",
    });
    expect(
      resolveTarget({ brief_id: null, candidate_id: "c2", shortlist_item_id: null }, names),
    ).toEqual({
      kind: "candidate",
      id: "c2",
      label: null,
    });
    expect(
      resolveTarget({ brief_id: null, candidate_id: null, shortlist_item_id: "i1" }, names),
    ).toEqual({
      kind: "shortlistItem",
      id: "i1",
      shortlistId: "s1",
      candidateId: "c1",
      label: "Ana",
    });
  });

  it("prefers the most specific column and keeps an unread item's id", () => {
    expect(
      resolveTarget({ brief_id: "b1", candidate_id: "c1", shortlist_item_id: "i1" }, names).kind,
    ).toBe("shortlistItem");
    expect(
      resolveTarget({ brief_id: null, candidate_id: null, shortlist_item_id: "i9" }, names),
    ).toEqual({
      kind: "shortlistItem",
      id: "i9",
      shortlistId: null,
      candidateId: null,
      label: null,
    });
    expect(
      resolveTarget({ brief_id: null, candidate_id: null, shortlist_item_id: null }, names),
    ).toEqual({
      kind: "brief",
      id: "",
      label: null,
    });
  });

  it("leads to the page of the object", () => {
    expect(mentionPath({ kind: "brief", id: "b1", label: "Dev" })).toBe("/app/briefs/b1");
    expect(mentionPath({ kind: "candidate", id: "c1", label: "Ana" })).toBe("/app/candidates/c1");
    expect(
      mentionPath({
        kind: "shortlistItem",
        id: "i1",
        shortlistId: "s1",
        candidateId: "c1",
        label: "Ana",
      }),
    ).toBe("/app/shortlists/s1");
    expect(
      mentionPath({
        kind: "shortlistItem",
        id: "i9",
        shortlistId: null,
        candidateId: null,
        label: null,
      }),
    ).toBeNull();
    expect(mentionPath({ kind: "brief", id: "", label: null })).toBeNull();
  });
});
