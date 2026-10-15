import { describe, expect, it } from "vitest";

import type { Assessment, BriefCriterion, MatchResult } from "@/lib/db/types";

import {
  assessedScore,
  criteriaOf,
  modelReading,
  recruiterReadingOf,
  tierOf,
} from "./requirements";

const criteria: BriefCriterion[] = [
  { id: "k1", kind: "skill", label: "React", value: "react", required: true, weight: 3 },
  { id: "k2", kind: "language", label: "Anglais C1", value: "C1", required: false, weight: 2 },
  { id: "k3", kind: "location", label: "Lyon", value: "lyon", required: false, weight: 1 },
];

const deterministic: MatchResult = {
  candidateId: "c1",
  score: 61.6,
  coverage: 0.5,
  blocked: false,
  verdicts: [
    { criterionId: "k1", verdict: "match", evidence: "React depuis 2019" },
    { criterionId: "k2", verdict: "partial", evidence: " B2 " },
    { criterionId: "k9", verdict: "missing", evidence: null },
  ],
  why: "  Deux phrases du modèle.  ",
  retrieval: { textRank: 1, vectorRank: null },
};

const assessment: Assessment = {
  decision: "borderline",
  score: 72.4,
  summary: "Un profil solide sur React.",
  requirements: [
    { criterionId: "k1", met: "partial", evidence: "React, sans version citée" },
    { criterionId: "k2", met: "no", evidence: null },
  ],
  model: "test-model",
};

const assessed: MatchResult = { ...deterministic, assessment };

describe("criteriaOf", () => {
  it("follows the criteria the match carries, as they were when the analysis ran, before the brief's current ones", () => {
    const snapshot: MatchResult = {
      ...assessed,
      criteria: [
        {
          id: "k2",
          kind: "language",
          label: "Anglais C1 (à l'analyse)",
          value: "C1",
          required: true,
          weight: 2,
        },
        { id: "k9", kind: "skill", label: "Docker", value: "docker", required: false, weight: 1 },
      ],
    };
    expect(criteriaOf(criteria, snapshot).map((criterion) => criterion.id)).toEqual(["k2", "k9"]);
    // A snapshot the parser cannot read, or an empty one, falls back on the brief's criteria.
    expect(criteriaOf(criteria, { criteria: [] })).toBe(criteria);
    expect(criteriaOf(criteria, { criteria: "nope" } as unknown as MatchResult)).toBe(criteria);
    expect(criteriaOf(criteria, deterministic)).toBe(criteria);
  });
});

describe("assessedScore", () => {
  it("is the assessment's score, rounded and clamped", () => {
    expect(assessedScore(assessed)).toBe(72);
    expect(assessedScore({ assessment: { ...assessment, score: 140 } })).toBe(100);
    expect(assessedScore({ assessment: { ...assessment, score: -3 } })).toBe(0);
  });

  it("is null without an assessment or with a score that is not a number", () => {
    expect(assessedScore(deterministic)).toBeNull();
    expect(assessedScore(null)).toBeNull();
    expect(assessedScore({ assessment: { ...assessment, score: Number.NaN } })).toBeNull();
  });
});

describe("modelReading", () => {
  it("prefers the assessment's summary, then the search's why, trimmed", () => {
    expect(modelReading(assessed)).toBe("Un profil solide sur React.");
    expect(modelReading(deterministic)).toBe("Deux phrases du modèle.");
    expect(modelReading({ ...assessed, assessment: { ...assessment, summary: "  " } })).toBe(
      "Deux phrases du modèle.",
    );
  });

  it("is null when no model spoke", () => {
    expect(modelReading({ ...deterministic, why: null })).toBeNull();
    expect(modelReading(null)).toBeNull();
  });
});

/** The senior recruiter's reading, as an assessment carries it since the five dimensions. */
const reading: Assessment = {
  ...assessment,
  modelScore: 74,
  dimensions: {
    role: {
      score: 82.4,
      note: "Développeuse front depuis 2019.",
      evidence: "Lead front, 2021-2024",
    },
    seniority: { score: 65, note: "Cinq ans, un poste de lead.", evidence: null },
    context: { score: 140, note: " ", evidence: "  " },
    trajectory: { score: -5, note: "Progression régulière.", evidence: null },
    achievements: {
      score: 58,
      note: "Deux refontes livrées.",
      evidence: "Refonte du checkout, 2023",
    },
  },
  strengths: ["React depuis 2019", " React depuis 2019 ", "Lead d'une équipe de quatre", ""],
  concerns: ["Anglais B2 seulement", "Les trois derniers postes sont en agence"],
  questions: ["Rôle exact sur la refonte du checkout", "Niveau d'anglais à l'oral"],
  tier: "B",
  rankNote: "Deuxième sur React, derrière le profil lead.",
  challenge: {
    verdict: "doubt",
    reason: "Les trois derniers postes sont en agence",
    evidence: "2019-2024 : agence",
  },
};

