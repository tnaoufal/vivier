import { describe, expect, it } from "vitest";

import type { ShortlistItemStatus } from "@/lib/db/types";

import { unsettledDecisions, withShownDecisions, type ShownDecision } from "./shown-decisions";

const AT = "2026-10-15T10:52:00Z";

function shown(status: ShortlistItemStatus, write: number | null = null): ShownDecision {
  return { status, by: "me", at: AT, write };
}

function read(after: number, ...items: [string, ShortlistItemStatus][]) {
  return { after, items: items.map(([id, status]) => ({ id, status })) };
}

describe("a decision shown before the read", () => {
  it("stays while its write is sent and a read still says the old status", () => {
    const decisions = new Map([["a", shown("retained")]]);
    expect(unsettledDecisions(decisions, read(0, ["a", "to_review"])).get("a")?.status).toBe(
      "retained",
    );
  });

  it("gives way to a read that shows it, sent or stored", () => {
    const decisions = new Map([
      ["a", shown("retained")],
      ["b", shown("dismissed", 1)],
    ]);
    const left = unsettledDecisions(decisions, read(0, ["a", "retained"], ["b", "dismissed"]));
    expect(left.size).toBe(0);
  });

  it("stays over a read that started before its write was stored", () => {
    const decisions = new Map([["a", shown("retained", 2)]]);
    expect(unsettledDecisions(decisions, read(1, ["a", "to_review"])).has("a")).toBe(true);
  });

  it("gives way to a read started once it was stored, whatever that read says", () => {
    // A colleague dismissed the profile after the write: the read is the truth.
    const decisions = new Map([["a", shown("retained", 2)]]);
    expect(unsettledDecisions(decisions, read(2, ["a", "dismissed"])).has("a")).toBe(false);
    expect(unsettledDecisions(decisions, read(3, ["a", "dismissed"])).has("a")).toBe(false);
  });

  it("answers the same map when nothing gave way, and an empty one as is", () => {
    const decisions = new Map([["a", shown("retained")]]);
    expect(unsettledDecisions(decisions, read(5, ["a", "to_review"]))).toBe(decisions);
    const none = new Map<string, ShownDecision>();
    expect(unsettledDecisions(none, read(0, ["a", "to_review"]))).toBe(none);
  });
});

describe("the items as the rows show them", () => {
  const items = [
    {
      id: "a",
      status: "dismissed" as const,
      decided_by: "sara",
      decided_at: "2026-10-14T09:00:00Z",
    },
    { id: "b", status: "to_review" as const, decided_by: null, decided_at: null },
  ];

  it("say the decision shown with who took it and when, never the previous decider", () => {
    const rows = withShownDecisions(items, new Map([["a", shown("retained")]]));
    expect(rows[0]).toEqual({ id: "a", status: "retained", decided_by: "me", decided_at: AT });
    expect(rows[1]).toBe(items[1]);
  });

  it("stay as read when nothing is shown, or when the read already says it", () => {
    expect(withShownDecisions(items, new Map())).toBe(items);
    const rows = withShownDecisions(items, new Map([["a", shown("dismissed")]]));
    expect(rows[0]).toBe(items[0]);
  });
});
