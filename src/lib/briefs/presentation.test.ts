import { describe, expect, it } from "vitest";

import type {
  Assessment,
  BriefCriterion,
  BriefRow,
  CriterionResult,
  MatchResult,
  RoleProfile,
} from "@/lib/db/types";

import {
  analysisOfRow,
  arrivalIndexes,
  BAND_STEPS,
  bandStateOf,
  BRIEF_FILTERS,
  briefSubtitle,
  countByFilter,
  digestResults,
  ETA_MIN_ELAPSED_MS,
  filterBriefs,
  firstLine,
  firstSentence,
  funnelOf,
  isBriefFilter,
  jobChangedSince,
  latestPerBrief,
  matchesOf,
  mergeResults,
  nearOf,
  remainingMs,
  requirementTally,
  reservationLine,
  stepOf,
  synthesisLine,
  tierCounts,
  withAnalysis,
  type BandInputs,
  type LatestAnalysis,
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
  it("counts the results, the ones the model read and the ones that match, whatever their tier", () => {
    const digest = digestResults([
      result("a", assessed("fit", { tier: "A" })),
      result("b", assessed("fit")),
      result("c", assessed("fit", { tier: "B" })),
      result("d", assessed("borderline")),
      result("e", assessed("no_fit")),
      result("f"),
    ]);
    expect(digest).toEqual({ total: 6, assessed: 5, present: 3 });
  });

  it("reads an empty analysis as zeros", () => {
    expect(digestResults([])).toEqual({ total: 0, assessed: 0, present: 0 });
  });
});

describe("analysisOfRow", () => {
  const row = {
    id: "s1",
    org_id: "o1",
    brief_id: "b1",
    created_at: "2026-10-03T10:00:00+00:00",
    method: "triage",
    results: [
      result("a", assessed("fit", { tier: "A" })),
      result("b", assessed("no_fit")),
      result("c"),
    ],
  };

  it("reads the brief, the search, its method and what it counted off a realtime row", () => {
    expect(analysisOfRow(row)).toEqual({
      briefId: "b1",
      analysis: {
        searchId: "s1",
        createdAt: "2026-10-03T10:00:00+00:00",
        method: "triage",
        total: 3,
        assessed: 2,
        present: 1,
      },
    });
  });

  it("prefers the summary columns the database keeps, so a row without its results still counts", () => {
    expect(
      analysisOfRow({
        ...row,
        results: "too large",
        result_count: 140,
        assessed_count: 96,
        match_count: 12,
      }),
    ).toEqual({
      briefId: "b1",
      analysis: {
        searchId: "s1",
        createdAt: "2026-10-03T10:00:00+00:00",
        method: "triage",
        total: 140,
        assessed: 96,
        present: 12,
      },
    });
  });

  it("counts the results when a summary column is missing or not a number", () => {
    expect(analysisOfRow({ ...row, result_count: 3, assessed_count: null })?.analysis).toEqual({
      searchId: "s1",
      createdAt: "2026-10-03T10:00:00+00:00",
      method: "triage",
      total: 3,
      assessed: 2,
      present: 1,
    });
  });

  it("reads a missing or unknown method as the text path, and keeps a hybrid one", () => {
    expect(analysisOfRow({ ...row, method: undefined })?.analysis.method).toBe("text");
    expect(analysisOfRow({ ...row, method: "vector" })?.analysis.method).toBe("text");
    expect(analysisOfRow({ ...row, method: "hybrid" })?.analysis.method).toBe("hybrid");
  });

  it("answers null when realtime left the results out, or the row has no brief", () => {
    expect(analysisOfRow({ id: "s1", brief_id: "b1", created_at: row.created_at })).toBeNull();
    expect(analysisOfRow({ ...row, results: "too large" })).toBeNull();
    expect(analysisOfRow({ ...row, brief_id: null })).toBeNull();
    expect(analysisOfRow({})).toBeNull();
  });
});