const read: MatchResult = { ...deterministic, assessment: reading };

describe("tierOf", () => {
  it("reads the tier the comparative pass gave, and no tier for a value it does not know or an older assessment", () => {
    expect(tierOf(read)).toBe("B");
    expect(tierOf(assessed)).toBeNull();
    expect(tierOf(deterministic)).toBeNull();
    expect(tierOf(null)).toBeNull();
    expect(tierOf({ assessment: { ...reading, tier: "D" as never } })).toBeNull();
  });
});

describe("recruiterReadingOf", () => {
  it("answers null without an assessment", () => {
    expect(recruiterReadingOf(deterministic)).toBeNull();
    expect(recruiterReadingOf(null)).toBeNull();
    expect(recruiterReadingOf(undefined)).toBeNull();
  });

  it("reads the tier, the rank note, the lists cleaned and the dimensions in their fixed order, clamped", () => {
    const result = recruiterReadingOf(read);
    expect(result?.tier).toBe("B");
    expect(result?.rankNote).toBe("Deuxième sur React, derrière le profil lead.");
    expect(result?.strengths).toEqual(["React depuis 2019", "Lead d'une équipe de quatre"]);
    expect(result?.questions).toEqual([
      "Rôle exact sur la refonte du checkout",
      "Niveau d'anglais à l'oral",
    ]);
    expect(result?.dimensions).toEqual([
      {
        dimension: "role",
        score: 82,
        note: "Développeuse front depuis 2019.",
        evidence: "Lead front, 2021-2024",
      },
      { dimension: "seniority", score: 65, note: "Cinq ans, un poste de lead.", evidence: null },
      { dimension: "context", score: 100, note: null, evidence: null },
      { dimension: "trajectory", score: 0, note: "Progression régulière.", evidence: null },
      {
        dimension: "achievements",
        score: 58,
        note: "Deux refontes livrées.",
        evidence: "Refonte du checkout, 2023",
      },
    ]);
  });

  it("marks the second opinion's doubt as the counter-reading, once, after the reservations", () => {
    // The doubt repeats a reservation here: it is shown once, as the counter-reading.
    expect(recruiterReadingOf(read)?.concerns).toEqual([
      { text: "Anglais B2 seulement", challenge: false },
      { text: "Les trois derniers postes sont en agence", challenge: true },
    ]);
    const confirmed = recruiterReadingOf({
      assessment: {
        ...reading,
        challenge: { verdict: "confirmed", reason: "RAS", evidence: null },
      },
    });
    expect(confirmed?.concerns).toEqual([
      { text: "Anglais B2 seulement", challenge: false },
      { text: "Les trois derniers postes sont en agence", challenge: false },
    ]);
    const silent = recruiterReadingOf({
      assessment: {
        ...reading,
        concerns: [],
        challenge: { verdict: "doubt", reason: " ", evidence: null },
      },
    });
    expect(silent?.concerns).toEqual([]);
  });

  it("reads an assessment made before the reading as empty lists", () => {
    const older = recruiterReadingOf(assessed);
    expect(older).toEqual({
      tier: null,
      rankNote: null,
      strengths: [],
      concerns: [],
      questions: [],
      dimensions: [],
    });
  });

  it("guards a stored column that drifted from the schema", () => {
    const odd = {
      assessment: {
        ...assessment,
        dimensions: {
          role: { score: "high" },
          seniority: "70",
          context: null,
          trajectory: { score: 40 },
          extra: { score: 10 },
        },
        strengths: "React",
        concerns: [3, null, { text: "x" }, "Une réserve"],
        questions: null,
        challenge: "doubt",
        rankNote: 4,
      },
    } as unknown as MatchResult;
    expect(recruiterReadingOf(odd)).toEqual({
      tier: null,
      rankNote: null,
      strengths: [],
      concerns: [{ text: "Une réserve", challenge: false }],
      questions: [],
      dimensions: [{ dimension: "trajectory", score: 40, note: null, evidence: null }],
    });
    expect(
      recruiterReadingOf({ assessment: { ...assessment, dimensions: [] as never } })?.dimensions,
    ).toEqual([]);
  });

  it("caps every list at eight points of three hundred characters", () => {
    const many = Array.from({ length: 12 }, (_, i) => `p${i}`.padEnd(400, "x"));
    const result = recruiterReadingOf({
      assessment: { ...reading, strengths: many, concerns: many, questions: many },
    });
    expect(result?.strengths).toHaveLength(8);
    expect(result?.strengths[0]).toHaveLength(300);
    // The doubt comes last even when the reservations fill the list.
    expect(result?.concerns).toHaveLength(8);
    expect(result?.concerns[7]).toEqual({
      text: "Les trois derniers postes sont en agence",
      challenge: true,
    });
    expect(result?.questions).toHaveLength(8);
  });
});
