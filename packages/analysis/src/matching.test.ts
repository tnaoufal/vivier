import { describe, expect, it } from "vitest";

import type { BriefCriterion, MatchResult } from "./types.js";

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
  roleWords,
  sameLanguage,
  scoreCandidate,
  snippet,
  type MatchProfile,
} from "./matching.js";

function criterion(
  partial: Partial<BriefCriterion> & Pick<BriefCriterion, "kind" | "value">,
): BriefCriterion {
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
    experiences: partial.experiences ?? [],
    search_text: partial.search_text ?? null,
  };
}

const none = { textRank: null, vectorRank: null };

function experience(title: string): MatchProfile["experiences"][number] {
  return { title, company: null, start: null, end: null, description: null };
}

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
    const verdict = evaluateCriterion(
      criterion({ kind: "skill", value: "Excel" }),
      profile({ skills: ["Microsoft Excel", "SAP"] }),
    );
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

  it("answers not_stated when nothing appears: a skill the CV does not name is not a lack", () => {
    const absent = evaluateCriterion(
      criterion({ kind: "skill", value: "python" }),
      profile({ skills: ["SAP"], search_text: "SAP FI" }),
    );
    expect(absent.verdict).toBe("not_stated");
    expect(absent.evidence).toBeNull();
    expect(
      evaluateCriterion(criterion({ kind: "skill", value: "python" }), profile()).verdict,
    ).toBe("not_stated");
  });
});

describe("evaluateCriterion: language", () => {
  const english = (level: string | null) => profile({ languages: [{ name: "Anglais", level }] });

  it("matches a language without a required level", () => {
    const verdict = evaluateCriterion(
      criterion({ kind: "language", value: "anglais" }),
      english("B1"),
    );
    expect(verdict.verdict).toBe("match");
    expect(verdict.evidence).toBe("Anglais (B1)");
  });

  it("compares the level in the value or the label", () => {
    expect(
      evaluateCriterion(criterion({ kind: "language", value: "anglais C1" }), english("C2"))
        .verdict,
    ).toBe("match");
    expect(
      evaluateCriterion(criterion({ kind: "language", value: "anglais C1" }), english("B2"))
        .verdict,
    ).toBe("partial");
    expect(
      evaluateCriterion(
        criterion({ kind: "language", value: "anglais", label: "Anglais courant" }),
        english("B2"),
      ).verdict,
    ).toBe("match");
    expect(
      evaluateCriterion(
        criterion({ kind: "language", value: "anglais", label: "Anglais courant" }),
        english("B1"),
      ).verdict,
    ).toBe("partial");
    expect(
      evaluateCriterion(
        criterion({ kind: "language", value: "anglais bilingue" }),
        english("courant"),
      ).verdict,
    ).toBe("partial");
    expect(
      evaluateCriterion(
        criterion({ kind: "language", value: "anglais bilingue" }),
        english("native"),
      ).verdict,
    ).toBe("match");
  });

  it("answers partial when the level is unknown, missing when the language is absent, not_stated when none is listed", () => {
    expect(
      evaluateCriterion(criterion({ kind: "language", value: "anglais B2" }), english(null))
        .verdict,
    ).toBe("partial");
    const absent = evaluateCriterion(
      criterion({ kind: "language", value: "allemand" }),
      profile({
        languages: [
          { name: "Anglais", level: "C1" },
          { name: "Espagnol", level: null },
        ],
      }),
    );
    expect(absent.verdict).toBe("missing");
    // The languages listed are the evidence: the assessment shows them when the model reads the language in anyway.
    expect(absent.evidence).toBe("Anglais (C1), Espagnol");
    expect(
      evaluateCriterion(criterion({ kind: "language", value: "allemand" }), profile()).verdict,
    ).toBe("not_stated");
  });
});

describe("evaluateCriterion: location", () => {
  it("matches in either direction", () => {
    expect(
      evaluateCriterion(
        criterion({ kind: "location", value: "Lyon" }),
        profile({ location: "Lyon, France" }),
      ).verdict,
    ).toBe("match");
    expect(
      evaluateCriterion(
        criterion({ kind: "location", value: "Lyon ou Paris" }),
        profile({ location: "Paris" }),
      ).verdict,
    ).toBe("match");
    expect(
      evaluateCriterion(
        criterion({ kind: "location", value: "Lyon" }),
        profile({ location: "Lille" }),
      ).verdict,
    ).toBe("missing");
    expect(
      evaluateCriterion(criterion({ kind: "location", value: "Lyon" }), profile({ location: null }))
        .verdict,
    ).toBe("not_stated");
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
    expect(
      evaluateCriterion(
        criterion({ kind: "experience", value: "au moins 3 ans" }),
        profile({ years_experience: 3 }),
      ).verdict,
    ).toBe("match");
    const free = criterion({ kind: "experience", value: "expérience en audit" });
    expect(
      evaluateCriterion(free, profile({ years_experience: 10, search_text: "Expérience en audit" }))
        .verdict,
    ).toBe("match");
    expect(
      evaluateCriterion(free, profile({ years_experience: 10, search_text: "Contrôle" })).verdict,
    ).toBe("not_stated");
  });
});

