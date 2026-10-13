import { describe, expect, it } from "vitest";

import type { BriefCriterion, MatchResult } from "@/lib/db/types";

import {
  compareResults,
  containsWord,
  evaluateCriterion,
  evaluatedCount,
  firstNumber,
  languageKey,
  levelRank,
  normalise,
  rankResults,
  sameLanguage,
  scoreCandidate,
  snippet,
  type MatchProfile,
} from "./matching";

function criterion(partial: Partial<BriefCriterion> & Pick<BriefCriterion, "kind" | "value">): BriefCriterion {
  return {
    id: partial.id ?? `c-${partial.kind}-${partial.value}`,
    kind: partial.kind,
    label: partial.label ?? partial.value,
    value: partial.value,
    required: partial.required ?? false,
    weight: partial.weight ?? 2,
  };
}

function profile(partial: Partial<MatchProfile> = {}): MatchProfile {
  return {
    id: partial.id ?? "cand-1",
    headline: partial.headline ?? null,
    summary: partial.summary ?? null,
    skills: partial.skills ?? [],
    languages: partial.languages ?? [],
    location: partial.location ?? null,
    years_experience: partial.years_experience ?? null,
    availability: partial.availability ?? null,
    education: partial.education ?? [],
    search_text: partial.search_text ?? null,
  };
}

const none = { textRank: null, vectorRank: null };

describe("normalise", () => {
  it("strips diacritics, lowercases and collapses spaces", () => {
    expect(normalise("  Contrôleur   de\nGestion ")).toBe("controleur de gestion");
    expect(normalise("Élève")).toBe("eleve");
    expect(normalise(null)).toBe("");
    expect(normalise(undefined)).toBe("");
  });
});

describe("containsWord and snippet", () => {
  it("matches whole words only", () => {
    expect(containsWord("sql et nosql", "sql")).toBe(true);
    expect(containsWord("nosql", "sql")).toBe(false);
    expect(containsWord("c++ et java", "c++")).toBe(true);
    expect(containsWord("", "sql")).toBe(false);
    expect(containsWord("sql", "")).toBe(false);
  });

  it("cuts a snippet around a match with ellipses", () => {
    const text = "a".repeat(60) + " paris " + "b".repeat(60);
    const index = text.indexOf("paris");
    const cut = snippet(text, index, "paris".length, 10);
    expect(cut.startsWith("…")).toBe(true);
    expect(cut.endsWith("…")).toBe(true);
    expect(cut).toContain("paris");
    expect(snippet("paris", 0, 5)).toBe("paris");
  });
});

describe("firstNumber", () => {
  it("reads the first number, with a comma or a dot", () => {
    expect(firstNumber("5 ans")).toBe(5);
    expect(firstNumber("3,5 ans")).toBe(3.5);
    expect(firstNumber("entre 3 et 5 ans")).toBe(3);
    expect(firstNumber("cinq ans")).toBeNull();
  });
});

describe("levelRank", () => {
  it("orders A1 < A2 < B1 < B2 < C1 < C2", () => {
    const ranks = ["A1", "A2", "B1", "B2", "C1", "C2"].map((level) => levelRank(level));
    expect(ranks).toEqual([1, 2, 3, 4, 5, 6]);
    for (let i = 1; i < ranks.length; i++) expect(ranks[i]!).toBeGreaterThan(ranks[i - 1]!);
  });

  it("reads the words", () => {
    expect(levelRank("Anglais courant")).toBe(4);
    expect(levelRank("fluent English")).toBe(4);
    expect(levelRank("bilingue")).toBe(6);
    expect(levelRank("native")).toBe(6);
    expect(levelRank("intermediate")).toBe(3);
    expect(levelRank("notions")).toBe(2);
    expect(levelRank("anglais")).toBeNull();
    expect(levelRank(null)).toBeNull();
  });

  it("does not read a level out of B2B", () => {
    expect(levelRank("B2B sales")).toBeNull();
  });
});

