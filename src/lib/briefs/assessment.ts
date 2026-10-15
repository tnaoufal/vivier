/**
 * The assessment's rules live in the shared package
 * (packages/analysis/src/assessment.ts, "@vivier/analysis"), used by the
 * web app and the processor alike; this module re-exports them so every
 * web import keeps its path. Behaviour unchanged; the tests sit next to
 * the package's module. The rows requirementRows() builds are the app
 * shell's RequirementRow shape (src/components/app-shell/requirement-list.tsx).
 */
export {
  applyChallenge,
  ASSESS_BATCH_MAX,
  BORDERLINE_MIN_SCORE,
  bucketResults,
  CHALLENGE_DOUBT_SCORE_CAP,
  compareTiered,
  CONCERNS_MAX,
  decisionOf,
  enforceAssessment,
  EVIDENCE_MAX,
  evidenceGrounded,
  FIT_MIN_SCORE,
  firstMissingRequirement,
  forbiddenSentence,
  GROUNDING_TOKEN_SHARE,
  GROUNDING_WINDOW,
  isTier,
  mentionsCareerBreak,
  mostMissingRequirement,
  NOTE_MAX,
  QUESTIONS_MAX,
  REQUIRED_NO_SCORE_CAP,
  REQUIRED_UNKNOWN_SCORE_CAP,
  requirementRows,
  ROLE_DIMENSION_FIT_MIN,
  ROLE_NO_SCORE_CAP,
  ROLE_PARTIAL_SCORE_CAP,
  ROLE_UNKNOWN_SCORE_CAP,
  STRENGTHS_MAX,
  SUMMARY_MAX,
  tierOf,
  type EnforceOptions,
  type ModelAssessmentAnswer,
  type ModelChallengeAnswer,
  type ModelDimensionAnswer,
  type ResultBuckets,
  type ResultDecision,
  type ResultRequirementRow,
} from "@vivier/analysis";
