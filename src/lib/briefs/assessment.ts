/**
 * What the model's assessment of a candidate becomes once it is read
 * here: every requirement of the brief gets a row, the evidence and the
 * summary are clipped, and the decision and score obey the brief's
 * required requirements whatever the model answered (a required
 * requirement clearly not met is a no_fit, one the CV says nothing
 * about is at most borderline). Pure: no model, no data access; every
 * rule is stated once and tested in assessment.test.ts. The rest of the
 * module reads assessed results for the panel: buckets by decision, the
 * requirement most often missing, the rows a RequirementList shows, with
 * the deterministic verdicts as the fallback when no model answered.
 */
import type { RequirementRow } from "@/components/app-shell/requirement-list";
import type {
  Assessment,
  AssessmentDecision,
  BriefCriterion,
  CriterionResult,
  CriterionVerdict,
  MatchResult,
  RequirementAssessment,
  RequirementMet,
} from "@/lib/db/types";

/** The most candidates one assessment call reads: the browser sends batches of this size, one after the other. */
export const ASSESS_BATCH_MAX = 6;
export const EVIDENCE_MAX = 200;
export const SUMMARY_MAX = 600;
/** A "fit" needs at least this score. */
export const FIT_MIN_SCORE = 70;
/** A "borderline" needs at least this score; below it the profile is a no_fit. */
export const BORDERLINE_MIN_SCORE = 45;
/** A required requirement at "no" caps the score here (and forces no_fit). */
export const REQUIRED_NO_SCORE_CAP = 39;
/** A required requirement at "unknown" caps the score here (and the decision at borderline). */
export const REQUIRED_UNKNOWN_SCORE_CAP = 69;

/** The model's answer as the schema lets it through, before any rule applies. */
export interface ModelAssessmentAnswer {
  requirements: { criterionId: string; met: string; evidence?: string | null | undefined }[];
  decision: string;
  score: number;
  summary: string;
}

export type ResultDecision = AssessmentDecision | "unassessed";

const MET_VALUES: readonly RequirementMet[] = ["yes", "partial", "no", "unknown"];
const DECISIONS: readonly AssessmentDecision[] = ["fit", "borderline", "no_fit"];

function isMet(value: string): value is RequirementMet {
  return (MET_VALUES as readonly string[]).includes(value);
}

function isDecision(value: string): value is AssessmentDecision {
  return (DECISIONS as readonly string[]).includes(value);
}