describe("languages", () => {
  it("knows the usual names in both languages", () => {
    expect(languageKey("Anglais")).toBe("english");
    expect(languageKey("english fluent")).toBe("english");
    expect(languageKey("Espagnol")).toBe("spanish");
    expect(languageKey("Klingon")).toBeNull();
  });

  it("matches across languages and by containment", () => {
    expect(sameLanguage("anglais C1", "English")).toBe(true);
    expect(sameLanguage("anglais", "Allemand")).toBe(false);
    expect(sameLanguage("swahili B2", "Swahili")).toBe(true);
    expect(sameLanguage("x", "Swahili")).toBe(false);
  });
});

describe("evaluateCriterion: skill", () => {
  it("matches a skill by substring", () => {
    const verdict = evaluateCriterion(criterion({ kind: "skill", value: "Excel" }), profile({ skills: ["Microsoft Excel", "SAP"] }));
    expect(verdict.verdict).toBe("match");
    expect(verdict.evidence).toBe("Microsoft Excel");
  });

  it("matches the search text as whole words", () => {
    const verdict = evaluateCriterion(
      criterion({ kind: "skill", value: "contrôle de gestion" }),
      profile({ skills: ["SAP"], search_text: "Dix ans en contrôle de gestion industriel" }),
    );
    expect(verdict.verdict).toBe("match");
    expect(verdict.evidence).toContain("controle de gestion");
  });

  it("answers partial when at least half of the words appear", () => {
    const verdict = evaluateCriterion(
      criterion({ kind: "skill", value: "reporting financier groupe" }),
      profile({ skills: ["Reporting"], search_text: "Consolidation groupe" }),
    );
    expect(verdict.verdict).toBe("partial");
    expect(verdict.evidence).toBe("reporting, groupe");
  });

  it("answers missing when nothing appears, not_stated when the profile is empty", () => {
    expect(evaluateCriterion(criterion({ kind: "skill", value: "python" }), profile({ skills: ["SAP"], search_text: "SAP FI" })).verdict).toBe("missing");
    expect(evaluateCriterion(criterion({ kind: "skill", value: "python" }), profile()).verdict).toBe("not_stated");
  });
});

describe("evaluateCriterion: language", () => {
  const english = (level: string | null) => profile({ languages: [{ name: "Anglais", level }] });

  it("matches a language without a required level", () => {
    const verdict = evaluateCriterion(criterion({ kind: "language", value: "anglais" }), english("B1"));
    expect(verdict.verdict).toBe("match");
    expect(verdict.evidence).toBe("Anglais (B1)");
  });

  it("compares the level in the value or the label", () => {
    expect(evaluateCriterion(criterion({ kind: "language", value: "anglais C1" }), english("C2")).verdict).toBe("match");
    expect(evaluateCriterion(criterion({ kind: "language", value: "anglais C1" }), english("B2")).verdict).toBe("partial");
    expect(evaluateCriterion(criterion({ kind: "language", value: "anglais", label: "Anglais courant" }), english("B2")).verdict).toBe("match");
    expect(evaluateCriterion(criterion({ kind: "language", value: "anglais", label: "Anglais courant" }), english("B1")).verdict).toBe("partial");
    expect(evaluateCriterion(criterion({ kind: "language", value: "anglais bilingue" }), english("courant")).verdict).toBe("partial");
    expect(evaluateCriterion(criterion({ kind: "language", value: "anglais bilingue" }), english("native")).verdict).toBe("match");
  });

  it("answers partial when the level is unknown, missing when the language is absent, not_stated when none is listed", () => {
    expect(evaluateCriterion(criterion({ kind: "language", value: "anglais B2" }), english(null)).verdict).toBe("partial");
    expect(evaluateCriterion(criterion({ kind: "language", value: "allemand" }), english("C1")).verdict).toBe("missing");
    expect(evaluateCriterion(criterion({ kind: "language", value: "allemand" }), profile()).verdict).toBe("not_stated");
  });
});

