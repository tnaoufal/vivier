/**
 * The processor's own zod schemas for the analysis: what the model must
 * answer at each step (the one reading of a brief, a triage batch, a
 * screening batch, an assessment, a second opinion, a ranking), which
 * completeJson() validates before the shared package's rules bind the
 * answer, and the parsers of the JSON the database holds (a brief's
 * criteria and role profile, a search's results), read defensively: a
 * damaged or foreign value is dropped, never a crash. The shared package
 * carries no zod, so these mirror the web app's schemas
 * (src/lib/briefs/prompts.ts, role-profile.ts, criteria.ts and the
 * answer schemas of its server functions) in zod 3; the caps are
 * generous, the clean-up clips. A stored criterion about a protected
 * characteristic is left out here, so none ever reaches a payload.
 */
import { z } from "zod";

import {
  cleanRoleProfile,
  CRITERIA_MAX,
  LABEL_MAX,
  protectedCriterion,
  RANK_GROUP_MAX,
  ROLE_MISSIONS_MIN,
  ROLE_PROFILE_ITEM_MAX,
  ROLE_PROFILE_LIST_MAX,
  ROLE_PROFILE_TEXT_MAX,
  roleCriterion,
  SCREEN_BATCH_MAX,
  TRIAGE_BATCH_MAX,
  VALUE_MAX,
  type BriefCriterion,
  type MatchResult,
  type RoleProfile,
} from "@vivier/analysis";

const LIST_CAP = ROLE_PROFILE_LIST_MAX * 3;
const TEXT_CAP = ROLE_PROFILE_TEXT_MAX * 4;

const answerList = z.array(z.string().max(ROLE_PROFILE_ITEM_MAX * 4)).max(LIST_CAP);
const answerText = z.string().max(TEXT_CAP).nullable().optional();
const contextAnswer = z
  .object({ sector: answerText, product: answerText, clients: answerText, scope: answerText })
  .nullable()
  .optional();

/**
 * The role profile as the model answers it: three missions at least
 * (fewer is not a job understanding; the call is retried with the error
 * quoted back, then fails and the run says so).
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
  context: contextAnswer,
  mustHaves: answerList.optional(),
  niceToHaves: answerList.optional(),
  successFactors: answerList.optional(),
  questions: answerList.optional(),
  assumptions: answerList.optional(),
});

/** One criterion as the model answers it, before enforceBriefReading() reads it. */
const criterionAnswer = z.object({
  kind: z.string(),
  label: z.string(),
  value: z.string(),
  required: z.boolean().optional(),
  weight: z.number().optional(),
});

/** The one reading of a brief: the profile, the criteria (forty at most; the enforcement keeps EXTRACTION_MAX) and the sentences about requests dropped. */
export const briefReadingAnswer = z.object({
  profile: roleProfileAnswer,
  criteria: z.array(criterionAnswer).max(40),
  warnings: z.array(z.string()).max(10).optional(),
});

/** A triage batch: one verdict per card, by ref. */
export const triageAnswer = z.object({
  verdicts: z
    .array(
      z.object({
        ref: z.string(),
        verdict: z.string(),
        reason: z.string().nullable().optional(),
      }),
    )
    .max(TRIAGE_BATCH_MAX * 2),
});

/** A screening batch: one score per card, by ref. */
export const screenAnswer = z.object({
  scores: z
    .array(
      z.object({
        ref: z.string(),
        score: z.number().nullable().optional(),
        reason: z.string().nullable().optional(),
      }),
    )
    .max(SCREEN_BATCH_MAX * 2),
});

const dimensionAnswer = z
  .object({
    score: z.number().nullable().optional(),
    note: z.string().nullable().optional(),
    evidence: z.string().nullable().optional(),
  })
  .nullable()
  .optional();

const sentences = z.array(z.string()).max(12).nullable().optional();