function clip(value: string | null | undefined, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

/** The decision a score alone would give, for a model that answered none the schema knows. */
function decisionFromScore(score: number): AssessmentDecision {
  if (score >= FIT_MIN_SCORE) return "fit";
  if (score >= BORDERLINE_MIN_SCORE) return "borderline";
  return "no_fit";
}

/**
 * One requirement row from the model's entry for a criterion, with the
 * deterministic verdict of the same criterion as a second reading:
 * - a "yes" without evidence becomes "partial" (a claim the model cannot
 *   quote is not a met requirement);
 * - a "yes" on a required criterion the deterministic pass found missing
 *   with evidence (a language absent from a stated list, years clearly
 *   below the threshold, a location that contradicts) becomes "partial"
 *   with that evidence appended: two readings disagree, the person
 *   decides, and the profile lands in "to check" instead of "fit";
 * - a "no" without evidence becomes "unknown", unless the deterministic
 *   pass found the requirement missing with evidence of its own (a
 *   language absent from the listed ones, years below the threshold, a
 *   place that contradicts): that evidence is then shown with the "no".
 *   Silence read as a lack is the one thing the prompt forbids, and a
 *   profile is never set aside with nothing to show for it.
 */
function requirementOf(
  criterion: BriefCriterion,
  answer: ModelAssessmentAnswer["requirements"][number] | undefined,
  deterministic: CriterionResult | undefined,
): RequirementAssessment {
  if (!answer) return { criterionId: criterion.id, met: "unknown", evidence: null };
  let met: RequirementMet = isMet(answer.met) ? answer.met : "unknown";
  let evidence = clip(answer.evidence, EVIDENCE_MAX);
  if (met === "unknown") evidence = null;
  const saidYes = met === "yes";
  if (saidYes && !evidence) met = "partial";
  if (met === "no" && !evidence) {
    if (deterministic?.verdict === "missing" && deterministic.evidence) evidence = clip(deterministic.evidence, EVIDENCE_MAX);
    else met = "unknown";
  }
  if (saidYes && criterion.required && deterministic?.verdict === "missing" && deterministic.evidence) {
    met = "partial";
    evidence = clip([evidence, deterministic.evidence].filter((part): part is string => Boolean(part)).join(" · "), EVIDENCE_MAX);
  }
  return { criterionId: criterion.id, met, evidence };
}

/**
 * The assessment stored for a result: the model's answer made to obey
 * the brief. Every criterion gets a row (one the model skipped is
 * "unknown"); the summary is clipped; then the decision and the score:
 * a required requirement at "no" forces no_fit and caps the score at 39;
 * a required requirement at "unknown" caps the decision at borderline
 * and the score at 69; a required requirement at "partial" caps the
 * decision at borderline (met in part is not met); "fit" needs a score
 * of 70 or more, "borderline" 45 or more, otherwise no_fit. The model's
 * own no_fit or borderline is never raised: it is allowed to be stricter.
 */
export function enforceAssessment(
  criteria: readonly BriefCriterion[],
  deterministicVerdicts: readonly CriterionResult[],
  modelAnswer: ModelAssessmentAnswer,
  model: string,
): Assessment {
  const answered = new Map<string, ModelAssessmentAnswer["requirements"][number]>();
  for (const entry of modelAnswer.requirements) {
    if (!answered.has(entry.criterionId)) answered.set(entry.criterionId, entry);
  }
  const verdicts = new Map(deterministicVerdicts.map((verdict) => [verdict.criterionId, verdict] as const));
  const requirements = criteria.map((criterion) =>
    requirementOf(criterion, answered.get(criterion.id), verdicts.get(criterion.id)),
  );
  const required = (met: RequirementMet) =>
    criteria.some((criterion, index) => criterion.required && requirements[index]?.met === met);
  const requiredNo = required("no");
  const requiredUnknown = required("unknown");
  const requiredPartial = required("partial");

  let score = clampScore(modelAnswer.score);
  let decision: AssessmentDecision = isDecision(modelAnswer.decision) ? modelAnswer.decision : decisionFromScore(score);
  if (requiredNo) {
    decision = "no_fit";
    score = Math.min(score, REQUIRED_NO_SCORE_CAP);
  } else if (requiredUnknown) {
    score = Math.min(score, REQUIRED_UNKNOWN_SCORE_CAP);
    if (decision === "fit") decision = "borderline";
  } else if (requiredPartial && decision === "fit") {
    decision = "borderline";
  }
  if (decision === "fit" && score < FIT_MIN_SCORE) decision = "borderline";
  if (decision === "borderline" && score < BORDERLINE_MIN_SCORE) decision = "no_fit";

  return {
    decision,
    score,
    summary: clip(modelAnswer.summary, SUMMARY_MAX) ?? "",
    requirements,
    model,
  };
}

// ---------------------------------------------------------------------
// reading assessed results
// ---------------------------------------------------------------------

/** The decision of a result: the assessment's, or "unassessed" when no model answered. */
export function decisionOf(result: Pick<MatchResult, "assessment">): ResultDecision {
  return result.assessment?.decision ?? "unassessed";
}

export interface ResultBuckets {
  fit: MatchResult[];
  borderline: MatchResult[];
  noFit: MatchResult[];
  unassessed: MatchResult[];
}

/** Assessed score first (highest first), then the deterministic score, then the order given. */
function compareAssessed(a: MatchResult, b: MatchResult): number {
  const sa = a.assessment?.score ?? 0;
  const sb = b.assessment?.score ?? 0;
  if (sa !== sb) return sb - sa;
  return b.score - a.score;
}

/**
 * The results by decision: fit, borderline and no_fit sorted by the
 * assessment's score then the deterministic one; the unassessed kept in
 * the order given (the deterministic ranking).
 */
export function bucketResults(results: readonly MatchResult[]): ResultBuckets {
  const buckets: ResultBuckets = { fit: [], borderline: [], noFit: [], unassessed: [] };
  for (const result of results) {
    switch (decisionOf(result)) {
      case "fit":
        buckets.fit.push(result);
        break;
      case "borderline":
        buckets.borderline.push(result);
        break;
      case "no_fit":
        buckets.noFit.push(result);
        break;
      default:
        buckets.unassessed.push(result);
    }
  }
  buckets.fit.sort(compareAssessed);
  buckets.borderline.sort(compareAssessed);
  buckets.noFit.sort(compareAssessed);
  return buckets;
}

/**
 * The required criterion most often at "no" across the assessed results
 * (the first in the brief's order on a tie); null when no assessed
 * result has a required requirement at "no".
 */
export function mostMissingRequirement(
  criteria: readonly BriefCriterion[],
  results: readonly MatchResult[],
): BriefCriterion | null {
  const counts = new Map<string, number>();
  for (const result of results) {
    for (const requirement of result.assessment?.requirements ?? []) {
      if (requirement.met === "no") counts.set(requirement.criterionId, (counts.get(requirement.criterionId) ?? 0) + 1);
    }
  }
  let best: BriefCriterion | null = null;
  let bestCount = 0;
  for (const criterion of criteria) {
    if (!criterion.required) continue;
    const count = counts.get(criterion.id) ?? 0;
    if (count > bestCount) {
      best = criterion;
      bestCount = count;
    }
  }
  return best;
}

const VERDICT_TO_MET: Record<CriterionVerdict, RequirementMet> = {
  match: "yes",
  partial: "partial",
  missing: "no",
  not_stated: "unknown",
};

/**
 * One row per criterion for the shared RequirementList: from the
 * assessment when the model answered, else from the deterministic
 * verdicts (found → yes, in part → partial, absent → no, not stated →
 * unknown); a criterion neither one speaks about is unknown.
 */
export function requirementRows(
  criteria: readonly BriefCriterion[],
  result: Pick<MatchResult, "verdicts" | "assessment">,
): RequirementRow[] {
  const assessed = new Map((result.assessment?.requirements ?? []).map((row) => [row.criterionId, row] as const));
  const verdicts = new Map(result.verdicts.map((verdict) => [verdict.criterionId, verdict] as const));
  return criteria.map((criterion) => {
    const row = assessed.get(criterion.id);
    if (row) {
      return { id: criterion.id, label: criterion.label, required: criterion.required, met: row.met, evidence: row.evidence };
    }
    const verdict = verdicts.get(criterion.id);
    return {
      id: criterion.id,
      label: criterion.label,
      required: criterion.required,
      met: verdict ? VERDICT_TO_MET[verdict.verdict] : "unknown",
      evidence: verdict?.evidence ?? null,
    };
  });
}

/** The first required requirement at "no" of an assessed result: the reason a card in "set aside" shows. */
export function firstMissingRequirement(
  criteria: readonly BriefCriterion[],
  result: Pick<MatchResult, "assessment">,
): BriefCriterion | null {
  const assessment = result.assessment;
  if (!assessment) return null;
  const rows = new Map(assessment.requirements.map((row) => [row.criterionId, row.met] as const));
  return criteria.find((criterion) => criterion.required && rows.get(criterion.id) === "no") ?? null;
}