describe("evaluateCriterion: education", () => {
  const degrees = profile({
    education: [
      { degree: "Master 2 Contrôle de gestion et finance", school: "IAE Lyon", year: "2015" },
    ],
  });

  it("matches a degree or a school; an absent degree is missing with the degrees listed as evidence", () => {
    expect(evaluateCriterion(criterion({ kind: "education", value: "IAE" }), degrees).verdict).toBe(
      "match",
    );
    expect(
      evaluateCriterion(criterion({ kind: "education", value: "master finance" }), degrees).verdict,
    ).toBe("match");
    expect(
      evaluateCriterion(criterion({ kind: "education", value: "master audit" }), degrees).verdict,
    ).toBe("partial");
    const absent = evaluateCriterion(criterion({ kind: "education", value: "DSCG" }), degrees);
    expect(absent.verdict).toBe("missing");
    expect(absent.evidence).toBe("Master 2 Contrôle de gestion et finance, IAE Lyon");
    expect(
      evaluateCriterion(criterion({ kind: "education", value: "DSCG" }), profile()).verdict,
    ).toBe("not_stated");
  });

  it("reads a degree by its family in either language and ignores the filler of the requirement", () => {
    const engineers = profile({
      education: [
        { degree: "CHEMICAL ENGINEERING GRADUATION", school: "EMI, Rabat", year: "2008" },
        { degree: "Baccalauréat scientifique", school: "Lycée Pilote", year: "2003" },
      ],
    });
    const ask = (value: string) => evaluateCriterion(criterion({ kind: "education", value }), engineers);
    expect(ask("ingénieur ou équivalent").verdict).toBe("match");
    expect(ask("Diplôme d'ingénieur").verdict).toBe("match");
    // The field asked for is not named by the degree: met in part, never denied.
    expect(ask("ingénieur chimie").verdict).toBe("partial");
    expect(ask("master ou équivalent").verdict).toBe("missing");
    const french = profile({
      education: [{ degree: "Ingénieur d'État en électromécanique", school: "École des Mines", year: "2001" }],
    });
    expect(evaluateCriterion(criterion({ kind: "education", value: "engineer" }), french).verdict).toBe("match");
    expect(evaluateCriterion(criterion({ kind: "education", value: "MSc" }), french).verdict).toBe("missing");
    const masters = profile({ education: [{ degree: "MSc Chemistry", school: "KIT", year: "2010" }] });
    expect(evaluateCriterion(criterion({ kind: "education", value: "master ou équivalent" }), masters).verdict).toBe("match");
  });
});

describe("evaluateCriterion: role", () => {
  const role = criterion({
    kind: "role",
    label: "Business Developer",
    value: "Commercial chargé de conquérir de nouveaux comptes…",
    required: true,
    weight: 3,
  });

  it("keeps the words of the job's name worth finding, once each, without function words", () => {
    expect(roleWords("Chef de projet digital (H/F)")).toEqual(["chef", "projet", "digital"]);
    expect(roleWords("Business Developer senior")).toEqual(["business", "developer"]);
    expect(roleWords("Développeur / développeuse")).toEqual(["developpeur", "developpeuse"]);
    expect(roleWords("de la")).toEqual([]);
  });

  it("matches when every word of the name sits in the headline or in the title of an experience, with that title as evidence", () => {
    const byHeadline = evaluateCriterion(
      role,
      profile({ headline: "Senior business developer, SaaS" }),
    );
    expect(byHeadline.verdict).toBe("match");
    expect(byHeadline.evidence).toBe("Senior business developer, SaaS");
    const byTitle = evaluateCriterion(
      role,
      profile({
        headline: "Directeur commercial",
        experiences: [experience("Directeur SAV"), experience("Business Developer")],
      }),
    );
    expect(byTitle.verdict).toBe("match");
    expect(byTitle.evidence).toBe("Business Developer");
    // Whole words only: a word of the name inside a longer word is not found.
    expect(evaluateCriterion(role, profile({ headline: "Businessman" })).verdict).toBe(
      "not_stated",
    );
  });

  it("answers partial with the closest title when half of the words appear", () => {
    const verdict = evaluateCriterion(
      role,
      profile({
        experiences: [experience("Directeur SAV"), experience("Développeur business unit")],
      }),
    );
    expect(verdict.verdict).toBe("partial");
    expect(verdict.evidence).toBe("Développeur business unit");
    const three = criterion({ kind: "role", label: "Chef de projet digital", value: "x" });
    expect(evaluateCriterion(three, profile({ headline: "Chef de produit" })).verdict).toBe(
      "not_stated",
    );
    expect(evaluateCriterion(three, profile({ headline: "Chef de projet" })).verdict).toBe(
      "partial",
    );
  });

  it("never answers missing: a different title is no proof of a different métier, and no title at all is not stated", () => {
    const other = evaluateCriterion(
      role,
      profile({
        headline: "Directeur SAV",
        experiences: [experience("Responsable service après-vente")],
      }),
    );
    expect(other.verdict).toBe("not_stated");
    expect(other.evidence).toBeNull();
    expect(evaluateCriterion(role, profile()).verdict).toBe("not_stated");
    expect(evaluateCriterion(role, profile({ experiences: [experience("  ")] })).verdict).toBe(
      "not_stated",
    );
    expect(
      evaluateCriterion(
        criterion({ kind: "role", label: "de", value: "x" }),
        profile({ headline: "Business Developer" }),
      ).verdict,
    ).toBe("not_stated");
  });

  it("counts in the score like any criterion and never blocks on its own", () => {
    const result = scoreCandidate([role], profile({ headline: "Directeur SAV" }), none);
    expect(result.verdicts[0]?.verdict).toBe("not_stated");
    expect(result.blocked).toBe(false);
    expect(result.coverage).toBe(0);
    expect(scoreCandidate([role], profile({ headline: "Business developer" }), none).score).toBe(
      100,
    );
  });
});