/** The full reading of one profile; the dimensions and the lists are optional, so an older-shaped answer still gets through. */
export const assessmentAnswer = z.object({
  requirements: z
    .array(
      z.object({
        criterionId: z.string(),
        met: z.string(),
        evidence: z.string().nullable().optional(),
      }),
    )
    .max(80),
  dimensions: z
    .object({
      role: dimensionAnswer,
      seniority: dimensionAnswer,
      context: dimensionAnswer,
      trajectory: dimensionAnswer,
      achievements: dimensionAnswer,
    })
    .nullable()
    .optional(),
  strengths: sentences,
  concerns: sentences,
  questions: sentences,
  decision: z.string(),
  score: z.number(),
  summary: z.string(),
});

/** The second opinion on a retained profile. */
export const challengeAnswer = z.object({
  verdict: z.string(),
  kind: z.string().nullable().optional(),
  reason: z.string().nullable().optional(),
  evidence: z.string().nullable().optional(),
});

/** The tiering of a group. */
export const rankingAnswer = z.object({
  ranking: z
    .array(
      z.object({
        candidateId: z.string(),
        tier: z.string(),
        note: z.string().nullable().optional(),
      }),
    )
    .max(RANK_GROUP_MAX * 2),
});

// ---------------------------------------------------------------------
// the JSON the database holds
// ---------------------------------------------------------------------

const storedCriterion = z.object({
  id: z.string().min(1).max(64),
  kind: z.enum([
    "role",
    "skill",
    "experience",
    "language",
    "location",
    "education",
    "availability",
    "other",
  ]),
  label: z.string().max(LABEL_MAX * 4),
  value: z.string().max(VALUE_MAX * 4),
  required: z.boolean(),
  weight: z.union([z.literal(1), z.literal(2), z.literal(3)]),
});

/**
 * The criteria of a stored column (briefs.criteria, searches.criteria):
 * invalid entries dropped, labels and values trimmed and capped,
 * duplicate ids kept once, a second role left out (a brief has one
 * job), a row about a protected characteristic left out. Never throws.
 */
export function parseCriteria(value: unknown): BriefCriterion[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: BriefCriterion[] = [];
  for (const item of value) {
    const parsed = storedCriterion.safeParse(item);
    if (!parsed.success) continue;
    const label = parsed.data.label.trim().slice(0, LABEL_MAX);
    const criterionValue = parsed.data.value.trim().slice(0, VALUE_MAX);
    if (!label || !criterionValue || seen.has(parsed.data.id)) continue;
    if (protectedCriterion(label, criterionValue, parsed.data.kind)) continue;
    if (parsed.data.kind === "role" && roleCriterion(out)) continue;
    seen.add(parsed.data.id);
    out.push({
      id: parsed.data.id,
      kind: parsed.data.kind,
      label,
      value: criterionValue,
      required: parsed.data.required,
      weight: parsed.data.weight,
    });
    if (out.length >= CRITERIA_MAX) break;
  }
  return out;
}

/** The stored column, read leniently: a list may be short, a field blank. */
const storedRoleProfile = z.object({
  title: z.string().max(TEXT_CAP).optional(),
  domain: z.string().max(TEXT_CAP).optional(),
  seniority: z.string().max(40).optional(),
  yearsMin: z.number().nullable().optional(),
  yearsMax: z.number().nullable().optional(),
  missions: answerList.optional(),
  equivalentTitles: answerList.optional(),
  adjacentProfiles: answerList.optional(),
  context: contextAnswer,
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
 * The profile of a stored briefs.role_profile value: null for null,
 * for anything that is not an object, or for an object the lenient
 * schema refuses; otherwise cleaned. Never throws.
 */
export function parseRoleProfile(value: unknown): RoleProfile | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const parsed = storedRoleProfile.safeParse(value);
  if (!parsed.success) return null;
  return cleanRoleProfile(parsed.data, { title: "", model: null, createdAt: "" });
}

/**
 * The entries of a search's stored results: the runner wrote them (or
 * the web app, before the job existed), so only the shape the steps
 * key on is checked: an entry without a candidate id is dropped.
 */
export function parseResults(value: unknown): MatchResult[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (entry): entry is MatchResult =>
      Boolean(entry) &&
      typeof entry === "object" &&
      typeof (entry as { candidateId?: unknown }).candidateId === "string" &&
      Array.isArray((entry as { verdicts?: unknown }).verdicts),
  );
}
