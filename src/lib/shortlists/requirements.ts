/**
 * What the card and the drawer of a shortlist item show of its match,
 * read from the match the item carries: the assessed score (the model's,
 * 0..100), one row per requirement for the shared RequirementList (from
 * the assessment when a model answered, else from the deterministic
 * verdicts), the model's sentences, the one line a card shows (the rank
 * note, else the main reservation), and the recruiter's reading when the
 * assessment carries one (the tier of the comparative pass, its
 * strengths, its reservations with the second opinion's doubt marked as
 * such, its interview questions, the five dimensions with their scores).
 * The rows follow the criteria the match carries when it has them (the
 * search's, as they were), else the brief's as given. Pure and tested; a
 * thing the match does not say is "unknown", never a lack, and a field
 * an older assessment lacks is simply absent.
 */
import type { RequirementRow } from "@/components/app-shell/requirement-list";
import { parseCriteria } from "@/lib/briefs/criteria";
import type {
  Assessment,
  AssessmentDimension,
  AssessmentTier,
  BriefCriterion,
  CriterionVerdict,
  MatchResult,
  RequirementMet,
} from "@/lib/db/types";

const VERDICT_TO_MET: Record<CriterionVerdict, RequirementMet> = {
  match: "yes",
  partial: "partial",
  missing: "no",
  not_stated: "unknown",
};

const MET_VALUES: readonly RequirementMet[] = ["yes", "partial", "no", "unknown"];

const VERDICTS: readonly CriterionVerdict[] = ["match", "partial", "missing", "not_stated"];

/** A verdict the deterministic pass may store; anything else is not read as a lack. */
export function isVerdict(value: unknown): value is CriterionVerdict {
  return typeof value === "string" && (VERDICTS as readonly string[]).includes(value);
}

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

/** The model's answer as the row stores it, else "unknown": a value the schema does not know is not read as a lack. */
function asMet(value: unknown): RequirementMet {
  return typeof value === "string" && (MET_VALUES as readonly string[]).includes(value)
    ? (value as RequirementMet)
    : "unknown";
}

function metOfVerdict(value: unknown): RequirementMet {
  return isVerdict(value) ? VERDICT_TO_MET[value] : "unknown";
}

function evidenceOf(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
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

/**
 * One row per criterion (the match's own when it carries them, else the
 * brief's), in that order: the assessment's answer when the model gave
 * one, else the deterministic verdict (found → yes, in part → partial,
 * absent → no, not stated → unknown), else unknown. A requirement the
 * match still speaks about although the criteria dropped it is kept at
 * the end under `unknownLabel`, so nothing the match says disappears.
 * No match, no rows.
 */
export function requirementRowsOf(
  criteria: readonly BriefCriterion[],
  match: MatchLike | null | undefined,
  unknownLabel: string,
): RequirementRow[] {
  if (!match) return [];
  const assessed = new Map<string, { met: unknown; evidence: unknown }>();
  // Guarded like the verdicts: a stored assessment that drifted from the schema must not take the drawer down.
  const requirements = match.assessment?.requirements;
  for (const row of Array.isArray(requirements) ? requirements : []) {
    if (row && typeof row.criterionId === "string" && !assessed.has(row.criterionId))
      assessed.set(row.criterionId, row);
  }
  const verdicts = new Map<string, { verdict: unknown; evidence: unknown }>();
  for (const row of Array.isArray(match.verdicts) ? match.verdicts : []) {
    if (row && typeof row.criterionId === "string" && !verdicts.has(row.criterionId))
      verdicts.set(row.criterionId, row);
  }

  const rows: RequirementRow[] = [];
  const seen = new Set<string>();
  for (const criterion of criteriaOf(criteria, match)) {
    seen.add(criterion.id);
    const answer = assessed.get(criterion.id);
    const verdict = verdicts.get(criterion.id);
    if (answer) {
      rows.push({
        id: criterion.id,
        label: criterion.label,
        required: criterion.required,
        met: asMet(answer.met),
        evidence: evidenceOf(answer.evidence),
      });
    } else {
      rows.push({
        id: criterion.id,
        label: criterion.label,
        required: criterion.required,
        met: verdict ? metOfVerdict(verdict.verdict) : "unknown",
        evidence: verdict ? evidenceOf(verdict.evidence) : null,
      });
    }
  }
  for (const [id, answer] of assessed) {
    if (seen.has(id)) continue;
    seen.add(id);
    rows.push({
      id,
      label: unknownLabel,
      required: false,
      met: asMet(answer.met),
      evidence: evidenceOf(answer.evidence),
    });
  }
  for (const [id, verdict] of verdicts) {
    if (seen.has(id)) continue;
    seen.add(id);
    rows.push({
      id,
      label: unknownLabel,
      required: false,
      met: metOfVerdict(verdict.verdict),
      evidence: evidenceOf(verdict.evidence),
    });
  }
  return rows;
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

/** True when the reading has anything to show: a list, a dimension or a rank note (the tier shows on its own). */
export function hasReading(reading: RecruiterReading | null): reading is RecruiterReading {
  return (
    reading !== null &&
    (reading.strengths.length > 0 ||
      reading.concerns.length > 0 ||
      reading.questions.length > 0 ||
      reading.dimensions.length > 0 ||
      reading.rankNote !== null)
  );
}

/**
 * The one line a card shows under the name: the comparative pass's note
 * on this rank among the others, else the first reservation (the
 * counter-reading's when it is the only one); null when the assessment
 * says neither, and the card then shows no line rather than a dash.
 */
export function cardLine(match: Pick<MatchResult, "assessment"> | null | undefined): string | null {
  const reading = recruiterReadingOf(match);
  if (!reading) return null;
  return reading.rankNote ?? reading.concerns[0]?.text ?? null;
}
