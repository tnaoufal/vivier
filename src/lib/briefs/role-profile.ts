/**
 * The role profile: the understanding of the job a senior recruiter
 * writes down before reading a single CV (briefs.role_profile). The
 * model reads it off the brief, with the criteria, in one call
 * (readBriefPrompt, prompts.ts) at the first analysis and again when
 * the brief's text changed since (briefSourceHash, needsDerivation);
 * every screening reads it as context. This module is the pure side:
 * the schema of the model's answer, the parser of a stored column (a
 * damaged or foreign value is null, never a crash), the clean-up that
 * clips every field to what a page can show, the guard that drops any
 * field naming a protected characteristic (the core list, as a role's
 * definition is read: the wider words name products, policies and
 * sectors), the test of whether the brief itself states a maximum of
 * years (the only case a ceiling the model wrote is kept: a ceiling on
 * experience is a proxy for age), the role criterion's definition
 * derived from it, the job as the brief names it, the hash of the text
 * a profile was read from, and the empty profile. No model, no data
 * access; tested in role-profile.test.ts.
 */
import { z } from "zod";

import type { BriefRow, RoleProfile, RoleSeniority } from "@/lib/db/types";

import { protectedCriterion, VALUE_MAX } from "./criteria";

/** A text field (domain, a context field, the title) is clipped here. */
export const ROLE_PROFILE_TEXT_MAX = 200;
/** A list holds this many items at most... */
export const ROLE_PROFILE_LIST_MAX = 8;
/** ...each clipped here. */
export const ROLE_PROFILE_ITEM_MAX = 160;
/** The missions that define the job: three at least for the model, six at most for everyone. */
export const ROLE_MISSIONS_MIN = 3;
export const ROLE_MISSIONS_MAX = 6;
/** Years of experience above this are not a number a brief states. */
export const ROLE_YEARS_MAX = 60;
/** How much of the brief's text the derivation reads. */
export const ROLE_PROFILE_BRIEF_MAX = 12000;
/** The sentences saying what the brief does not state: four at most, so the team reads them before anything else. */
export const ROLE_ASSUMPTIONS_MAX = 4;

export const ROLE_SENIORITIES: readonly RoleSeniority[] = [
  "junior",
  "confirmed",
  "senior",
  "manager",
  "executive",
];
export const DEFAULT_SENIORITY: RoleSeniority = "confirmed";

export function isSeniority(value: unknown): value is RoleSeniority {
  return typeof value === "string" && (ROLE_SENIORITIES as readonly string[]).includes(value);
}

export function seniorityKey(seniority: RoleSeniority): `briefs.seniority.${RoleSeniority}` {
  return `briefs.seniority.${seniority}`;
}

// ---------------------------------------------------------------------
// the model's answer
// ---------------------------------------------------------------------

/** What the answer schema lets through, before the clean-up clips it; named so the handler reads a typed value. */
export interface RoleProfileAnswer {
  domain: string;
  seniority: string;
  yearsMin?: number | null | undefined;
  yearsMax?: number | null | undefined;
  missions: string[];
  equivalentTitles?: string[] | undefined;
  adjacentProfiles?: string[] | undefined;
  context?: RoleContextAnswer | null | undefined;
  mustHaves?: string[] | undefined;
  niceToHaves?: string[] | undefined;
  successFactors?: string[] | undefined;
  questions?: string[] | undefined;
  assumptions?: string[] | undefined;
}

interface RoleContextAnswer {
  sector?: string | null | undefined;
  product?: string | null | undefined;
  clients?: string | null | undefined;
  scope?: string | null | undefined;
}

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

/** Every field of a profile, each optional: what cleanRoleProfile() reads, from the model, from the column or from the editor. */
export interface RoleProfileInput {
  title?: string | undefined;
  domain?: string | undefined;
  seniority?: string | null | undefined;
  yearsMin?: number | null | undefined;
  yearsMax?: number | null | undefined;
  missions?: string[] | undefined;
  equivalentTitles?: string[] | undefined;
  adjacentProfiles?: string[] | undefined;
  context?: RoleContextAnswer | null | undefined;
  mustHaves?: string[] | undefined;
  niceToHaves?: string[] | undefined;
  successFactors?: string[] | undefined;
  questions?: string[] | undefined;
  assumptions?: string[] | undefined;
  model?: string | null | undefined;
  createdAt?: string | undefined;
  sourceHash?: string | null | undefined;
}

