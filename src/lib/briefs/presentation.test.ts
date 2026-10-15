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
  appendPage,
  arrivalIndexes,
  bandStateOf,
  BRIEF_FILTERS,
  briefChangedSince,
  cardAnalysisOf,
  digestResults,
  ETA_MIN_ELAPSED_MS,
  etaOf,
  failureLineOf,
  figuresLine,
  filterBriefs,
  firstSentence,
  funnelOf,
  isBriefFilter,
  matchesOf,
  nearOf,
  requirementTally,
  doubtLine,
  reservationLine,
  retainedByBrief,
  screenLine,
  SET_ASIDE_PAGE,
  setAsideOf,
  setAsideReason,
  stageKey,
  stoppedLineOf,
  synthesisLine,
  withAnalysis,
  withTriageProgress,
  type BandRow,
  type Funnel,
  type LatestAnalysis,
} from "./presentation";
import { briefSourceHash } from "./role-profile";

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

describe("the status filter", () => {
  const rows = [brief("open", "a"), brief("draft", "b"), brief("open", "c"), brief("closed", "d")];

  it("knows its three values and nothing else", () => {
    expect(BRIEF_FILTERS).toEqual(["open", "closed", "all"]);
    expect(isBriefFilter("open")).toBe(true);
    expect(isBriefFilter("all")).toBe(true);
    expect(isBriefFilter("draft")).toBe(false);
    expect(isBriefFilter(3)).toBe(false);
  });

  it("keeps the briefs being worked on (a draft among them), the closed ones, or every row, in their order", () => {
    expect(filterBriefs(rows, "open").map((row) => row.id)).toEqual(["a", "b", "c"]);
    expect(filterBriefs(rows, "closed").map((row) => row.id)).toEqual(["d"]);
    expect(filterBriefs(rows, "all").map((row) => row.id)).toEqual(["a", "b", "c", "d"]);
  });
});

