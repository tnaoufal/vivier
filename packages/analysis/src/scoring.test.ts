import { describe, expect, it } from "vitest";

import type { BriefCriterion, RequirementAssessment } from "./types.js";

import {
  compositeScore,
  DIMENSION_WEIGHTS,
  dimensionScore,
  DIMENSIONS,
  MET_POINTS,
  NEUTRAL_SCORE,
  requirementsCoverage,
  WEIGHT_CONTEXT,
  WEIGHT_REQUIREMENTS,
  WEIGHT_ROLE,
  WEIGHT_SENIORITY,
  WEIGHT_TRACK,
} from "./scoring.js";

const criteria: BriefCriterion[] = [
  {
    id: "role",
    kind: "role",
    label: "Business Developer",
    value: "Commercial…",
    required: true,
    weight: 3,
  },
  {
    id: "skill",
    kind: "skill",
    label: "Contrôle de gestion",
    value: "contrôle de gestion",
    required: true,
    weight: 3,
  },
  {
    id: "lang",
    kind: "language",
    label: "Anglais C1",
    value: "anglais C1",
    required: true,
    weight: 2,
  },
  { id: "sap", kind: "skill", label: "SAP", value: "sap", required: false, weight: 1 },
];

function rows(
  skill: RequirementAssessment["met"],
  lang: RequirementAssessment["met"],
  sap: RequirementAssessment["met"],
): RequirementAssessment[] {
  return [
    { criterionId: "role", met: "yes", evidence: "x" },
    { criterionId: "skill", met: skill, evidence: null },
    { criterionId: "lang", met: lang, evidence: null },
    { criterionId: "sap", met: sap, evidence: null },
  ];
}

describe("weights", () => {
  it("add up to one, the métier weighing most, and name the five dimensions", () => {
    expect(
      WEIGHT_ROLE + WEIGHT_SENIORITY + WEIGHT_CONTEXT + WEIGHT_TRACK + WEIGHT_REQUIREMENTS,
    ).toBeCloseTo(1);
    expect(WEIGHT_ROLE).toBe(0.4);
    expect(WEIGHT_ROLE).toBeGreaterThan(WEIGHT_SENIORITY + WEIGHT_CONTEXT);
    expect(DIMENSIONS).toEqual(["role", "seniority", "context", "trajectory", "achievements"]);
    expect(MET_POINTS).toEqual({ yes: 1, partial: 0.5, no: 0 });
    expect(NEUTRAL_SCORE).toBe(50);
  });

  it("say per dimension what the page shows next to each meter, the track record split in two", () => {
    expect(DIMENSION_WEIGHTS.role).toBe(WEIGHT_ROLE);
    expect(DIMENSION_WEIGHTS.seniority).toBe(WEIGHT_SENIORITY);
    expect(DIMENSION_WEIGHTS.context).toBe(WEIGHT_CONTEXT);
    expect(DIMENSION_WEIGHTS.trajectory).toBeCloseTo(0.075);
    expect(DIMENSION_WEIGHTS.achievements).toBeCloseTo(0.075);
    expect(
      DIMENSIONS.reduce((sum, dimension) => sum + DIMENSION_WEIGHTS[dimension], 0) +
        WEIGHT_REQUIREMENTS,
    ).toBeCloseTo(1);
  });
});