function clipText(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function clipNullable(value: unknown, max: number): string | null {
  const text = clipText(value, max);
  return text || null;
}

/** The items of a list, trimmed and clipped, blanks and repeats dropped, `max` at most. */
export function clipList(
  value: unknown,
  max: number = ROLE_PROFILE_LIST_MAX,
  itemMax: number = ROLE_PROFILE_ITEM_MAX,
): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const text = clipText(item, itemMax);
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= max) break;
  }
  return out;
}

function clipYears(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(ROLE_YEARS_MAX, Math.round(value)));
}

/**
 * A profile every page can show: texts clipped to 200, lists to 8 items
 * of 160 (the missions to 6, the assumptions to 4), a seniority the
 * schema knows (else "confirmed"), years as whole numbers in 0..60 with
 * the minimum first, a context of four nullable fields. `title`, `model`
 * and `createdAt` come from the caller when the input lacks them; the
 * hash of the text the profile was read from stays only when the input
 * holds one (an older profile has none, and is read again once).
 */
export function cleanRoleProfile(
  input: RoleProfileInput,
  defaults: { title: string; model: string | null; createdAt: string },
): RoleProfile {
  let yearsMin = clipYears(input.yearsMin);
  let yearsMax = clipYears(input.yearsMax);
  if (yearsMin !== null && yearsMax !== null && yearsMin > yearsMax)
    [yearsMin, yearsMax] = [yearsMax, yearsMin];
  const context = input.context ?? null;
  return {
    title:
      clipText(input.title, ROLE_PROFILE_TEXT_MAX) ||
      clipText(defaults.title, ROLE_PROFILE_TEXT_MAX),
    domain: clipText(input.domain, ROLE_PROFILE_TEXT_MAX),
    seniority: isSeniority(input.seniority) ? input.seniority : DEFAULT_SENIORITY,
    yearsMin,
    yearsMax,
    missions: clipList(input.missions, ROLE_MISSIONS_MAX),
    equivalentTitles: clipList(input.equivalentTitles),
    adjacentProfiles: clipList(input.adjacentProfiles),
    context: {
      sector: clipNullable(context?.sector, ROLE_PROFILE_TEXT_MAX),
      product: clipNullable(context?.product, ROLE_PROFILE_TEXT_MAX),
      clients: clipNullable(context?.clients, ROLE_PROFILE_TEXT_MAX),
      scope: clipNullable(context?.scope, ROLE_PROFILE_TEXT_MAX),
    },
    mustHaves: clipList(input.mustHaves),
    niceToHaves: clipList(input.niceToHaves),
    successFactors: clipList(input.successFactors),
    questions: clipList(input.questions),
    assumptions: clipList(input.assumptions, ROLE_ASSUMPTIONS_MAX),
    model:
      typeof input.model === "string" && input.model.trim()
        ? input.model.trim().slice(0, 200)
        : defaults.model,
    createdAt:
      typeof input.createdAt === "string" && input.createdAt.trim()
        ? input.createdAt.trim()
        : defaults.createdAt,
    ...(typeof input.sourceHash === "string" && input.sourceHash.trim()
      ? { sourceHash: input.sourceHash.trim().slice(0, 64) }
      : {}),
  };
}

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

/** The profile the editor starts from when the brief has none: the title alone, everything else blank. */
export function emptyRoleProfile(
  title: string,
  createdAt: string = new Date().toISOString(),
): RoleProfile {
  return cleanRoleProfile({}, { title, model: null, createdAt });
}

// ---------------------------------------------------------------------
// the guard
// ---------------------------------------------------------------------

/** True when a field of a profile names a protected characteristic (the core list, as a role's definition is read). */
export function protectedRoleText(text: string): boolean {
  return text.trim().length > 0 && protectedCriterion(text, "", "role");
}

function guardList(list: readonly string[], counter: { dropped: number }): string[] {
  return list.filter((item) => {
    if (!protectedRoleText(item)) return true;
    counter.dropped += 1;
    return false;
  });
}

function guardText(text: string, counter: { dropped: number }): string {
  if (!protectedRoleText(text)) return text;
  counter.dropped += 1;
  return "";
}

/**
 * The profile with every field that names a protected characteristic
 * dropped (a text becomes empty, a context field null, a list item
 * disappears), and how many were: the server logs it, nothing of it is
 * stored. Applied to what the model answered and to what the team
 * saves, since the parser does not read the column against the guard.
 */
