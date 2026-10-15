/**
 * What the brief page's rows and reading pane show of a match (a result
 * of the analysis, or the one a shortlist item carries): the assessed
 * score (the model's, 0..100), the criteria its requirement rows follow
 * (the match's own when it carries them, the search's as they were,
 * else the brief's as given), the model's sentences, and the
 * recruiter's reading when the assessment carries one (the tier of the
 * comparative pass, its strengths, its reservations with the second
 * opinion's doubt marked as such, its interview questions, the five
 * dimensions with their scores). Pure and tested; a field an older
 * assessment lacks is simply absent.
 */
import { parseCriteria } from "@/lib/briefs/criteria";
import type {
  Assessment,
  AssessmentDimension,
  AssessmentTier,
  BriefCriterion,
  MatchResult,
} from "@/lib/db/types";

export type MatchLike = Pick<MatchResult, "verdicts" | "assessment"> &
  Partial<Pick<MatchResult, "criteria">>;

/** The criteria the rows follow: the match's own snapshot when it carries one, else the brief's as given. */
export function criteriaOf(
  criteria: readonly BriefCriterion[],
  match: Pick<MatchLike, "criteria">,
): readonly BriefCriterion[] {
  const own = parseCriteria(match.criteria);
  return own.length ? own : criteria;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** The assessment's fit score 0..100, rounded; null when no model assessed the item (the ring then shows a dash). */
export function assessedScore(
  match: Pick<MatchResult, "assessment"> | null | undefined,
): number | null {
  const score = match?.assessment?.score;
  if (typeof score !== "number" || !Number.isFinite(score)) return null;
  return Math.round(Math.max(0, Math.min(100, score)));
}

/** The model's sentences on the match: the assessment's summary, else the search's "why"; null when no model spoke. */
export function modelReading(
  match: Pick<MatchResult, "why" | "assessment"> | null | undefined,
): string | null {
  if (!match) return null;
  return text(match.assessment?.summary) ?? text(match.why);
}

// ---------------------------------------------------------------------
// the recruiter's reading
// ---------------------------------------------------------------------

/** The five dimensions in the order the drawer shows them. */
export const DIMENSIONS: readonly AssessmentDimension[] = [
  "role",
  "seniority",
  "context",
  "trajectory",
  "achievements",
];

const TIERS: readonly AssessmentTier[] = ["A", "B", "C"];

/** The most points of one list the drawer shows. */
export const READING_POINTS_MAX = 8;
export const READING_POINT_MAX = 300;

export interface DimensionReading {
  dimension: AssessmentDimension;
  /** 0..100, rounded. */
  score: number;
  note: string | null;
  evidence: string | null;
}

export interface ConcernPoint {
  text: string;
  /** True for the second opinion's reason: the drawer marks it as the counter-reading, apart from the first pass's reservations. */
  challenge: boolean;
}

export interface RecruiterReading {
  tier: AssessmentTier | null;
  /** The comparative pass's line on this rank among the others; null without one. */
  rankNote: string | null;
  strengths: string[];
  concerns: ConcernPoint[];
  questions: string[];
  /** Only the dimensions the assessment scored, in the fixed order; empty for an older assessment. */
  dimensions: DimensionReading[];
}

/** The tier the comparative pass gave, or null: a value the schema does not know is no tier. */
export function tierOf(
  match: Pick<MatchResult, "assessment"> | null | undefined,
): AssessmentTier | null {
  const tier: unknown = match?.assessment?.tier;
  return typeof tier === "string" && (TIERS as readonly string[]).includes(tier)
    ? (tier as AssessmentTier)
    : null;
}

/** A stored list as clean points: trimmed, clipped, each once, blanks and non-strings dropped; empty when it is not a list. */
function pointsOf(value: unknown, max: number = READING_POINTS_MAX): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const entry of value) {
    const point =
      typeof entry === "string"
        ? entry.replace(/\s+/g, " ").trim().slice(0, READING_POINT_MAX)
        : "";
    if (point && !out.includes(point)) out.push(point);
    if (out.length >= max) break;
  }
  return out;
}

/** The second opinion's reason, when it doubts the profile; null when it confirmed, said nothing, or never ran. */
function doubtOf(assessment: Pick<Assessment, "challenge">): string | null {
  const challenge: unknown = assessment.challenge;
  if (!challenge || typeof challenge !== "object") return null;
  const row = challenge as Record<string, unknown>;
  if (row["verdict"] !== "doubt") return null;
  return pointsOf([row["reason"]], 1)[0] ?? null;
}

/** The dimensions the assessment scored, guarded: a stored column that drifted from the schema costs the row, never the drawer. */
function dimensionsOf(assessment: Pick<Assessment, "dimensions">): DimensionReading[] {
  const stored: unknown = assessment.dimensions;
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return [];
  const table = stored as Record<string, unknown>;
  const out: DimensionReading[] = [];
  for (const dimension of DIMENSIONS) {
    const entry = table[dimension];
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    const score = row["score"];
    if (typeof score !== "number" || !Number.isFinite(score)) continue;
    out.push({
      dimension,
      score: Math.round(Math.max(0, Math.min(100, score))),
      note: text(row["note"]),
      evidence: text(row["evidence"]),
    });
  }
  return out;
}

/**
 * The recruiter's reading of the match, read off the assessment: the
 * tier and the rank note of the comparative pass, the strengths, the
 * reservations followed by the second opinion's doubt (marked), the
 * interview questions, the scored dimensions. Null without an
 * assessment; every list empty for an assessment made before the
 * reading, which the drawer then shows nothing of.
 */
export function recruiterReadingOf(
  match: Pick<MatchResult, "assessment"> | null | undefined,
): RecruiterReading | null {
  const assessment = match?.assessment;
  if (!assessment || typeof assessment !== "object") return null;
  const doubt = doubtOf(assessment);
  // The doubt keeps its place at the end even when the first pass fills the list: a counter-reading is never the point cut.
  const concerns: ConcernPoint[] = pointsOf(assessment.concerns)
    .filter((point) => point !== doubt)
    .slice(0, doubt ? READING_POINTS_MAX - 1 : READING_POINTS_MAX)
    .map((point) => ({ text: point, challenge: false }));
  if (doubt) concerns.push({ text: doubt, challenge: true });
  return {
    tier: tierOf(match),
    rankNote: text(assessment.rankNote),
    strengths: pointsOf(assessment.strengths),
    concerns,
    questions: pointsOf(assessment.questions),
    dimensions: dimensionsOf(assessment),
  };
}