describe("evaluateCriterion: availability and other", () => {
  it("reads availability", () => {
    expect(
      evaluateCriterion(
        criterion({ kind: "availability", value: "immédiate" }),
        profile({ availability: "Disponibilité immédiate" }),
      ).verdict,
    ).toBe("match");
    expect(
      evaluateCriterion(
        criterion({ kind: "availability", value: "immédiate" }),
        profile({ availability: "3 mois" }),
      ).verdict,
    ).toBe("missing");
    expect(
      evaluateCriterion(criterion({ kind: "availability", value: "immédiate" }), profile()).verdict,
    ).toBe("not_stated");
  });

  it("never judges a free criterion absent", () => {
    expect(
      evaluateCriterion(
        criterion({ kind: "other", value: "permis B" }),
        profile({ search_text: "Permis B, véhicule" }),
      ).verdict,
    ).toBe("match");
    expect(
      evaluateCriterion(
        criterion({ kind: "other", value: "permis B" }),
        profile({ search_text: "Rien" }),
      ).verdict,
    ).toBe("not_stated");
    expect(
      evaluateCriterion(criterion({ kind: "other", value: "permis B" }), profile()).verdict,
    ).toBe("not_stated");
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
      profile({
        skills: ["SAP FI"],
        languages: [{ name: "Anglais", level: "B2" }],
        location: "Paris",
      }),
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

  it("blocks when a required criterion is missing, never when the CV only says nothing", () => {
    const required = [
      criterion({ id: "lang", kind: "language", value: "anglais", required: true, weight: 2 }),
    ];
    const result = scoreCandidate(
      required,
      profile({ languages: [{ name: "Espagnol", level: "C1" }] }),
      none,
    );
    expect(result.blocked).toBe(true);
    expect(result.verdicts[0]?.verdict).toBe("missing");
    // The required skill is absent from the CV's text: not stated, so nothing blocks.
    const silent = scoreCandidate(
      criteria,
      profile({ skills: ["Oracle"], search_text: "Oracle" }),
      none,
    );
    expect(silent.blocked).toBe(false);
    expect(silent.verdicts[0]?.verdict).toBe("not_stated");
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
    expect(ranked.map((result) => result.candidateId)).toEqual([
      "high-full",
      "high-thin",
      "low",
      "blocked-high",
    ]);
  });

  it("falls back to the retrieval order: text rank, then vector rank, nulls last", () => {
    const ranked = rankResults([
      match({ candidateId: "vector-2", retrieval: { textRank: null, vectorRank: 2 } }),
      match({ candidateId: "text-3", retrieval: { textRank: 3, vectorRank: null } }),
      match({ candidateId: "none" }),
      match({ candidateId: "text-1", retrieval: { textRank: 1, vectorRank: 9 } }),
      match({ candidateId: "vector-1", retrieval: { textRank: null, vectorRank: 1 } }),
    ]);
    expect(ranked.map((result) => result.candidateId)).toEqual([
      "text-1",
      "text-3",
      "vector-1",
      "vector-2",
      "none",
    ]);
  });

  it("does not change the input and is stable", () => {
    const input = [match({ candidateId: "a" }), match({ candidateId: "b" })];
    const ranked = rankResults(input);
    expect(ranked.map((result) => result.candidateId)).toEqual(["a", "b"]);
    expect(input.map((result) => result.candidateId)).toEqual(["a", "b"]);
    expect(compareResults(input[0]!, input[1]!)).toBe(0);
  });
});