describe("compositeScore", () => {
  it("is 100 for a perfect profile, 0 for nothing, and weighs each dimension as stated", () => {
    const full = {
      role: 100,
      seniority: 100,
      context: 100,
      trajectory: 100,
      achievements: 100,
      requirementsCoverage: 100,
    };
    expect(compositeScore(full)).toBe(100);
    expect(
      compositeScore({
        role: 0,
        seniority: 0,
        context: 0,
        trajectory: 0,
        achievements: 0,
        requirementsCoverage: 0,
      }),
    ).toBe(0);
    // The métier alone at 100, everything else neutral: 40 + 7.5 + 7.5 + 7.5 + 7.5.
    expect(
      compositeScore({
        role: 100,
        seniority: 50,
        context: 50,
        trajectory: 50,
        achievements: 50,
        requirementsCoverage: 50,
      }),
    ).toBe(70);
    // 36 + 12 + 7.5 + 0.15 * 65 + 15 = 80.25.
    expect(
      compositeScore({
        role: 90,
        seniority: 80,
        context: 50,
        trajectory: 70,
        achievements: 60,
        requirementsCoverage: 100,
      }),
    ).toBe(80);
  });

  it("averages the trajectory and the achievements before weighing them", () => {
    const base = { role: 50, seniority: 50, context: 50, requirementsCoverage: 50 };
    expect(compositeScore({ ...base, trajectory: 100, achievements: 0 })).toBe(
      compositeScore({ ...base, trajectory: 50, achievements: 50 }),
    );
    // 20 + 7.5 + 7.5 + 15 + 7.5 = 57.5, rounded up.
    expect(compositeScore({ ...base, trajectory: 100, achievements: 100 })).toBe(58);
  });

  it("rounds to a whole number and clamps what the model answered", () => {
    // 33.2 + 7.5 + 7.5 + 9.75 + 15 = 72.95.
    expect(
      compositeScore({
        role: 83,
        seniority: 50,
        context: 50,
        trajectory: 60,
        achievements: 70,
        requirementsCoverage: 100,
      }),
    ).toBe(73);
    expect(
      compositeScore({
        role: 150,
        seniority: 100,
        context: 100,
        trajectory: 100,
        achievements: 100,
        requirementsCoverage: 100,
      }),
    ).toBe(100);
    expect(
      compositeScore({
        role: -40,
        seniority: 0,
        context: 0,
        trajectory: 0,
        achievements: 0,
        requirementsCoverage: 0,
      }),
    ).toBe(0);
    expect(
      compositeScore({
        role: 71.6,
        seniority: 71.6,
        context: 71.6,
        trajectory: 71.6,
        achievements: 71.6,
        requirementsCoverage: 71.6,
      }),
    ).toBe(72);
  });

  it("counts a missing dimension as neutral, never as a lack", () => {
    expect(compositeScore({ requirementsCoverage: 50 })).toBe(50);
    expect(compositeScore({ role: 100, requirementsCoverage: 50 })).toBe(70);
    expect(
      compositeScore({
        role: null,
        seniority: undefined,
        context: Number.NaN,
        requirementsCoverage: 50,
      }),
    ).toBe(50);
    // 85 + 0.15 × 50 = 92.5, rounded up.
    expect(
      compositeScore({
        role: 100,
        seniority: 100,
        context: 100,
        trajectory: 100,
        achievements: 100,
        requirementsCoverage: Number.NaN,
      }),
    ).toBe(93);
  });
});

describe("dimensionScore", () => {
  it("rounds and clamps a number, null for anything else", () => {
    expect(dimensionScore(71.6)).toBe(72);
    expect(dimensionScore(140)).toBe(100);
    expect(dimensionScore(-3)).toBe(0);
    expect(dimensionScore(Number.NaN)).toBeNull();
    expect(dimensionScore("80")).toBeNull();
    expect(dimensionScore(null)).toBeNull();
    expect(dimensionScore(undefined)).toBeNull();
  });
});

describe("requirementsCoverage", () => {
  it("weighs yes, partial and no by the criterion's weight, the role left out", () => {
    // (3 × 1 + 2 × 0.5 + 1 × 0) / 6 = 66.7.
    expect(requirementsCoverage(criteria, rows("yes", "partial", "no"))).toBe(67);
    expect(requirementsCoverage(criteria, rows("yes", "yes", "yes"))).toBe(100);
    expect(requirementsCoverage(criteria, rows("no", "no", "no"))).toBe(0);
    // (3 × 1 + 2 × 0.5 + 1 × 1) / 6 = 83.3.
    expect(requirementsCoverage(criteria, rows("yes", "partial", "yes"))).toBe(83);
  });

  it("leaves an unknown out instead of counting it against the profile, and answers neutral when nothing is evaluable", () => {
    expect(requirementsCoverage(criteria, rows("yes", "unknown", "unknown"))).toBe(100);
    expect(requirementsCoverage(criteria, rows("unknown", "unknown", "unknown"))).toBe(
      NEUTRAL_SCORE,
    );
    expect(
      requirementsCoverage(criteria, [{ criterionId: "role", met: "yes", evidence: "x" }]),
    ).toBe(NEUTRAL_SCORE);
    expect(requirementsCoverage([], [])).toBe(NEUTRAL_SCORE);
    // A row about a criterion the brief no longer has is ignored.
    expect(
      requirementsCoverage(criteria, [{ criterionId: "ghost", met: "no", evidence: null }]),
    ).toBe(NEUTRAL_SCORE);
  });
});
