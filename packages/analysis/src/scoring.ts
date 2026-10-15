/**
 * The composite score of a screening: what a senior recruiter weighs
 * when they read a profile for a job, as one number the gates of
 * assessment.ts then bound. The métier weighs most (0.40); the
 * seniority and the context of the positions 0.15 each; the track
 * record (the mean of the trajectory and the achievements) 0.15; and
 * the weighted coverage of the brief's other requirements 0.15. A
 * dimension the model did not score counts as neutral (50): silence is
 * never a lack. Pure, tested in scoring.test.ts; the weights are
 * exported so the page can say what the score is made of.
 */
import type {
  AssessmentDimension,
  BriefCriterion,
  RequirementAssessment,
  RequirementMet,
} from "./types.js";

export const WEIGHT_ROLE = 0.4;
export const WEIGHT_SENIORITY = 0.15;
export const WEIGHT_CONTEXT = 0.15;
/** The mean of the trajectory and the achievements. */
export const WEIGHT_TRACK = 0.15;
export const WEIGHT_REQUIREMENTS = 0.15;
/** The score of a dimension nobody scored, and the coverage of a brief nothing is evaluable in. */
export const NEUTRAL_SCORE = 50;

export const DIMENSIONS: readonly AssessmentDimension[] = [
  "role",
  "seniority",
  "context",
  "trajectory",
  "achievements",
];

/** What each dimension weighs in the composite, for the page to say so next to its meter (the two of the track record share WEIGHT_TRACK). */
export const DIMENSION_WEIGHTS: Record<AssessmentDimension, number> = {
  role: WEIGHT_ROLE,
  seniority: WEIGHT_SENIORITY,
  context: WEIGHT_CONTEXT,
  trajectory: WEIGHT_TRACK / 2,
  achievements: WEIGHT_TRACK / 2,
};

/** What one requirement's answer is worth in the coverage; "unknown" is left out, never zero. */
export const MET_POINTS: Record<Exclude<RequirementMet, "unknown">, number> = {
  yes: 1,
  partial: 0.5,
  no: 0,
};

export interface CompositeInput {
  role?: number | null | undefined;
  seniority?: number | null | undefined;
  context?: number | null | undefined;
  trajectory?: number | null | undefined;
  achievements?: number | null | undefined;
  /** 0..100, from requirementsCoverage(). */
  requirementsCoverage: number;
}

/** A score in 0..100 from any number (rounded, clamped); null for anything else. */
export function dimensionScore(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function scoreOrNeutral(value: number | null | undefined): number {
  return dimensionScore(value) ?? NEUTRAL_SCORE;
}

/**
 * The weighted coverage of the requirements other than the role, 0..100:
 * yes 1, partial 0.5, no 0, weighted 1..3 as the brief says; a
 * requirement at "unknown" is left out (the CV says nothing, which is
 * not a lack); 50 when nothing is evaluable.
 */
export function requirementsCoverage(
  criteria: readonly BriefCriterion[],
  requirements: readonly RequirementAssessment[],
): number {
  const answered = new Map(requirements.map((row) => [row.criterionId, row.met] as const));
  let weightSum = 0;
  let pointSum = 0;
  for (const criterion of criteria) {
    if (criterion.kind === "role") continue;
    const met = answered.get(criterion.id);
    if (!met || met === "unknown") continue;
    weightSum += criterion.weight;
    pointSum += criterion.weight * MET_POINTS[met];
  }
  return weightSum > 0 ? Math.round((100 * pointSum) / weightSum) : NEUTRAL_SCORE;
}

/**
 * role 0.40 + seniority 0.15 + context 0.15 + mean(trajectory,
 * achievements) 0.15 + requirementsCoverage 0.15, rounded to a whole
 * number in 0..100; a missing dimension is neutral (50).
 */
export function compositeScore(input: CompositeInput): number {
  const track = (scoreOrNeutral(input.trajectory) + scoreOrNeutral(input.achievements)) / 2;
  const total =
    WEIGHT_ROLE * scoreOrNeutral(input.role) +
    WEIGHT_SENIORITY * scoreOrNeutral(input.seniority) +
    WEIGHT_CONTEXT * scoreOrNeutral(input.context) +
    WEIGHT_TRACK * track +
    WEIGHT_REQUIREMENTS * scoreOrNeutral(input.requirementsCoverage);
  return Math.max(0, Math.min(100, Math.round(total)));
}