describe("evaluateCriterion: location", () => {
  it("matches in either direction", () => {
    expect(evaluateCriterion(criterion({ kind: "location", value: "Lyon" }), profile({ location: "Lyon, France" })).verdict).toBe("match");
    expect(evaluateCriterion(criterion({ kind: "location", value: "Lyon ou Paris" }), profile({ location: "Paris" })).verdict).toBe("match");
    expect(evaluateCriterion(criterion({ kind: "location", value: "Lyon" }), profile({ location: "Lille" })).verdict).toBe("missing");
    expect(evaluateCriterion(criterion({ kind: "location", value: "Lyon" }), profile({ location: null })).verdict).toBe("not_stated");
  });
});

describe("evaluateCriterion: experience", () => {
  it("compares the years with one year of tolerance", () => {
    const five = criterion({ kind: "experience", value: "5" });
    expect(evaluateCriterion(five, profile({ years_experience: 7 })).verdict).toBe("match");
    expect(evaluateCriterion(five, profile({ years_experience: 5 })).verdict).toBe("match");
    expect(evaluateCriterion(five, profile({ years_experience: 4 })).verdict).toBe("partial");
    expect(evaluateCriterion(five, profile({ years_experience: 3.5 })).verdict).toBe("missing");
    expect(evaluateCriterion(five, profile({ years_experience: null })).verdict).toBe("not_stated");
    expect(evaluateCriterion(five, profile({ years_experience: 7 })).evidence).toBe("7");
  });

  it("reads the years out of a sentence and falls back to the text when there is no number", () => {
    expect(evaluateCriterion(criterion({ kind: "experience", value: "au moins 3 ans" }), profile({ years_experience: 3 })).verdict).toBe("match");
    const free = criterion({ kind: "experience", value: "expérience en audit" });
    expect(evaluateCriterion(free, profile({ years_experience: 10, search_text: "Expérience en audit" })).verdict).toBe("match");
    expect(evaluateCriterion(free, profile({ years_experience: 10, search_text: "Contrôle" })).verdict).toBe("not_stated");
  });
});

describe("evaluateCriterion: education", () => {
  const degrees = profile({ education: [{ degree: "Master 2 Contrôle de gestion et finance", school: "IAE Lyon", year: "2015" }] });

  it("matches a degree or a school", () => {
    expect(evaluateCriterion(criterion({ kind: "education", value: "IAE" }), degrees).verdict).toBe("match");
    expect(evaluateCriterion(criterion({ kind: "education", value: "master finance" }), degrees).verdict).toBe("match");
    expect(evaluateCriterion(criterion({ kind: "education", value: "master audit" }), degrees).verdict).toBe("partial");
    expect(evaluateCriterion(criterion({ kind: "education", value: "DSCG" }), degrees).verdict).toBe("missing");
    expect(evaluateCriterion(criterion({ kind: "education", value: "DSCG" }), profile()).verdict).toBe("not_stated");
  });
});

describe("evaluateCriterion: availability and other", () => {
  it("reads availability", () => {
    expect(evaluateCriterion(criterion({ kind: "availability", value: "immédiate" }), profile({ availability: "Disponibilité immédiate" })).verdict).toBe("match");
    expect(evaluateCriterion(criterion({ kind: "availability", value: "immédiate" }), profile({ availability: "3 mois" })).verdict).toBe("missing");
    expect(evaluateCriterion(criterion({ kind: "availability", value: "immédiate" }), profile()).verdict).toBe("not_stated");
  });

  it("never judges a free criterion absent", () => {
    expect(evaluateCriterion(criterion({ kind: "other", value: "permis B" }), profile({ search_text: "Permis B, véhicule" })).verdict).toBe("match");
    expect(evaluateCriterion(criterion({ kind: "other", value: "permis B" }), profile({ search_text: "Rien" })).verdict).toBe("not_stated");
    expect(evaluateCriterion(criterion({ kind: "other", value: "permis B" }), profile()).verdict).toBe("not_stated");
  });
});

