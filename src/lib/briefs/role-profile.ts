/**
 * The role profile's pure side (the clean-up, the guard, the ceiling on
 * years, the role's definition, the hash of the brief's text, the empty
 * profile) lives in the shared package
 * (packages/analysis/src/role-profile.ts, "@vivier/analysis") and is
 * re-exported here so every web import keeps its path. What stays here
 * is the web app's own zod: the schema of the model's answer
 * (roleProfileAnswer, read by readBriefAnswer) and the parser of a
 * stored briefs.role_profile column (a damaged or foreign value is
 * null, never a crash). Behaviour unchanged; tested in
 * role-profile.test.ts (the schema and the parser) and next to the
 * package's module (the rest).
 */
import { z } from "zod";

import {
  cleanRoleProfile,
  ROLE_MISSIONS_MIN,
  ROLE_PROFILE_ITEM_MAX,
  ROLE_PROFILE_LIST_MAX,
  ROLE_PROFILE_TEXT_MAX,
  type RoleProfile,
} from "@vivier/analysis";

export {
  briefSourceHash,
  cleanRoleProfile,
  clipList,
  DEFAULT_SENIORITY,
  emptyRoleProfile,
  fnv1a32,
  guardRoleProfile,
  isSeniority,
  jobTitleOf,
  needsDerivation,
  protectedRoleText,
  ROLE_ASSUMPTIONS_MAX,
  ROLE_MISSIONS_MAX,
  ROLE_MISSIONS_MIN,
  ROLE_PROFILE_BRIEF_MAX,
  ROLE_PROFILE_ITEM_MAX,
  ROLE_PROFILE_LIST_MAX,
  ROLE_PROFILE_TEXT_MAX,
  ROLE_SENIORITIES,
  ROLE_YEARS_MAX,
  roleDefinitionOf,
  statesMaximumYears,
  type RoleContextAnswer,
  type RoleProfileAnswer,
  type RoleProfileInput,
} from "@vivier/analysis";

const LIST_CAP = ROLE_PROFILE_LIST_MAX * 3;
const TEXT_CAP = ROLE_PROFILE_TEXT_MAX * 4;

const answerList = z.array(z.string().max(ROLE_PROFILE_ITEM_MAX * 4)).max(LIST_CAP);
const answerText = z.string().max(TEXT_CAP).nullable().optional();

/**
 * The shape the model must answer: generous caps (the clean-up clips),
 * three missions at least (fewer is not a job understanding: the call
 * is retried with the error quoted back, then fails and the search runs
 * without a profile).
 */
export const roleProfileAnswer = z.object({
  domain: z.string().max(TEXT_CAP),
  seniority: z.string().max(40),
  yearsMin: z.number().nullable().optional(),
  yearsMax: z.number().nullable().optional(),
  missions: z
    .array(z.string().max(ROLE_PROFILE_ITEM_MAX * 4))
    .min(ROLE_MISSIONS_MIN)
    .max(LIST_CAP),
  equivalentTitles: answerList.optional(),
  adjacentProfiles: answerList.optional(),
  context: z
    .object({ sector: answerText, product: answerText, clients: answerText, scope: answerText })
    .nullable()
    .optional(),
  mustHaves: answerList.optional(),
  niceToHaves: answerList.optional(),
  successFactors: answerList.optional(),
  questions: answerList.optional(),
  assumptions: answerList.optional(),
});

/** The stored column, read leniently: the team may have left a list short or a field blank. */
const storedRoleProfile = z.object({
  title: z.string().max(TEXT_CAP).optional(),
  domain: z.string().max(TEXT_CAP).optional(),
  seniority: z.string().max(40).optional(),
  yearsMin: z.number().nullable().optional(),
  yearsMax: z.number().nullable().optional(),
  missions: answerList.optional(),
  equivalentTitles: answerList.optional(),
  adjacentProfiles: answerList.optional(),
  context: z
    .object({ sector: answerText, product: answerText, clients: answerText, scope: answerText })
    .nullable()
    .optional(),
  mustHaves: answerList.optional(),
  niceToHaves: answerList.optional(),
  successFactors: answerList.optional(),
  questions: answerList.optional(),
  assumptions: answerList.optional(),
  model: z.string().max(200).nullable().optional(),
  createdAt: z.string().max(64).optional(),
  sourceHash: z.string().max(64).optional(),
});

/**
 * The profile of a stored briefs.role_profile value: null for null, for
 * anything that is not an object, or for an object the lenient schema
 * refuses (a write by hand through the API); otherwise cleaned. Never
 * throws: a brief with a damaged column still opens.
 */
export function parseRoleProfile(value: unknown): RoleProfile | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const parsed = storedRoleProfile.safeParse(value);
  if (!parsed.success) return null;
  return cleanRoleProfile(parsed.data, { title: "", model: null, createdAt: "" });
}