describe("retainedByBrief", () => {
  it("counts the retained items per brief and skips rows without one", () => {
    const counts = retainedByBrief([
      { briefId: "b1" },
      { briefId: "b2" },
      { briefId: "b1" },
      { briefId: null },
      { briefId: "b1" },
    ]);
    expect([...counts.entries()]).toEqual([
      ["b1", 3],
      ["b2", 1],
    ]);
    expect(retainedByBrief([]).size).toBe(0);
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
        status: null,
        total: 3,
        assessed: 2,
        present: 1,
        triagePending: null,
        kept: null,
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
        status: null,
        total: 140,
        assessed: 96,
        present: 12,
        triagePending: null,
        kept: null,
      },
    });
  });

  it("reads where the job stands off the row, an unknown status as none", () => {
    expect(analysisOfRow({ ...row, status: "running" })?.analysis.status).toBe("running");
    expect(analysisOfRow({ ...row, status: "done" })?.analysis.status).toBe("done");
    expect(analysisOfRow({ ...row, status: "paused" })?.analysis.status).toBeNull();
    expect(analysisOfRow({ ...row, status: 3 })?.analysis.status).toBeNull();
  });

  it("counts the results when a summary column is missing or not a number", () => {
    expect(analysisOfRow({ ...row, result_count: 3, assessed_count: null })?.analysis).toEqual({
      searchId: "s1",
      createdAt: "2026-10-03T10:00:00+00:00",
      method: "triage",
      status: null,
      total: 3,
      assessed: 2,
      present: 1,
      triagePending: null,
      kept: null,
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
  function latest(
    searchId: string,
    createdAt: string,
    present: number,
    status: LatestAnalysis["status"] = "done",
  ): LatestAnalysis {
    return {
      searchId,
      createdAt,
      method: "triage",
      status,
      total: 10,
      assessed: 10,
      present,
      triagePending: null,
      kept: null,
    };
  }
  const known = new Map([["b1", latest("s2", "2026-10-03T10:00:00Z", 1)]]);

  it("replaces the brief's analysis with a later patch of the same search", () => {
    const next = withAnalysis(known, "b1", latest("s2", "2026-10-03T10:00:00Z", 4));
    expect(next.get("b1")?.present).toBe(4);
    expect(known.get("b1")?.present).toBe(1);
  });

  it("takes a newer search, and a brief seen for the first time", () => {
    const newer = withAnalysis(known, "b1", latest("s3", "2026-10-04T10:00:00Z", 0, "queued"));
    expect(newer.get("b1")?.searchId).toBe("s3");
    expect(newer.get("b1")?.status).toBe("queued");
    const first = withAnalysis(known, "b2", latest("s9", "2026-10-01T10:00:00Z", 2));
    expect(first.get("b2")?.searchId).toBe("s9");
    expect(first.get("b1")?.searchId).toBe("s2");
  });

  it("keeps the newest when an older search is patched late", () => {
    expect(withAnalysis(known, "b1", latest("s1", "2026-10-02T10:00:00Z", 7))).toBe(known);
  });

  it("keeps the status and the triage's counts known for the same search when a patch carries none", () => {
    const counted = new Map([
      ["b1", { ...latest("s2", "2026-10-03T10:00:00Z", 1), triagePending: 0, kept: 10 }],
    ]);
    const patched = withAnalysis(counted, "b1", latest("s2", "2026-10-03T10:00:00Z", 4, null));
    expect(patched.get("b1")).toMatchObject({
      present: 4,
      status: "done",
      triagePending: 0,
      kept: 10,
    });
    const newer = withAnalysis(counted, "b1", latest("s3", "2026-10-04T10:00:00Z", 0, null));
    expect(newer.get("b1")).toMatchObject({
      searchId: "s3",
      status: null,
      triagePending: null,
      kept: null,
    });
  });
});

describe("withTriageProgress", () => {
  const known = new Map<string, LatestAnalysis>([
    [
      "b1",
      {
        searchId: "s2",
        createdAt: "2026-10-03T10:00:00Z",
        method: "triage",
        status: "running",
        total: 0,
        assessed: 0,
        present: 0,
        triagePending: null,
        kept: null,
      },
    ],
  ]);

  it("writes the counts read into the entry of the same search", () => {
    const next = withTriageProgress(known, "b1", "s2", { pending: 0, kept: 0 });
    expect(next.get("b1")).toMatchObject({ status: "running", triagePending: 0, kept: 0 });
    expect(known.get("b1")?.triagePending).toBeNull();
  });

  it("leaves the map as it is once a newer search took the brief's place, or for a brief unknown", () => {
    expect(withTriageProgress(known, "b1", "s1", { pending: 3, kept: 1 })).toBe(known);
    expect(withTriageProgress(known, "b9", "s2", { pending: 3, kept: 1 })).toBe(known);
  });
});

describe("cardAnalysisOf", () => {
  const base = { method: "triage" as const, total: 40, assessed: 40, present: 12 };

  it("counts the matches of a whole-pool search once its job is done, whatever the funnel kept", () => {
    expect(cardAnalysisOf({ ...base, status: "done" })).toEqual({ kind: "matches", count: 12 });
    expect(cardAnalysisOf({ ...base, status: "done", present: 0 })).toEqual({
      kind: "matches",
      count: 0,
    });
    // The screening kept hundreds and the promotion read thirty: done is done.
    expect(cardAnalysisOf({ ...base, status: "done", triagePending: 0, kept: 644 })).toEqual({
      kind: "matches",
      count: 12,
    });
    // One reading failed: the job still ended.
    expect(cardAnalysisOf({ ...base, status: "done", assessed: 39 })).toEqual({
      kind: "matches",
      count: 12,
    });
  });

  it("calls a whole-pool search unfinished while its job is queued, running, stopped or failed", () => {
    for (const status of ["queued", "running", "stopped", "failed"] as const)
      expect(cardAnalysisOf({ ...base, status })).toEqual({ kind: "unfinished" });
  });

  it("reads a row without the job's status as before: unfinished while none or only some of its profiles were read", () => {
    expect(cardAnalysisOf(base)).toEqual({ kind: "matches", count: 12 });
    expect(cardAnalysisOf({ ...base, status: null, total: 0, assessed: 0, present: 0 })).toEqual({
      kind: "unfinished",
    });
    expect(cardAnalysisOf({ ...base, assessed: 0, present: 0 })).toEqual({ kind: "unfinished" });
    expect(cardAnalysisOf({ ...base, assessed: 39 })).toEqual({ kind: "unfinished" });
  });

  it("reads 0 matches for a triage that kept nobody once nothing is left to read, without a status", () => {
    const none = { ...base, total: 0, assessed: 0, present: 0 };
    expect(cardAnalysisOf({ ...none, triagePending: 0, kept: 0 })).toEqual({
      kind: "matches",
      count: 0,
    });
    expect(cardAnalysisOf({ ...none, triagePending: 12, kept: 0 })).toEqual({
      kind: "unfinished",
    });
    expect(cardAnalysisOf({ ...base, triagePending: 0, kept: 44 })).toEqual({
      kind: "unfinished",
    });
    expect(cardAnalysisOf({ ...base, triagePending: 0, kept: 40 })).toEqual({
      kind: "matches",
      count: 12,
    });
  });

  it("counts the matches of an older analysis a model read, else the profiles it ranked", () => {
    expect(cardAnalysisOf({ method: "hybrid", total: 50, assessed: 20, present: 3 })).toEqual({
      kind: "matches",
      count: 3,
    });
    expect(cardAnalysisOf({ method: "text", total: 18, assessed: 0, present: 0 })).toEqual({
      kind: "ranked",
      count: 18,
    });
    expect(cardAnalysisOf({ method: "hybrid", total: 0, assessed: 0, present: 0 })).toEqual({
      kind: "ranked",
      count: 0,
    });
  });
});

describe("setAsideReason", () => {
  const criteria: BriefCriterion[] = [
    { id: "skill", kind: "skill", label: "SAP", value: "sap", required: false, weight: 2 },
    { id: "lang", kind: "language", label: "Anglais", value: "anglais", required: true, weight: 3 },
    { id: "role", kind: "role", label: "Contrôleur", value: "contrôle", required: true, weight: 3 },
  ];
  const rows = (pairs: [string, "yes" | "partial" | "no" | "unknown"][]) =>
    pairs.map(([criterionId, met]) => ({ criterionId, met, evidence: null }));

  it("gives the triage's reason for a profile it set aside, null when it wrote none", () => {
    expect(
      setAsideReason(criteria, {
        triage: { verdict: "no", reason: "  Comptable fournisseurs.  " },
      }),
    ).toEqual({ kind: "text", text: "Comptable fournisseurs." });
    expect(setAsideReason(criteria, { triage: { verdict: "no", reason: " " } })).toBeNull();
    expect(setAsideReason(criteria, { triage: { verdict: "no", reason: null } })).toBeNull();
  });

  it("tells a card the model could not read from one with nothing to judge", () => {
    expect(
      setAsideReason(criteria, {
        triage: { verdict: "unknown", reason: "Fiche illisible par le modèle" },
      }),
    ).toEqual({ kind: "unread" });
    expect(
      setAsideReason(criteria, {
        triage: { verdict: "unknown", reason: "Fiche sans poste ni intitulé" },
      }),
    ).toEqual({ kind: "thin" });
    expect(setAsideReason(criteria, { triage: { verdict: "unknown", reason: null } })).toEqual({
      kind: "thin",
    });
    expect(
      setAsideReason(criteria, { triage: { verdict: "unknown", reason: "Profil sorti du vivier" } }),
    ).toEqual({ kind: "gone" });
    expect(
      setAsideReason(criteria, { triage: { verdict: "unknown", reason: " Titres génériques. " } }),
    ).toEqual({ kind: "text", text: "Titres génériques." });
  });

  it("names the role, then a required requirement at no, never one that is only weighted", () => {
    const both = assessed("no_fit", {
      requirements: rows([
        ["skill", "no"],
        ["lang", "no"],
        ["role", "no"],
      ]),
      concerns: ["Peu d'encadrement."],
    });
    expect(setAsideReason(criteria, { assessment: both })).toEqual({
      kind: "missing",
      criterion: criteria[2],
    });
    const required = assessed("no_fit", {
      requirements: rows([
        ["skill", "no"],
        ["lang", "no"],
        ["role", "yes"],
      ]),
    });
    expect(setAsideReason(criteria, { assessment: required })).toEqual({
      kind: "missing",
      criterion: criteria[1],
    });
  });

  it("falls back to the main reservation, then the summary's first sentence", () => {
    const concern = assessed("no_fit", {
      requirements: rows([["skill", "no"]]),
      concerns: ["  Un parcours surtout commercial.  ", "Autre."],
      summary: "Six ans. Puis autre.",
    });
    expect(setAsideReason(criteria, { assessment: concern })).toEqual({
      kind: "text",
      text: "Un parcours surtout commercial.",
    });
    const summary = assessed("no_fit", { concerns: [" "], summary: "Six ans en audit. Puis." });
    expect(setAsideReason(criteria, { assessment: summary })).toEqual({
      kind: "text",
      text: "Six ans en audit.",
    });
    expect(
      setAsideReason(criteria, { assessment: assessed("no_fit", { summary: "" }) }),
    ).toBeNull();
  });

  it("reads a profile the triage kept, or one read in full anyway, by its reading, never by the triage's reason", () => {
    const kept = {
      triage: { verdict: "close" as const, reason: "Métier voisin." },
      assessment: assessed("no_fit", { concerns: ["Trop junior."] }),
    };
    expect(setAsideReason(criteria, kept)).toEqual({ kind: "text", text: "Trop junior." });
    expect(setAsideReason(criteria, { triage: kept.triage })).toBeNull();
    expect(
      setAsideReason(criteria, {
        triage: { verdict: "unknown", reason: null },
        assessment: assessed("no_fit", { concerns: ["Trop junior."] }),
      }),
    ).toEqual({ kind: "text", text: "Trop junior." });
  });
});

describe("screenLine", () => {
  it("puts the score first, then the reason, and says what it has alone", () => {
    expect(screenLine({ score: 72, reason: " Senior, huit ans en contrôle. " })).toBe(
      "72 · Senior, huit ans en contrôle.",
    );
    expect(screenLine({ score: 72.4, reason: null })).toBe("72");
    expect(screenLine({ score: null, reason: "Titre générique" })).toBe("Titre générique");
  });

  it("answers null when the screening wrote nothing", () => {
    expect(screenLine({ score: null, reason: " " })).toBeNull();
    expect(screenLine(null)).toBeNull();
    expect(screenLine(undefined)).toBeNull();
  });
});

describe("appendPage", () => {
  const row = (candidateId: string, reason: string | null = null) => ({ candidateId, reason });

  it("appends the rows of the next page in their order", () => {
    const first = [row("a"), row("b")];
    const next = appendPage(first, [row("c"), row("d")]);
    expect(next.map((entry) => entry.candidateId)).toEqual(["a", "b", "c", "d"]);
    expect(first.map((entry) => entry.candidateId)).toEqual(["a", "b"]);
  });

  it("lists a row once when a page shifted, keeping the first reading of it", () => {
    const next = appendPage([row("a", "x"), row("b")], [row("b", "y"), row("c"), row("c")]);
    expect(next).toEqual([row("a", "x"), row("b"), row("c")]);
  });

  it("pages fifty at a time", () => {
    expect(SET_ASIDE_PAGE).toBe(50);
  });
});

describe("briefChangedSince", () => {
  const text = { title: "Contrôleur de gestion", description: "Un contrôleur senior, Lyon." };

  it("is true once the brief's text differs from the one its profile was read from", () => {
    const read = { ...profile("finance"), sourceHash: briefSourceHash(text) };
    expect(briefChangedSince({ ...text, role_profile: read })).toBe(false);
    expect(
      briefChangedSince({ ...text, description: "Un contrôleur junior.", role_profile: read }),
    ).toBe(true);
    expect(briefChangedSince({ ...text, title: "DAF", role_profile: read })).toBe(true);
  });

  it("says nothing for a brief never read, or read before the hash existed", () => {
    expect(briefChangedSince({ ...text, role_profile: null })).toBe(false);
    expect(briefChangedSince({ ...text, role_profile: profile("finance") })).toBe(false);
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

  it("keeps only the profiles the full reading set aside, the closest first", () => {
    const out = [tiered("low", "no_fit", 12), ...results, tiered("high", "no_fit", 40)];
    expect(setAsideOf(out).map((entry) => entry.candidateId)).toEqual(["high", "out", "low"]);
    expect(setAsideOf([result("x")])).toEqual([]);
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

  it("reads the first two figures off the triage (unknown is never kept) and the reading's off the results", () => {
    expect(funnelOf(results, { read: 1091, yes: 30, close: 12, no: 1045, unknown: 4 })).toEqual({
      analysed: 1091,
      kept: 42,
      assessed: 4,
      matches: 2,
      setAside: 1050,
    });
  });

  it("counts every result as read and kept without a triage, and the no_fit ones as set aside", () => {
    expect(funnelOf(results, null)).toEqual({
      analysed: 5,
      kept: 5,
      assessed: 4,
      matches: 2,
      setAside: 1,
    });
  });

  it("reads an empty analysis as zeros", () => {
    expect(funnelOf([], { read: 0, yes: 0, close: 0, no: 0, unknown: 0 })).toEqual({
      analysed: 0,
      kept: 0,
      assessed: 0,
      matches: 0,
      setAside: 0,
    });
  });

  it("never counts a negative triage figure", () => {
    const funnel = funnelOf([], { read: -1, yes: -2, close: 3, no: -4, unknown: 1 });
    expect(funnel.analysed).toBe(0);
    expect(funnel.kept).toBe(3);
    expect(funnel.setAside).toBe(1);
  });
});

describe("figuresLine", () => {
  const funnel: Funnel = { analysed: 1091, kept: 84, assessed: 30, matches: 12, setAside: 1010 };

  it("says the profiles analysed, kept by the triage, read in full and set aside, each once, never the matches", () => {
    expect(figuresLine(funnel, true)).toEqual([
      { key: "analysed", count: 1091 },
      { key: "kept", count: 84 },
      { key: "assessed", count: 30 },
      { key: "setAside", count: 1010 },
    ]);
  });

  it("leaves out the profiles read in full once every kept profile was, and the set-aside figure when there is none", () => {
    expect(figuresLine({ ...funnel, assessed: 84, setAside: 0 }, true)).toEqual([
      { key: "analysed", count: 1091 },
      { key: "kept", count: 84 },
    ]);
  });

  it("never counts the triage's kept profiles for an analysis without one", () => {
    expect(
      figuresLine({ analysed: 120, kept: 120, assessed: 96, matches: 3, setAside: 7 }, false),
    ).toEqual([
      { key: "analysed", count: 120 },
      { key: "assessed", count: 96 },
      { key: "setAside", count: 7 },
    ]);
    expect(
      figuresLine({ analysed: 5, kept: 5, assessed: 5, matches: 2, setAside: 0 }, false),
    ).toEqual([{ key: "analysed", count: 5 }]);
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

  it("reads the second opinion's doubt on a match it kept, nothing on a confirmation", () => {
    const kept = tiered("a", "fit", 82, {
      challenge: { verdict: "doubt", kind: "context", reason: "  Pétrochimie plutôt que chimie ", evidence: "e" },
    });
    expect(doubtLine(kept)).toBe("Pétrochimie plutôt que chimie");
    expect(reservationLine(kept)).toBe("Pétrochimie plutôt que chimie");
    expect(
      doubtLine(tiered("a", "fit", 82, { challenge: { verdict: "confirmed", reason: "r", evidence: null } })),
    ).toBeNull();
    expect(doubtLine(result("x"))).toBeNull();
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
  const done: BandRow = {
    method: "triage",
    status: "done",
    poolSize: 1091,
    resultCount: 30,
    criteriaCount: 4,
  };

  it("says empty without an analysis", () => {
    expect(bandStateOf(null, true)).toBe("empty");
    expect(bandStateOf(null, null)).toBe("empty");
  });

  it("follows the job's status: queued, running, stopped, failed, then done", () => {
    expect(bandStateOf({ ...done, status: "queued" }, true)).toBe("queued");
    expect(bandStateOf({ ...done, status: "running" }, true)).toBe("running");
    expect(bandStateOf({ ...done, status: "stopped" }, true)).toBe("stopped");
    expect(bandStateOf({ ...done, status: "failed" }, true)).toBe("failed");
    expect(bandStateOf(done, true)).toBe("done");
    expect(bandStateOf({ ...done, resultCount: 0 }, true)).toBe("done");
  });

  it("never reads a whole-pool analysis as text only, even without a model now", () => {
    expect(bandStateOf(done, false)).toBe("done");
    expect(bandStateOf({ ...done, criteriaCount: 0 }, false)).toBe("done");
  });

  it("reads an analysis on the text alone without a model or without criteria", () => {
    expect(bandStateOf({ ...done, method: "hybrid" }, false)).toBe("textOnly");
    expect(
      bandStateOf({ ...done, method: "text", criteriaCount: 0, resultCount: 1091 }, true),
    ).toBe("textOnly");
  });

  it("reads an older analysis that read part of the pool as legacy", () => {
    expect(bandStateOf({ ...done, method: "hybrid", resultCount: 120 }, true)).toBe("legacy");
    expect(bandStateOf({ ...done, method: "text", poolSize: null }, true)).toBe("legacy");
    expect(bandStateOf({ ...done, method: "text", resultCount: 120 }, null)).toBe("legacy");
  });

  it("reads an older analysis of the whole pool as done", () => {
    expect(bandStateOf({ ...done, method: "text", resultCount: 150, poolSize: 150 }, true)).toBe(
      "done",
    );
  });
});

describe("stageKey", () => {
  it("names the sentence of a stage", () => {
    expect(stageKey("triage")).toBe("briefs.analysis.stage.triage");
    expect(stageKey("final")).toBe("briefs.analysis.stage.final");
  });
});

describe("etaOf", () => {
  const startedAt = "2026-10-15T10:00:00Z";
  const start = Date.parse(startedAt);

  it("answers null without a start, before anything settled, or too soon", () => {
    expect(etaOf(null, 40, 100, start + 60_000)).toBeNull();
    expect(etaOf("not a date", 40, 100, start + 60_000)).toBeNull();
    expect(etaOf(startedAt, 0, 100, start + 60_000)).toBeNull();
    expect(etaOf(startedAt, 40, 100, start + ETA_MIN_ELAPSED_MS - 1)).toBeNull();
    expect(etaOf(startedAt, 5, 0, start + 60_000)).toBeNull();
  });

  it("projects the pace seen since the start onto what is left", () => {
    expect(etaOf(startedAt, 40, 100, start + 20_000)).toBe(30_000);
    expect(etaOf(startedAt, 640, 1093, start + 120_000)).toBe(Math.round((120_000 * 453) / 640));
  });

  it("answers 0 once nothing is left", () => {
    expect(etaOf(startedAt, 100, 100, start + 1)).toBe(0);
    expect(etaOf(startedAt, 120, 100, start + 1)).toBe(0);
  });
});

describe("stoppedLineOf", () => {
  it("counts the profiles a stage that reads profiles had left, never below zero", () => {
    expect(stoppedLineOf({ stage: "triage", progress_done: 453, progress_total: 1093 })).toEqual({
      kind: "profiles",
      count: 640,
    });
    expect(stoppedLineOf({ stage: "screening", progress_done: 100, progress_total: 644 })).toEqual({
      kind: "profiles",
      count: 544,
    });
    expect(stoppedLineOf({ stage: "assessing", progress_done: -5, progress_total: 10 })).toEqual({
      kind: "profiles",
      count: 10,
    });
    expect(
      stoppedLineOf({ stage: "triage", progress_done: Number.NaN, progress_total: 3 }),
    ).toEqual({
      kind: "profiles",
      count: 3,
    });
  });

  it("names the stage with its own count when its items are not profiles, or once every profile was read", () => {
    expect(stoppedLineOf({ stage: "ranking", progress_done: 2, progress_total: 4 })).toEqual({
      kind: "stage",
      stage: "ranking",
      done: 2,
      total: 4,
    });
    expect(stoppedLineOf({ stage: "challenging", progress_done: 3, progress_total: 5 })).toEqual({
      kind: "stage",
      stage: "challenging",
      done: 3,
      total: 5,
    });
    expect(stoppedLineOf({ stage: "triage", progress_done: 1093, progress_total: 1093 })).toEqual({
      kind: "stage",
      stage: "triage",
      done: 1093,
      total: 1093,
    });
    expect(stoppedLineOf({ stage: "final", progress_done: 2, progress_total: 1 })).toEqual({
      kind: "stage",
      stage: "final",
      done: 1,
      total: 1,
    });
  });

  it("says unfinished alone without a stage or without items", () => {
    expect(stoppedLineOf({ stage: null, progress_done: 0, progress_total: 0 })).toEqual({
      kind: "unfinished",
    });
    expect(stoppedLineOf({ stage: "promotion", progress_done: 0, progress_total: 0 })).toEqual({
      kind: "unfinished",
    });
    expect(stoppedLineOf({ stage: "triage", progress_done: 10, progress_total: 0 })).toEqual({
      kind: "unfinished",
    });
  });
});

describe("failureLineOf", () => {
  it("names the changed brief, the model, or any other error", () => {
    expect(failureLineOf("brief_changed")).toBe("brief");
    expect(failureLineOf("model_unavailable")).toBe("model");
    expect(failureLineOf("  MODEL_UNAVAILABLE: 503 ")).toBe("model");
    expect(failureLineOf("processor_error")).toBe("other");
    expect(failureLineOf("brief_empty")).toBe("other");
    expect(failureLineOf("brief_unreadable")).toBe("other");
    expect(failureLineOf("")).toBe("other");
    expect(failureLineOf(null)).toBe("other");
    expect(failureLineOf(undefined)).toBe("other");
  });
});