export function guardRoleProfile(profile: RoleProfile): { profile: RoleProfile; dropped: number } {
  const counter = { dropped: 0 };
  const guarded: RoleProfile = {
    ...profile,
    title: guardText(profile.title, counter),
    domain: guardText(profile.domain, counter),
    missions: guardList(profile.missions, counter),
    equivalentTitles: guardList(profile.equivalentTitles, counter),
    adjacentProfiles: guardList(profile.adjacentProfiles, counter),
    context: {
      sector: guardText(profile.context.sector ?? "", counter) || null,
      product: guardText(profile.context.product ?? "", counter) || null,
      clients: guardText(profile.context.clients ?? "", counter) || null,
      scope: guardText(profile.context.scope ?? "", counter) || null,
    },
    mustHaves: guardList(profile.mustHaves, counter),
    niceToHaves: guardList(profile.niceToHaves, counter),
    successFactors: guardList(profile.successFactors, counter),
    questions: guardList(profile.questions, counter),
    assumptions: guardList(profile.assumptions, counter),
  };
  return { profile: guarded, dropped: counter.dropped };
}

// ---------------------------------------------------------------------
// what the brief states about years
// ---------------------------------------------------------------------

/**
 * A number of years followed or preceded by a word that makes it a
 * ceiling ("8 ans maximum", "10 years max", "au plus 10 ans", "pas plus
 * de 5 ans", "up to 8 years", "no more than 10 years"), accents and case
 * already folded. A ceiling on experience is the classic indirect age
 * criterion; the model may keep one only when the brief itself wrote it.
 */
const MAXIMUM_YEARS =
  /(?:(?:au plus|au maximum|maximum|max\.?|at most|up to|no more than|not more than|jusqu'a|pas plus de|moins de|less than|under|sous)\s*(?:de\s*)?\d{1,2}\s*(?:ans?|annees?|years?|yrs?)|(?<!\d)\d{1,2}\s*(?:ans?|annees?|years?|yrs?)?\s*(?:d'experience\s*|of experience\s*)?(?:max\.?|maxi|maximum|au plus|au maximum|at most|tops))(?!\p{L})/u;

/** True when the brief's text itself states a maximum number of years: the one case a profile may hold a yearsMax the model wrote. */
export function statesMaximumYears(brief: Pick<BriefRow, "title" | "description">): boolean {
  const text = `${brief.title}\n${brief.description}`
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[’‘]/g, "'");
  return MAXIMUM_YEARS.test(text);
}

// ---------------------------------------------------------------------
// what the role criterion reads from it
// ---------------------------------------------------------------------

/**
 * The role criterion's value from a profile: the domain, the missions
 * and the equivalent titles as one text of at most VALUE_MAX (600)
 * characters, the title alone when the profile holds nothing else, an
 * empty string when it holds nothing at all. Language-neutral
 * separators, since the profile is in the brief's language.
 */
export function roleDefinitionOf(profile: RoleProfile): string {
  const parts = [
    profile.domain,
    profile.missions.join(" ; "),
    profile.equivalentTitles.join(", "),
  ].filter((part) => part.trim());
  const text = parts.length ? parts.join(". ") : profile.title.trim();
  // Trimmed after the cut too: the stored criterion is trimmed, and a definition must equal the value it was written into.
  return text.trim().slice(0, VALUE_MAX).trim();
}

// ---------------------------------------------------------------------
// the brief the profile is read from
// ---------------------------------------------------------------------

/** The job as the brief names it: the title, else the first line of the text, else nothing (there is no job to name). */
export function jobTitleOf(brief: Pick<BriefRow, "title" | "description">): string {
  return brief.title.trim() || brief.description.trim().split("\n")[0]?.trim() || "";
}

/**
 * FNV-1a, 32 bits, over the UTF-8 bytes of a text, as eight lowercase
 * hexadecimal digits: small, the same in every runtime, and enough to
 * tell whether a brief's text changed (a collision would only read a
 * changed brief as unchanged, until its next edit).
 */
export function fnv1a32(text: string): string {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(text)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/** The hash of the text (the title, a line break, the description) a profile and the criteria are read from. */
export function briefSourceHash(brief: Pick<BriefRow, "title" | "description">): string {
  return fnv1a32(`${brief.title}\n${brief.description}`);
}

/**
 * True when a search must read the brief again before anything else:
 * the brief has no profile, or the one it has was read from another
 * text (or before the hash existed). Otherwise the stored profile and
 * criteria stand, and no model call comes before the triage.
 */
export function needsDerivation(
  brief: Pick<BriefRow, "title" | "description" | "role_profile">,
): boolean {
  const profile = brief.role_profile;
  return !profile || profile.sourceHash !== briefSourceHash(brief);
}
