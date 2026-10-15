/**
 * What leaves for the model (the prompts, the payloads, the rules that
 * bind a brief's reading, the redaction of a person's identity) lives
 * in the shared package (packages/analysis/src/prompts.ts,
 * "@vivier/analysis") and is re-exported here so every web import keeps
 * its path. What stays here is the web app's own zod: the schema of the
 * one reading of a brief (readBriefAnswer), which completeJson()
 * validates the model's answer with. Behaviour unchanged; tested in
 * prompts.test.ts (the schema) and next to the package's module (the
 * rest).
 */
import { z } from "zod";

import { roleProfileAnswer } from "./role-profile";

export {
  ASSESSMENT_PAYLOAD_MAX,
  assessmentPayload,
  assessmentSystemPrompt,
  challengePayload,
  challengeSystemPrompt,
  compactRoleProfile,
  enforceBriefReading,
  EXTRACTION_MAX,
  FULL_POOL_MAX,
  payloadTexts,
  QUERY_TEXT_MAX,
  queryTextOf,
  readBriefPrompt,
  redactIdentity,
  RETRIEVAL_LIMIT,
  ROLE_DEFINITION_MAX,
  ROLE_DEFINITION_QUERY_TERMS,
  roleDefinitionText,
  TEXT_QUERY_MAX_TERMS,
  textQueryOf,
  type AssessmentBrief,
  type AssessmentCandidate,
  type AssessmentExperience,
  type AssessmentPayload,
  type AssessmentProfile,
  type AssessmentRequirement,
  type AssessmentRole,
  type AssessmentRoleProfile,
  type BriefReading,
  type BriefReadingAnswer,
  type BriefText,
  type ChallengeAssessment,
  type ChallengePayload,
} from "@vivier/analysis";

/** One criterion as the model answers it, before the enforcement reads it. */
const criterionAnswer = z.object({
  kind: z.string(),
  label: z.string(),
  value: z.string(),
  required: z.boolean().optional(),
  weight: z.number().optional(),
});

/**
 * The shape the model must answer: the role profile as role-profile.ts
 * asks for it (three missions at least: fewer is not a job
 * understanding, and the call is retried with the error quoted back),
 * the criteria (forty at most here; the enforcement keeps
 * EXTRACTION_MAX) and the sentences about requests it dropped.
 */
export const readBriefAnswer = z.object({
  profile: roleProfileAnswer,
  criteria: z.array(criterionAnswer).max(40),
  warnings: z.array(z.string()).max(10).optional(),
});
