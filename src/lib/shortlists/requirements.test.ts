import { describe, expect, it } from "vitest";

import type { Assessment, BriefCriterion, MatchResult } from "@/lib/db/types";

import { assessedScore, criteriaOf, modelReading, requirementRowsOf } from "./requirements";

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

describe("requirementRowsOf", () => {
  it("answers no rows without a match", () => {
    expect(requirementRowsOf(criteria, null, "?")).toEqual([]);
    expect(requirementRowsOf(criteria, undefined, "?")).toEqual([]);
  });

  it("maps the deterministic verdicts when no model answered, in the brief's order", () => {
    const rows = requirementRowsOf(criteria, deterministic, "Critère retiré");
    expect(rows.map((row) => [row.id, row.met, row.evidence])).toEqual([
      ["k1", "yes", "React depuis 2019"],
      ["k2", "partial", "B2"],
      ["k3", "unknown", null],
      ["k9", "no", null],
    ]);
    expect(rows[0]?.label).toBe("React");
    expect(rows[0]?.required).toBe(true);
    expect(rows[3]?.label).toBe("Critère retiré");
    expect(rows[3]?.required).toBe(false);
  });

  it("prefers the assessment's answer and falls back to the verdict for a criterion it skipped", () => {
    const rows = requirementRowsOf(criteria, assessed, "Critère retiré");
    expect(rows.map((row) => [row.id, row.met, row.evidence])).toEqual([
      ["k1", "partial", "React, sans version citée"],
      ["k2", "no", null],
      ["k3", "unknown", null],
      ["k9", "no", null],
    ]);
  });

  it("reads a value the schema does not know as not stated, and blank evidence as none", () => {
    const odd = {
      verdicts: [{ criterionId: "k3", verdict: "maybe", evidence: "   " }],
      assessment: {
        decision: "fit",
        score: 90,
        summary: "",
        requirements: [{ criterionId: "k1", met: "sure", evidence: "  " }],
        model: "m",
      },
    } as unknown as MatchResult;
    const rows = requirementRowsOf(criteria, odd, "?");
    expect(rows.map((row) => [row.id, row.met, row.evidence])).toEqual([
      ["k1", "unknown", null],
      ["k2", "unknown", null],
      ["k3", "unknown", null],
    ]);
  });

  it("falls back to the verdicts when a stored assessment's requirements are not a list", () => {
    const drifted = { ...deterministic, assessment: { ...assessment, requirements: {} } } as unknown as MatchResult;
    expect(requirementRowsOf(criteria, drifted, "Critère retiré").map((row) => [row.id, row.met, row.evidence])).toEqual([
      ["k1", "yes", "React depuis 2019"],
      ["k2", "partial", "B2"],
      ["k3", "unknown", null],
      ["k9", "no", null],
    ]);
  });

  it("follows the criteria the match carries, as they were when the analysis ran, before the brief's current ones", () => {
    const snapshot: MatchResult = {
      ...assessed,
      criteria: [
        { id: "k2", kind: "language", label: "Anglais C1 (à l'analyse)", value: "C1", required: true, weight: 2 },
        { id: "k9", kind: "skill", label: "Docker", value: "docker", required: false, weight: 1 },
      ],
    };
    expect(criteriaOf(criteria, snapshot).map((criterion) => criterion.id)).toEqual(["k2", "k9"]);
    const rows = requirementRowsOf(criteria, snapshot, "Critère retiré");
    expect(rows.map((row) => [row.id, row.label, row.met, row.required])).toEqual([
      ["k2", "Anglais C1 (à l'analyse)", "no", true],
      ["k9", "Docker", "no", false],
      // What the match still says about a criterion its snapshot does not hold is kept, never dropped.
      ["k1", "Critère retiré", "partial", false],
    ]);
    // A snapshot the parser cannot read, or an empty one, falls back on the brief's criteria.
    expect(criteriaOf(criteria, { criteria: [] })).toBe(criteria);
    expect(criteriaOf(criteria, { criteria: "nope" } as unknown as MatchResult)).toBe(criteria);
    expect(criteriaOf(criteria, deterministic)).toBe(criteria);
  });

  it("keeps the first answer when the match repeats a criterion", () => {
    const twice: MatchResult = {
      ...deterministic,
      verdicts: [
        { criterionId: "k1", verdict: "missing", evidence: null },
        { criterionId: "k1", verdict: "match", evidence: "later" },
      ],
    };
    expect(requirementRowsOf(criteria, twice, "?")[0]?.met).toBe("no");
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
    expect(modelReading({ ...assessed, assessment: { ...assessment, summary: "  " } })).toBe("Deux phrases du modèle.");
  });

  it("is null when no model spoke", () => {
    expect(modelReading({ ...deterministic, why: null })).toBeNull();
    expect(modelReading(null)).toBeNull();
  });
});