describe("scoreCandidate", () => {
  const criteria: BriefCriterion[] = [
    criterion({ id: "a", kind: "skill", value: "sap", weight: 3, required: true }),
    criterion({ id: "b", kind: "language", value: "anglais C1", weight: 2 }),
    criterion({ id: "c", kind: "location", value: "Lyon", weight: 1 }),
    criterion({ id: "d", kind: "experience", value: "5", weight: 2 }),
  ];

  it("weighs match 1, partial 0.5, missing 0 over the evaluable criteria", () => {
    const result = scoreCandidate(
      criteria,
      profile({ skills: ["SAP FI"], languages: [{ name: "Anglais", level: "B2" }], location: "Paris" }),
      { textRank: 1, vectorRank: null },
    );
    // sap match (3), anglais partial (2 × 0.5), Lyon missing (1), experience not stated
    expect(result.score).toBe(Math.round((100 * (3 + 1)) / 6));
    expect(result.coverage).toBe(0.75);
    expect(evaluatedCount(result.verdicts)).toBe(3);
    expect(result.blocked).toBe(false);
    expect(result.why).toBeNull();
    expect(result.retrieval).toEqual({ textRank: 1, vectorRank: null });
    expect(result.verdicts.map((verdict) => verdict.criterionId)).toEqual(["a", "b", "c", "d"]);
  });

  it("blocks when a required criterion is missing", () => {
    const result = scoreCandidate(criteria, profile({ skills: ["Oracle"], search_text: "Oracle" }), none);
    expect(result.blocked).toBe(true);
    expect(result.verdicts[0]?.verdict).toBe("missing");
  });

  it("scores 0 with coverage 0 when nothing can be evaluated", () => {
    const result = scoreCandidate(criteria, profile(), none);
    expect(result.score).toBe(0);
    expect(result.coverage).toBe(0);
    expect(result.blocked).toBe(false);
  });

  it("scores 0 with coverage 1 without criteria", () => {
    const result = scoreCandidate([], profile({ skills: ["SAP"] }), none);
    expect(result).toMatchObject({ score: 0, coverage: 1, blocked: false, verdicts: [] });
  });
});

function match(partial: Partial<MatchResult> & Pick<MatchResult, "candidateId">): MatchResult {
  return {
    candidateId: partial.candidateId,
    score: partial.score ?? 0,
    coverage: partial.coverage ?? 1,
    blocked: partial.blocked ?? false,
    verdicts: partial.verdicts ?? [],
    why: partial.why ?? null,
    retrieval: partial.retrieval ?? none,
  };
}

describe("rankResults", () => {
  it("puts the unblocked first, then the score, then the coverage", () => {
    const ranked = rankResults([
      match({ candidateId: "blocked-high", score: 95, blocked: true }),
      match({ candidateId: "low", score: 40 }),
      match({ candidateId: "high-thin", score: 80, coverage: 0.5 }),
      match({ candidateId: "high-full", score: 80, coverage: 1 }),
    ]);
    expect(ranked.map((result) => result.candidateId)).toEqual(["high-full", "high-thin", "low", "blocked-high"]);
  });

  it("falls back to the retrieval order: text rank, then vector rank, nulls last", () => {
    const ranked = rankResults([
      match({ candidateId: "vector-2", retrieval: { textRank: null, vectorRank: 2 } }),
      match({ candidateId: "text-3", retrieval: { textRank: 3, vectorRank: null } }),
      match({ candidateId: "none" }),
      match({ candidateId: "text-1", retrieval: { textRank: 1, vectorRank: 9 } }),
      match({ candidateId: "vector-1", retrieval: { textRank: null, vectorRank: 1 } }),
    ]);
    expect(ranked.map((result) => result.candidateId)).toEqual(["text-1", "text-3", "vector-1", "vector-2", "none"]);
  });

  it("does not change the input and is stable", () => {
    const input = [match({ candidateId: "a" }), match({ candidateId: "b" })];
    const ranked = rankResults(input);
    expect(ranked.map((result) => result.candidateId)).toEqual(["a", "b"]);
    expect(input.map((result) => result.candidateId)).toEqual(["a", "b"]);
    expect(compareResults(input[0]!, input[1]!)).toBe(0);
  });
});