describe("withAnalysis", () => {
  function latest(searchId: string, createdAt: string, present: number): LatestAnalysis {
    return { searchId, createdAt, method: "triage", total: 10, assessed: 10, present };
  }
  const known = new Map([["b1", latest("s2", "2026-10-03T10:00:00Z", 1)]]);

  it("replaces the brief's analysis with a later patch of the same search", () => {
    const next = withAnalysis(known, "b1", latest("s2", "2026-10-03T10:00:00Z", 4));
    expect(next.get("b1")?.present).toBe(4);
    expect(known.get("b1")?.present).toBe(1);
  });

  it("takes a newer search, and a brief seen for the first time", () => {
    const newer = withAnalysis(known, "b1", latest("s3", "2026-10-04T10:00:00Z", 0));
    expect(newer.get("b1")?.searchId).toBe("s3");
    const first = withAnalysis(known, "b2", latest("s9", "2026-10-01T10:00:00Z", 2));
    expect(first.get("b2")?.searchId).toBe("s9");
    expect(first.get("b1")?.searchId).toBe("s2");
  });

  it("keeps the newest when an older search is patched late", () => {
    expect(withAnalysis(known, "b1", latest("s1", "2026-10-02T10:00:00Z", 7))).toBe(known);
  });
});

describe("jobChangedSince", () => {
  function criterion(id: string, kind: BriefCriterion["kind"], value: string): BriefCriterion {
    return { id, kind, label: id, value, required: kind === "role", weight: 3 };
  }
  const role = criterion("role", "role", "finance d'entreprise");
  const skill = criterion("skill", "skill", "contrôle de gestion");

  it("is false while the brief holds the criteria the search took and its profile defines the same role", () => {
    expect(
      jobChangedSince({ criteria: [role, skill], role_profile: profile("finance d'entreprise") }, [
        role,
        skill,
      ]),
    ).toBe(false);
    expect(jobChangedSince({ criteria: [skill], role_profile: null }, [skill])).toBe(false);
  });

  it("is true once the team saved other criteria", () => {
    expect(
      jobChangedSince({ criteria: [role, { ...skill, value: "audit" }], role_profile: null }, [
        role,
        skill,
      ]),
    ).toBe(true);
    expect(jobChangedSince({ criteria: [role], role_profile: null }, [role, skill])).toBe(true);
  });

  it("is true once the profile defines the role otherwise than the search did", () => {
    expect(
      jobChangedSince({ criteria: [role, skill], role_profile: profile("audit interne") }, [
        role,
        skill,
      ]),
    ).toBe(true);
  });

  it("ignores a profile without a role criterion to rewrite", () => {
    expect(
      jobChangedSince({ criteria: [skill], role_profile: profile("audit interne") }, [skill]),
    ).toBe(false);
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

function tiered(
  id: string,
  decision: Assessment["decision"],
  score: number,
  extra: Partial<Assessment> = {},
): MatchResult {
  return result(id, assessed(decision, { score, ...extra }));
}

describe("matchesOf and nearOf", () => {
  const results = [
    tiered("c", "fit", 90, { tier: "C" }),
    tiered("near-low", "borderline", 55),
    tiered("a2", "fit", 70, { tier: "A" }),
    tiered("none", "fit", 99),
    tiered("out", "no_fit", 20),
    result("unread"),
    tiered("a1", "fit", 85, { tier: "A" }),
    tiered("near-high", "borderline", 68, { tier: "B" }),
    tiered("b", "fit", 95, { tier: "B" }),
  ];

  it("keeps only the matches, tier first, then the score, an untiered one last", () => {
    expect(matchesOf(results).map((entry) => entry.candidateId)).toEqual([
      "a1",
      "a2",
      "b",
      "c",
      "none",
    ]);
  });

  it("keeps only the near profiles, in the same order", () => {
    expect(nearOf(results).map((entry) => entry.candidateId)).toEqual(["near-high", "near-low"]);
  });

  it("answers empty lists for an analysis no model read", () => {
    expect(matchesOf([result("x")])).toEqual([]);
    expect(nearOf([])).toEqual([]);
  });

  it("splits the matches by tier, an untiered match and the other decisions in none", () => {
    expect(tierCounts(results)).toEqual({ A: 2, B: 1, C: 1 });
    expect(tierCounts([])).toEqual({ A: 0, B: 0, C: 0 });
  });
});

describe("funnelOf", () => {
  const results = [
    tiered("a", "fit", 90),
    tiered("b", "fit", 80),
    tiered("c", "borderline", 60),
    tiered("d", "no_fit", 20),
    result("e"),
  ];

  it("reads the first two figures off the triage and the last two off the results", () => {
    expect(funnelOf(results, { read: 1091, yes: 30, close: 12, unknown: 4 })).toEqual({
      analysed: 1091,
      kept: 46,
      assessed: 4,
      matches: 2,
    });
  });

  it("counts every result as read and kept without a triage", () => {
    expect(funnelOf(results, null)).toEqual({ analysed: 5, kept: 5, assessed: 4, matches: 2 });
  });

  it("reads an empty analysis as zeros", () => {
    expect(funnelOf([], { read: 0, yes: 0, close: 0, unknown: 0 })).toEqual({
      analysed: 0,
      kept: 0,
      assessed: 0,
      matches: 0,
    });
  });
});

describe("firstSentence", () => {
  it("stops at the first full stop followed by a space", () => {
    expect(firstSentence("  Huit ans en contrôle de gestion. Puis un poste de DAF.  ")).toBe(
      "Huit ans en contrôle de gestion.",
    );
  });

  it("never splits a number, and stops at a question or exclamation mark", () => {
    expect(firstSentence("Environ 3.5 ans dans le métier ? Oui.")).toBe(
      "Environ 3.5 ans dans le métier ?",
    );
  });

  it("answers the whole text without an end, and nothing for a blank one", () => {
    expect(firstSentence("Un parcours commercial B2B")).toBe("Un parcours commercial B2B");
    expect(firstSentence("   ")).toBe("");
    expect(firstSentence(null)).toBe("");
  });
});

describe("synthesisLine and reservationLine", () => {
  it("prefers the tiering's note, then the summary's first sentence", () => {
    expect(
      synthesisLine(tiered("a", "fit", 90, { rankNote: "  Le plus proche du poste.  " })),
    ).toBe("Le plus proche du poste.");
    expect(
      synthesisLine(tiered("a", "fit", 90, { rankNote: " ", summary: "Six ans. Puis autre." })),
    ).toBe("Six ans.");
    expect(synthesisLine(tiered("a", "fit", 90, { rankNote: null, summary: "" }))).toBeNull();
  });

  it("answers null for a profile no model read", () => {
    expect(synthesisLine(result("x"))).toBeNull();
    expect(reservationLine(result("x"))).toBeNull();
  });

  it("names the main reservation: the second opinion's doubt, then the first concern", () => {
    const doubt = tiered("a", "borderline", 60, {
      concerns: ["Pas de management"],
      challenge: { verdict: "doubt", reason: "Postes très courts", evidence: null },
    });
    expect(reservationLine(doubt)).toBe("Postes très courts");
    const concern = tiered("a", "borderline", 60, {
      concerns: ["  Pas de management "],
      challenge: { verdict: "confirmed", reason: "ignored", evidence: null },
    });
    expect(reservationLine(concern)).toBe("Pas de management");
    expect(reservationLine(tiered("a", "borderline", 60, { summary: "Un profil voisin." }))).toBe(
      "Un profil voisin.",
    );
  });
});

describe("requirementTally", () => {
  function verdict(id: string, value: CriterionResult["verdict"]): CriterionResult {
    return { criterionId: id, verdict: value, evidence: null };
  }

  it("counts the criteria found out of every criterion", () => {
    expect(
      requirementTally({
        verdicts: [
          verdict("1", "match"),
          verdict("2", "partial"),
          verdict("3", "not_stated"),
          verdict("4", "match"),
        ],
      }),
    ).toEqual({ met: 2, total: 4 });
    expect(requirementTally({ verdicts: [] })).toEqual({ met: 0, total: 0 });
  });
});

describe("bandStateOf", () => {
  const settled: BandInputs = {
    model: true,
    method: "triage",
    running: false,
    needsCheck: false,
    criteriaCount: 4,
    resultCount: 40,
    poolSize: 1091,
    triagePending: 0,
    promotionPending: false,
    stagePending: 0,
  };

  it("says running first, whatever else holds", () => {
    expect(bandStateOf({ ...settled, running: true, method: null })).toBe("running");
    expect(bandStateOf({ ...settled, running: true, needsCheck: true })).toBe("running");
  });

  it("says empty without an analysis, then the check before anything else", () => {
    expect(bandStateOf({ ...settled, method: null })).toBe("empty");
    expect(bandStateOf({ ...settled, needsCheck: true, triagePending: 1091 })).toBe("needsCheck");
  });

  it("reads a whole-pool analysis as done once nothing waits, incomplete otherwise", () => {
    expect(bandStateOf(settled)).toBe("done");
    expect(bandStateOf({ ...settled, resultCount: 0 })).toBe("done");
    expect(bandStateOf({ ...settled, triagePending: 3 })).toBe("incomplete");
    expect(bandStateOf({ ...settled, promotionPending: true })).toBe("incomplete");
    expect(bandStateOf({ ...settled, stagePending: 6 })).toBe("incomplete");
  });

  it("never reads a whole-pool analysis as text only, even without a model now", () => {
    expect(bandStateOf({ ...settled, model: false })).toBe("done");
    expect(bandStateOf({ ...settled, model: false, criteriaCount: 0 })).toBe("done");
  });

  it("reads an analysis on the text alone without a model or without criteria", () => {
    expect(bandStateOf({ ...settled, method: "hybrid", model: false })).toBe("textOnly");
    expect(bandStateOf({ ...settled, method: "text", criteriaCount: 0, resultCount: 1091 })).toBe(
      "textOnly",
    );
  });

  it("reads an older analysis that read part of the pool as legacy", () => {
    expect(bandStateOf({ ...settled, method: "hybrid", resultCount: 120 })).toBe("legacy");
    expect(bandStateOf({ ...settled, method: "text", poolSize: null })).toBe("legacy");
    expect(bandStateOf({ ...settled, method: "text", model: null, resultCount: 120 })).toBe(
      "legacy",
    );
  });

  it("reads an older analysis of the whole pool like any other", () => {
    expect(bandStateOf({ ...settled, method: "text", resultCount: 150, poolSize: 150 })).toBe(
      "done",
    );
    expect(
      bandStateOf({
        ...settled,
        method: "text",
        resultCount: 150,
        poolSize: 150,
        stagePending: 2,
      }),
    ).toBe("incomplete");
  });
});

describe("stepOf", () => {
  it("puts the six stages on the four steps of the stepper", () => {
    expect(BAND_STEPS).toEqual(["triage", "read", "challenge", "rank"]);
    expect(stepOf("triage")).toBe(0);
    expect(stepOf("promote")).toBe(0);
    expect(stepOf("read")).toBe(1);
    expect(stepOf("challenge")).toBe(2);
    expect(stepOf("rank")).toBe(3);
    expect(stepOf("final")).toBe(3);
  });
});

describe("remainingMs", () => {
  const start = 1_000_000;

  it("answers null until a batch came back and the stage ran long enough", () => {
    expect(
      remainingMs({ done: 40, total: 100, doneAtStart: 40, startedAt: start, now: start + 60_000 }),
    ).toBeNull();
    expect(
      remainingMs({
        done: 80,
        total: 100,
        doneAtStart: 40,
        startedAt: start,
        now: start + ETA_MIN_ELAPSED_MS - 1,
      }),
    ).toBeNull();
  });

  it("projects the pace seen since the stage started onto what is left", () => {
    expect(
      remainingMs({ done: 80, total: 200, doneAtStart: 40, startedAt: start, now: start + 20_000 }),
    ).toBe(60_000);
  });

  it("answers 0 once nothing is left", () => {
    expect(
      remainingMs({ done: 100, total: 100, doneAtStart: 0, startedAt: start, now: start + 1 }),
    ).toBe(0);
  });
});

describe("mergeResults", () => {
  it("replaces an entry in place and appends the ones the results lack", () => {
    const before = [result("a"), result("b"), result("c")];
    const merged = mergeResults(before, [tiered("b", "fit", 90), tiered("d", "no_fit", 10)]);
    expect(merged.map((entry) => entry.candidateId)).toEqual(["a", "b", "c", "d"]);
    expect(merged[1]?.assessment?.decision).toBe("fit");
    expect(before[1]?.assessment).toBeUndefined();
  });

  it("answers the same list for an empty answer", () => {
    const before = [result("a")];
    expect(mergeResults(before, [])).toBe(before);
  });

  it("appends a repeated new entry once, the last one given", () => {
    const merged = mergeResults([], [tiered("x", "borderline", 50), tiered("x", "fit", 80)]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.assessment?.decision).toBe("fit");
  });
});
