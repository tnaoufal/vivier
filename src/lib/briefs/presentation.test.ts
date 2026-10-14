import { describe, expect, it } from "vitest";

import type { Assessment, BriefRow, MatchResult, RoleProfile } from "@/lib/db/types";

import {
  arrivalIndexes,
  BRIEF_FILTERS,
  briefSubtitle,
  countByFilter,
  digestResults,
  filterBriefs,
  firstLine,
  isBriefFilter,
  latestPerBrief,
} from "./presentation";

function profile(domain: string): RoleProfile {
  return {
    title: "Contrôleur de gestion",
    domain,
    seniority: "senior",
    yearsMin: null,
    yearsMax: null,
    missions: [],
    equivalentTitles: [],
    adjacentProfiles: [],
    context: { sector: null, product: null, clients: null, scope: null },
    mustHaves: [],
    niceToHaves: [],
    successFactors: [],
    questions: [],
    assumptions: [],
    model: null,
    createdAt: "2026-10-01T00:00:00Z",
  };
}

function brief(status: BriefRow["status"], id: string): Pick<BriefRow, "id" | "status"> {
  return { id, status };
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

function assessed(decision: Assessment["decision"], extra: Partial<Assessment> = {}): Assessment {
  return { decision, score: 80, summary: "s", requirements: [], model: "m", ...extra };
}

describe("firstLine", () => {
  it("answers the first line that says something, trimmed", () => {
    expect(firstLine("\n   \n  Un poste à Lyon  \nsuite")).toBe("Un poste à Lyon");
  });

  it("answers nothing for a blank or missing text", () => {
    expect(firstLine("  \n\n")).toBe("");
    expect(firstLine(null)).toBe("");
    expect(firstLine(undefined)).toBe("");
  });
});

describe("briefSubtitle", () => {
  it("prefers the domain of the role profile", () => {
    expect(
      briefSubtitle({
        description: "Un contrôleur de gestion",
        role_profile: profile("finance d'entreprise"),
      }),
    ).toBe("finance d'entreprise");
  });

  it("falls back to the first line of the need when the profile has no domain", () => {
    expect(
      briefSubtitle({ description: "\nUn contrôleur\nsenior", role_profile: profile("  ") }),
    ).toBe("Un contrôleur");
    expect(briefSubtitle({ description: "Un contrôleur", role_profile: null })).toBe(
      "Un contrôleur",
    );
  });

  it("answers nothing when the brief states neither", () => {
    expect(briefSubtitle({ description: "", role_profile: null })).toBe("");
  });
});

describe("the status filter", () => {
  const rows = [brief("open", "a"), brief("draft", "b"), brief("open", "c"), brief("closed", "d")];

  it("knows its four values and nothing else", () => {
    expect(BRIEF_FILTERS).toEqual(["all", "open", "draft", "closed"]);
    expect(isBriefFilter("open")).toBe(true);
    expect(isBriefFilter("all")).toBe(true);
    expect(isBriefFilter("archived")).toBe(false);
    expect(isBriefFilter(3)).toBe(false);
  });

  it("keeps the rows of one status in their order, or every row", () => {
    expect(filterBriefs(rows, "open").map((row) => row.id)).toEqual(["a", "c"]);
    expect(filterBriefs(rows, "closed").map((row) => row.id)).toEqual(["d"]);
    expect(filterBriefs(rows, "all").map((row) => row.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("counts what each filter would show", () => {
    expect(countByFilter(rows)).toEqual({ all: 4, open: 2, draft: 1, closed: 1 });
    expect(countByFilter([])).toEqual({ all: 0, open: 0, draft: 0, closed: 0 });
  });
});

describe("latestPerBrief", () => {
  it("keeps the newest row of each brief whatever the order, and skips rows without a brief", () => {
    const rows = [
      { id: "s1", brief_id: "b1", created_at: "2026-10-01T10:00:00Z" },
      { id: "s2", brief_id: "b1", created_at: "2026-10-03T10:00:00Z" },
      { id: "s3", brief_id: "b2", created_at: "2026-10-02T10:00:00Z" },
      { id: "s4", brief_id: "b1", created_at: "2026-10-02T10:00:00Z" },
      { id: "s5", brief_id: null, created_at: "2026-10-09T10:00:00Z" },
    ];
    const latest = latestPerBrief(rows);
    expect([...latest.keys()].sort()).toEqual(["b1", "b2"]);
    expect(latest.get("b1")?.id).toBe("s2");
    expect(latest.get("b2")?.id).toBe("s3");
  });
});

describe("digestResults", () => {
  it("counts the results, the ones the model read and the ones to present", () => {
    const digest = digestResults([
      result("a", assessed("fit", { tier: "A" })),
      result("b", assessed("fit")),
      result("c", assessed("fit", { tier: "B" })),
      result("d", assessed("borderline")),
      result("e", assessed("no_fit")),
      result("f"),
    ]);
    expect(digest).toEqual({ total: 6, assessed: 5, present: 2 });
  });

  it("reads an empty analysis as zeros", () => {
    expect(digestResults([])).toEqual({ total: 0, assessed: 0, present: 0 });
  });
});

describe("arrivalIndexes", () => {
  it("gives the first list its turns in order", () => {
    const turns = arrivalIndexes(new Map(), ["a", "b", "c"]);
    expect([...turns.entries()]).toEqual([
      ["a", 0],
      ["b", 1],
      ["c", 2],
    ]);
  });

  it("keeps the turn of a known key and counts the new ones from zero", () => {
    const first = arrivalIndexes(new Map(), ["a", "b"]);
    const next = arrivalIndexes(first, ["c", "a", "d", "b"]);
    expect(next.get("a")).toBe(0);
    expect(next.get("b")).toBe(1);
    expect(next.get("c")).toBe(0);
    expect(next.get("d")).toBe(1);
  });

  it("forgets a key no longer listed and reads a repeated key once", () => {
    const first = arrivalIndexes(new Map(), ["a", "b"]);
    const next = arrivalIndexes(first, ["b", "b", "c"]);
    expect(next.has("a")).toBe(false);
    expect(next.get("b")).toBe(1);
    expect(next.get("c")).toBe(0);
    expect(next.size).toBe(2);
  });
});
