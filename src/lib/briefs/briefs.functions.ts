/**
 * Server functions of the briefs: what the deployment can do (a model
 * or not), the criteria a model proposes from a brief's text (the role,
 * the job itself, always first), the role profile (the understanding of
 * the job a senior recruiter writes before reading a CV: derived once
 * at the first analysis, regenerated on request, edited by the team in
 * the browser), the search of the talent pool for a brief (the profile
 * first when the brief has none, then the criteria when it has none,
 * then the role criterion built from the profile or derived from the
 * title, and refreshed from the profile the team edited since; then,
 * with a model, a snapshot of every active profile for the triage, and
 * without one the whole pool up to FULL_POOL_MAX active candidates,
 * else the hybrid retrieval, scored by the deterministic verdicts),
 * stored as a searches row; the triage of the snapshot (forty compact
 * cards per call, enforced by triage.ts, written to search_triage) and
 * the promotion of the profiles it kept into the results; and the three
 * passes the browser drives on the results: the screening of a few
 * candidates at a time (one model call per candidate, enforced by
 * assessment.ts, merged into the row entry by entry and carried to the
 * brief's shortlist items that still hold an unassessed match), the
 * second opinion on the retained ones (one call per candidate,
 * applyChallenge), and the comparative tiering of a group (one call per
 * group, applyRanking). Every handler reads the caller from the access
 * token through requireMember() and works only on the organisation it
 * verified. Nothing here decides: the model proposes, the row keeps its
 * reading, a person retains.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import type {
  Assessment,
  BriefCriterion,
  BriefRow,
  CriterionKind,
  MatchResult,
  RoleProfile,
  SearchMethod,
  SearchRow,
  SearchTriageRow,
  ShortlistItemRow,
  TriageVerdict,
} from "@/lib/db/types";
import { completeJson, embed, modelConfigured, vectorLiteral } from "@/lib/model/model.server";
import { AppError } from "@/lib/platform/errors";
import { enforceRateLimit } from "@/lib/platform/rate-limit.server";
import { settings } from "@/lib/platform/settings.server";
import { db, requireMember, type ServiceClient } from "@/lib/platform/supabase.server";
import { recordUsage } from "@/lib/platform/usage.server";

import {
  applyChallenge,
  ASSESS_BATCH_MAX,
  enforceAssessment,
  type EnforceOptions,
  type ModelAssessmentAnswer,
  type ModelChallengeAnswer,
} from "./assessment";
import {
  countProtected,
  isCriterionKind,
  LABEL_MAX,
  parseCriteria,
  protectedCriterion,
  roleCriterion,
  roleCriterionOf,
  roleFromTitle,
  toWeight,
  VALUE_MAX,
  withId,
} from "./criteria";
import { rankResults, scoreCandidate } from "./matching";
import {
  assessmentPayload,
  assessmentSystemPrompt,
  challengePayload,
  challengeSystemPrompt,
  EXTRACTION_MAX,
  extractionSystemPrompt,
  extractionUserPrompt,
  FULL_POOL_MAX,
  payloadTexts,
  queryTextOf,
  RETRIEVAL_LIMIT,
  roleDefinitionPrompt,
  textQueryOf,
  type AssessmentProfile,
  type BriefText,
} from "./prompts";
import {
  applyRanking,
  RANK_GROUP_MAX,
  RANK_GROUP_MIN,
  rankingPayload,
  rankingSheets,
  rankingSystemPrompt,
  type ModelRankingAnswer,
} from "./ranking";
import {
  cleanRoleProfile,
  guardRoleProfile,
  parseRoleProfile,
  roleDefinitionOf,
  roleProfileAnswer,
  roleProfileSystemPrompt,
  roleProfileUserPrompt,
  statesMaximumYears,
  type RoleProfileAnswer,
} from "./role-profile";
import { batchesOf, CHALLENGE_BATCH_MAX } from "./stages";
import {
  countTriage,
  enforceTriage,
  isTriageVerdict,
  TRIAGE_BATCH_MAX,
  TRIAGE_PASSING,
  TRIAGE_PROFILE_COLUMNS,
  triageEntries,
  triageOrder,
  triagePayload,
  triageRoleBrief,
  triageRoleTerms,
  triageSystemPrompt,
  type ModelTriageAnswer,
  type TriageProfile,
} from "./triage";

/**
 * The answer's budget grows with the requirements: the five dimensions
 * (score, note and evidence each), the three lists, the summary and one
 * row per criterion keyed by its UUID make about 2000 tokens on six
 * criteria and close to 3000 on twelve; a budget below that cuts the
 * JSON and fails the candidate.
 */
const ASSESSMENT_TOKENS_BASE = 1800;
const ASSESSMENT_TOKENS_PER_REQUIREMENT = 80;
const ASSESSMENT_TOKENS_MAX = 3200;
const ROLE_PROFILE_TOKENS = 1600;
const CHALLENGE_TOKENS = 400;
/** One line per candidate of the group. */
const RANKING_TOKENS_PER_CANDIDATE = 120;
/** A triage answer: the envelope, then one short verdict with its reason per card. */
const TRIAGE_TOKENS_BASE = 400;
const TRIAGE_TOKENS_PER_CARD = 70;
/** The most rows one read of search_triage asks for (PostgREST's usual page). */
const TRIAGE_PAGE = 1000;
/** The most ids one query string names (planLots: the gateway refuses a URL past 16 KB). */
const IDS_PER_QUERY = 100;
/** The most entries one merge_search_results call carries. */
const MERGE_CHUNK = 200;

const orgInput = z.object({
  accessToken: z.string().min(1).max(4096),
  orgId: z.uuid(),
});

const briefInput = orgInput.extend({
  briefId: z.uuid(),
});

const assessInput = briefInput.extend({
  searchId: z.uuid(),
  candidateIds: z.array(z.uuid()).min(1).max(ASSESS_BATCH_MAX),
});

const challengeInput = briefInput.extend({
  searchId: z.uuid(),
  candidateIds: z.array(z.uuid()).min(1).max(CHALLENGE_BATCH_MAX),
});

const rankInput = briefInput.extend({
  searchId: z.uuid(),
  candidateIds: z.array(z.uuid()).min(RANK_GROUP_MIN).max(RANK_GROUP_MAX),
});

const triageInput = briefInput.extend({
  searchId: z.uuid(),
  candidateIds: z.array(z.uuid()).min(1).max(TRIAGE_BATCH_MAX),
});

const searchInput = briefInput.extend({
  searchId: z.uuid(),
});

type LoadedBrief = Pick<BriefRow, "id" | "title" | "description"> & {
  criteria: BriefCriterion[];
  role_profile: RoleProfile | null;
};

function log(event: string, details: Record<string, unknown>): void {
  console.warn("[briefs]", JSON.stringify({ event, ...details }));
}

/**
 * The criteria of a stored column: parseCriteria() leaves out a row about
 * a protected characteristic (one an older client or a write by hand
 * through the API stored), so none ever reaches a payload; the log says
 * it happened.
 */
function criteriaOf(raw: unknown, where: Record<string, string>): BriefCriterion[] {
  const dropped = countProtected(raw);
  if (dropped > 0) log("protected_criteria_dropped", { ...where, dropped });
  return parseCriteria(raw);
}

/** The brief of the organisation, criteria and role profile parsed, or NOT_FOUND. */
async function loadBrief(
  client: ServiceClient,
  orgId: string,
  briefId: string,
): Promise<LoadedBrief> {
  const rows = await client.select<
    Pick<BriefRow, "id" | "title" | "description" | "criteria" | "role_profile">
  >(
    `briefs?select=id,title,description,criteria,role_profile&org_id=eq.${encodeURIComponent(orgId)}&id=eq.${encodeURIComponent(briefId)}&limit=1`,
  );
  const row = rows[0];
  if (!row) throw new AppError("NOT_FOUND");
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    criteria: criteriaOf(row.criteria, { briefId: row.id }),
    role_profile: parseRoleProfile(row.role_profile),
  };
}

/** The brief as the payloads read it: text, criteria (the search's when given) and the role profile. */
function briefTextOf(
  brief: LoadedBrief,
  criteria: readonly BriefCriterion[] = brief.criteria,
): BriefText {
  return {
    title: brief.title,
    description: brief.description,
    criteria: [...criteria],
    roleProfile: brief.role_profile,
  };
}

type SearchHead = Pick<SearchRow, "id" | "brief_id" | "criteria" | "method" | "pool_size">;
type LoadedSearch = SearchHead & Pick<SearchRow, "results">;

const SEARCH_HEAD_COLUMNS = "id,brief_id,criteria,method,pool_size";

/** One search of the organisation without its results (the criteria of the time, the method, the pool's size), or NOT_FOUND. */
async function loadSearchHead(
  client: ServiceClient,
  orgId: string,
  searchId: string,
): Promise<SearchHead> {
  const rows = await client.select<SearchHead>(
    `searches?select=${SEARCH_HEAD_COLUMNS}&org_id=eq.${encodeURIComponent(orgId)}&id=eq.${encodeURIComponent(searchId)}&limit=1`,
  );
  const row = rows[0];
  if (!row) throw new AppError("NOT_FOUND");
  return {
    id: row.id,
    brief_id: row.brief_id,
    criteria: criteriaOf(row.criteria, { searchId: row.id }),
    method: row.method,
    pool_size: typeof row.pool_size === "number" ? row.pool_size : null,
  };
}

/** One search of the organisation with its stored results and the criteria of the time, or NOT_FOUND. */
async function loadSearch(
  client: ServiceClient,
  orgId: string,
  searchId: string,
): Promise<LoadedSearch> {
  const rows = await client.select<LoadedSearch>(
    `searches?select=${SEARCH_HEAD_COLUMNS},results&org_id=eq.${encodeURIComponent(orgId)}&id=eq.${encodeURIComponent(searchId)}&limit=1`,
  );
  const row = rows[0];
  if (!row) throw new AppError("NOT_FOUND");
  return {
    id: row.id,
    brief_id: row.brief_id,
    criteria: criteriaOf(row.criteria, { searchId: row.id }),
    method: row.method,
    pool_size: typeof row.pool_size === "number" ? row.pool_size : null,
    results: Array.isArray(row.results) ? row.results : [],
  };
}

/**
 * The entries given written into the search's results in one statement
 * (merge_search_results locks the row, replaces each entry of the same
 * candidate, appends the others and keeps the summary counts), so
 * batches sent in parallel add up instead of overwriting each other.
 * Nothing is sent for an empty list.
 */
async function mergeResults(
  client: ServiceClient,
  orgId: string,
  searchId: string,
  entries: readonly MatchResult[],
): Promise<void> {
  if (!entries.length) return;
  await client.rpc<number | null>("merge_search_results", {
    p_org: orgId,
    p_search: searchId,
    p_results: entries,
  });
}

// ---------------------------------------------------------------------
// capabilities
// ---------------------------------------------------------------------

export interface BriefCapabilities {
  /** True when a model is set up: criteria can be proposed and results assessed. */
  model: boolean;
}

export const briefCapabilities = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => orgInput.parse(data))
  .handler(async ({ data }): Promise<BriefCapabilities> => {
    await requireMember(data.accessToken, data.orgId, "viewer");
    return { model: modelConfigured() };
  });

// ---------------------------------------------------------------------
// criteria proposed by the model
// ---------------------------------------------------------------------

/** What the extraction schema lets through; named so the handler reads a typed value. */
interface ExtractionAnswer {
  criteria: {
    kind: string;
    label: string;
    value: string;
    required?: boolean | undefined;
    weight?: number | undefined;
  }[];
  warnings?: string[] | undefined;
}

const extractionAnswer = z.object({
  criteria: z
    .array(
      z.object({
        kind: z.string(),
        label: z.string(),
        value: z.string(),
        required: z.boolean().optional(),
        weight: z.number().optional(),
      }),
    )
    .max(40),
  warnings: z.array(z.string()).max(10).optional(),
});

export interface ExtractionResult {
  /** Proposals with fresh ids; the person adds the ones they keep. */
  criteria: BriefCriterion[];
  /** The model's sentences about requests it dropped, in the brief's language. */
  warnings: string[];
  /** Proposals dropped here because they named a protected characteristic. */
  dropped: number;
}

/**
 * One extraction call: the model's proposals cleaned, capped, and
 * stripped of protected characteristics, the role first and once (the
 * job itself, required and essential whatever the model said of it: the
 * team may untick it in the editor). The brief's role profile, when it
 * has one, goes with the text so the must-haves come back required.
 */
async function proposeCriteria(orgId: string, brief: LoadedBrief): Promise<ExtractionResult> {
  const answer = await completeJson<ExtractionAnswer>({
    system: extractionSystemPrompt(),
    user: extractionUserPrompt(brief, brief.role_profile),
    schema: extractionAnswer,
    temperature: 0,
    maxTokens: 2000,
  });
  await recordUsage(orgId, "brief", answer.usage);
  const criteria: BriefCriterion[] = [];
  let role: BriefCriterion | null = null;
  let dropped = 0;
  for (const item of answer.value.criteria) {
    const label = item.label.trim().slice(0, LABEL_MAX);
    const value = item.value.trim().slice(0, VALUE_MAX);
    if (!label || !value) continue;
    const kind: CriterionKind = isCriterionKind(item.kind) ? item.kind : "other";
    if (protectedCriterion(label, value, kind)) {
      dropped += 1;
      continue;
    }
    if (kind === "role") {
      if (!role) role = roleCriterionOf(label, value);
      continue;
    }
    criteria.push(
      withId({
        kind,
        label,
        value,
        required: item.required === true,
        weight: toWeight(item.weight),
      }),
    );
    if (criteria.length >= EXTRACTION_MAX) break;
  }
  if (role) criteria.splice(0, 0, role);
  criteria.splice(EXTRACTION_MAX);
  const warnings = (answer.value.warnings ?? [])
    .map((warning) => warning.trim().slice(0, 300))
    .filter((warning) => warning.length > 0)
    .slice(0, 5);
  return { criteria, warnings, dropped };
}

export const extractCriteria = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => briefInput.parse(data))
  .handler(async ({ data }): Promise<ExtractionResult> => {
    const member = await requireMember(data.accessToken, data.orgId, "member");
    await enforceRateLimit("model", { userKey: member.userId });
    if (!modelConfigured()) throw new AppError("SETUP:model");
    const brief = await loadBrief(db(), member.orgId, data.briefId);
    return proposeCriteria(member.orgId, brief);
  });

// ---------------------------------------------------------------------
// the role profile
// ---------------------------------------------------------------------

/** The job as the team names it: the title, else the first line of the text. */
function jobTitleOf(brief: Pick<BriefRow, "title" | "description">): string {
  return brief.title.trim() || brief.description.trim().split("\n")[0]?.trim() || "";
}

/**
 * One call, at temperature 0 so the same brief gives the same profile,
 * that writes the role profile from the brief's text, cleaned and
 * guarded (a field naming a protected characteristic is dropped and the
 * log says so; a maximum of years the brief did not state is dropped
 * too), and saved into the brief through the service client. Throws
 * when the model does not answer: the caller decides whether the search
 * goes on without it.
 */
async function writeRoleProfile(
  client: ServiceClient,
  orgId: string,
  brief: LoadedBrief,
): Promise<RoleProfile> {
  const answer = await completeJson<RoleProfileAnswer>({
    system: roleProfileSystemPrompt(),
    user: roleProfileUserPrompt(brief),
    schema: roleProfileAnswer,
    temperature: 0,
    maxTokens: ROLE_PROFILE_TOKENS,
  });
  await recordUsage(orgId, "brief", answer.usage);
  // A ceiling on years the brief did not write is the model's, and a proxy for age: only the brief's own maximum is kept.
  const cleaned = cleanRoleProfile(
    { ...answer.value, yearsMax: statesMaximumYears(brief) ? answer.value.yearsMax : null },
    {
      title: jobTitleOf(brief),
      model: answer.usage.model,
      createdAt: new Date().toISOString(),
    },
  );
  const { profile, dropped } = guardRoleProfile(cleaned);
  if (dropped > 0) log("role_profile_protected", { briefId: brief.id, dropped });
  await client.patch("briefs", { id: brief.id, org_id: orgId }, { role_profile: profile });
  return profile;
}

/** The profile of a brief that has none, or null when the model did not answer (logged; the search runs without it). */
async function deriveRoleProfile(
  client: ServiceClient,
  orgId: string,
  brief: LoadedBrief,
): Promise<RoleProfile | null> {
  if (!jobTitleOf(brief)) return null;
  try {
    return await writeRoleProfile(client, orgId, brief);
  } catch (error) {
    log("role_profile_failed", { briefId: brief.id, error: String(error).slice(0, 300) });
    return null;
  }
}

export interface RoleProfileResult {
  roleProfile: RoleProfile;
}

/** The "regenerate" button: the profile written again from the brief's text and saved; the team edits it from there. */
export const regenerateRoleProfile = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => briefInput.parse(data))
  .handler(async ({ data }): Promise<RoleProfileResult> => {
    const member = await requireMember(data.accessToken, data.orgId, "member");
    await enforceRateLimit("model", { userKey: member.userId });
    if (!modelConfigured()) throw new AppError("SETUP:model");
    const client = db();
    const brief = await loadBrief(client, member.orgId, data.briefId);
    if (!jobTitleOf(brief)) throw new AppError("INPUT:invalid");
    const roleProfile = await writeRoleProfile(client, member.orgId, brief);
    console.info(
      "[briefs]",
      JSON.stringify({
        event: "role_profile",
        orgId: member.orgId,
        briefId: brief.id,
        model: roleProfile.model,
      }),
    );
    return { roleProfile };
  });

// ---------------------------------------------------------------------
// the search
// ---------------------------------------------------------------------

interface RetrievalRow {
  candidate_id: string;
  text_rank: number | null;
  vector_rank: number | null;
  score: number;
}

/**
 * What the scoring and the assessment read. Never the email or the phone;
 * the name is read only so assessmentPayload() can strip it out of the
 * texts (the CV's indexed text starts with it): it never leaves for the
 * model.
 */
const PROFILE_COLUMNS =
  "id,org_id,full_name,headline,summary,skills,languages,location,years_experience,availability,education,experiences,search_text";

type ProfileRow = AssessmentProfile & { org_id: string };

export interface SearchResult {
  searchId: string;
  /** "triage" with a model (the results come from promoteTriage once the triage is done), "hybrid" or "text" without. */
  method: SearchMethod;
  /** Ranked by the deterministic pass: not blocked first, then score, then coverage. No assessment yet; empty for a triage. */
  results: MatchResult[];
  /** The criteria the verdicts refer to, as they were at run time. */
  criteria: BriefCriterion[];
  /**
   * True when the brief's criteria were derived from its text and saved
   * into it before the search: all of them for a brief that had none, or
   * the role alone for a brief written before the role existed.
   */
  criteriaDerived: boolean;
  /** True when the role profile was written from the brief's text and saved before the search (the team checks it). */
  roleProfileDerived: boolean;
  /**
   * True when the model wrote the understanding of the job this search
   * rests on (the profile, the criteria, or the role's definition from
   * the text) and nobody has checked it yet: the browser then shows the
   * deterministic ranking and waits for the team before any profile is
   * read. False when the role was only copied from a profile the brief
   * already had.
   */
  needsCheck: boolean;
  /**
   * Active candidates in the pool at run time: for a triage, the
   * profiles of the snapshot (every one is read); without a model, above
   * FULL_POOL_MAX only the retrieved rows were read, and the panel says so.
   */
  poolSize: number;
  createdAt: string;
}

/** The query embedded, or null when no model is set up or it did not answer (the search then runs on text). */
async function embedQuery(orgId: string, text: string): Promise<number[] | null> {
  if (!modelConfigured() || !text.trim()) return null;
  try {
    const { vectors, usage } = await embed([text]);
    await recordUsage(orgId, "embed", usage);
    return vectors[0] ?? null;
  } catch (error) {
    log("embed_failed", { error: String(error).slice(0, 300) });
    return null;
  }
}

/** How many active candidates the organisation holds: the pool the search reads whole, or samples. */
async function poolSizeOf(client: ServiceClient, orgId: string): Promise<number> {
  return client.count(
    `candidates?select=id&org_id=eq.${encodeURIComponent(orgId)}&status=eq.active`,
  );
}

/** The active profiles of the organisation, newest first, `limit` at most. */
async function loadPool(
  client: ServiceClient,
  orgId: string,
  limit: number,
): Promise<ProfileRow[]> {
  return client.select<ProfileRow>(
    `candidates?select=${PROFILE_COLUMNS}&org_id=eq.${encodeURIComponent(orgId)}&status=eq.active&order=updated_at.desc&limit=${limit}`,
  );
}

/** The active profiles among `ids`, by id; one archived or erased since is absent. */
async function loadProfiles(
  client: ServiceClient,
  orgId: string,
  ids: readonly string[],
): Promise<Map<string, ProfileRow>> {
  const profiles = new Map<string, ProfileRow>();
  if (!ids.length) return profiles;
  const org = encodeURIComponent(orgId);
  const list = ids.map((id) => encodeURIComponent(id)).join(",");
  const rows = await client.select<ProfileRow>(
    `candidates?select=${PROFILE_COLUMNS}&org_id=eq.${org}&status=eq.active&id=in.(${list})`,
  );
  for (const row of rows) {
    if (row.org_id === orgId) profiles.set(row.id, row);
  }
  return profiles;
}

/**
 * The criteria of a brief that has none, derived from its text by the
 * model with the same rules as a proposal and saved into the brief so
 * the editor shows them (the person checks them: a toast says so). A
 * failure leaves the brief as it is and the search runs on text alone.
 */
async function deriveCriteria(
  client: ServiceClient,
  orgId: string,
  brief: LoadedBrief,
): Promise<BriefCriterion[] | null> {
  try {
    const proposed = await proposeCriteria(orgId, brief);
    if (!proposed.criteria.length) return null;
    await client.patch("briefs", { id: brief.id, org_id: orgId }, { criteria: proposed.criteria });
    return proposed.criteria;
  } catch (error) {
    log("derive_failed", { briefId: brief.id, error: String(error).slice(0, 300) });
    return null;
  }
}

const roleAnswer = z.object({
  label: z.string(),
  value: z.string(),
});

/**
 * The role criterion of a brief that has none (every brief written
 * before the role existed): with a model, one small call names the job
 * and writes its definition; without one, or when the call fails or
 * answers something the guard refuses, the brief's title stands for
 * both (honest, and the team edits it). Saved in front of the criteria
 * the brief already has, so the editor shows it (realtime) and every
 * later run finds it: it is never added twice. Null for a brief with
 * neither a title nor a description (there is no job to name), and null
 * when nothing could be saved: a title that itself names a protected
 * characteristic is never written, since the parser would drop it on
 * the next read and every run would derive it again.
 */
async function deriveRole(
  client: ServiceClient,
  orgId: string,
  brief: LoadedBrief,
): Promise<BriefCriterion | null> {
  if (!brief.title.trim() && !brief.description.trim()) return null;
  const fallback = roleFromTitle(brief);
  let role = fallback;
  if (modelConfigured()) {
    try {
      const prompt = roleDefinitionPrompt(brief);
      const answer = await completeJson<{ label: string; value: string }>({
        system: prompt.system,
        user: prompt.user,
        schema: roleAnswer,
        temperature: 0,
        maxTokens: 600,
      });
      await recordUsage(orgId, "brief", answer.usage);
      const label = answer.value.label.trim().slice(0, LABEL_MAX) || fallback?.label || "";
      const value = answer.value.value.trim().slice(0, VALUE_MAX) || fallback?.value || "";
      if (!label || !value) log("role_empty", { briefId: brief.id });
      else if (protectedCriterion(label, value, "role"))
        log("role_protected", { briefId: brief.id });
      else role = roleCriterionOf(label, value);
    } catch (error) {
      log("role_failed", { briefId: brief.id, error: String(error).slice(0, 300) });
    }
  }
  if (!role) {
    log("role_unnamed", { briefId: brief.id });
    return null;
  }
  // The search runs with the role either way; a save that fails is logged and tried again on the next run.
  try {
    await client.patch(
      "briefs",
      { id: brief.id, org_id: orgId },
      { criteria: [role, ...brief.criteria] },
    );
  } catch (error) {
    log("role_save_failed", { briefId: brief.id, error: String(error).slice(0, 300) });
  }
  return role;
}

/**
 * The role criterion's definition kept in step with the profile the
 * team edits: when the brief has both and the profile names something
 * else than the criterion's stored value, the value is rewritten from
 * the profile (the label, the job as the team names it, stays) before
 * the search, so the stored search carries the definition the payloads
 * and the full-text query read. A save that fails is logged; the
 * payloads read the profile either way.
 */
async function refreshRoleFromProfile(
  client: ServiceClient,
  orgId: string,
  brief: LoadedBrief,
  profile: RoleProfile,
): Promise<BriefCriterion[]> {
  const role = roleCriterion(brief.criteria);
  const definition = roleDefinitionOf(profile);
  if (!role || !definition || definition === role.value) return brief.criteria;
  if (protectedCriterion(role.label, definition, "role")) return brief.criteria;
  const criteria = brief.criteria.map((criterion) =>
    criterion === role ? { ...criterion, value: definition } : criterion,
  );
  try {
    await client.patch("briefs", { id: brief.id, org_id: orgId }, { criteria });
    log("role_refreshed", { briefId: brief.id });
  } catch (error) {
    log("role_save_failed", { briefId: brief.id, error: String(error).slice(0, 300) });
  }
  return criteria;
}

/**
 * The role criterion of a brief that has a profile but no role yet: the
 * job as the profile names it (else the brief's title) and the
 * definition read off the profile (domain, missions, equivalent
 * titles), saved in front of the criteria like a derived one. Null when
 * the profile names nothing (its fields were dropped by the guard, or
 * the team emptied them): the title then stands, as before.
 */
async function roleFromProfile(
  client: ServiceClient,
  orgId: string,
  brief: LoadedBrief,
  profile: RoleProfile,
): Promise<BriefCriterion | null> {
  const label = profile.title.trim() || jobTitleOf(brief);
  const value = roleDefinitionOf(profile) || label;
  if (!label || !value || protectedCriterion(label, value, "role"))
    return deriveRole(client, orgId, brief);
  const role = roleCriterionOf(label, value);
  try {
    await client.patch(
      "briefs",
      { id: brief.id, org_id: orgId },
      { criteria: [role, ...brief.criteria] },
    );
  } catch (error) {
    log("role_save_failed", { briefId: brief.id, error: String(error).slice(0, 300) });
  }
  return role;
}

export const runSearch = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => briefInput.parse(data))
  .handler(async ({ data }): Promise<SearchResult> => {
    const member = await requireMember(data.accessToken, data.orgId, "member");
    await enforceRateLimit("search", { userKey: member.userId });
    const client = db();
    const loaded = await loadBrief(client, member.orgId, data.briefId);

    // The understanding of the job comes first: a brief without a role
    // profile gets one from its text, so the criteria and every screening
    // read the job as a senior recruiter would brief it.
    let roleProfileDerived = false;
    // What the model wrote about the job and nobody checked: the browser waits for the team before a profile is read.
    let needsCheck = false;
    let brief = loaded;
    if (!loaded.role_profile && modelConfigured()) {
      const profile = await deriveRoleProfile(client, member.orgId, loaded);
      if (profile) {
        brief = { ...loaded, role_profile: profile };
        roleProfileDerived = true;
        needsCheck = true;
      }
    }
    let criteriaDerived = false;
    if (!brief.criteria.length && modelConfigured()) {
      const derived = await deriveCriteria(client, member.orgId, brief);
      if (derived) {
        brief = { ...brief, criteria: derived };
        criteriaDerived = true;
        needsCheck = true;
      }
    }
    // The job itself is the first requirement: a brief that has none yet
    // (written before the role existed, or derived without one) gets it
    // before anything is read: from the profile when there is one (no
    // model call), else derived from the title and the text.
    if (!roleCriterion(brief.criteria)) {
      const role = brief.role_profile
        ? await roleFromProfile(client, member.orgId, brief, brief.role_profile)
        : await deriveRole(client, member.orgId, brief);
      if (role) {
        brief = { ...brief, criteria: [role, ...brief.criteria] };
        criteriaDerived = true;
        if (!brief.role_profile && modelConfigured()) needsCheck = true;
      }
    } else if (brief.role_profile) {
      // The team edits the profile: the role's definition follows it, so the search and the payloads read one source.
      brief = {
        ...brief,
        criteria: await refreshRoleFromProfile(client, member.orgId, brief, brief.role_profile),
      };
    }
    const queryText = queryTextOf(brief);

    // With a model every active profile of the pool is read: the search
    // stores a snapshot of the pool (search_triage, one row per active
    // candidate, in one statement) and the browser drives its triage,
    // then the promotion of the profiles kept into the results. Nothing
    // is retrieved, embedded or scored here. A brief that names no job
    // (no role, no profile) has nothing to sort on and takes the path
    // below.
    if (modelConfigured() && (roleCriterion(brief.criteria) || brief.role_profile)) {
      const inserted = await client.insert<Pick<SearchRow, "id" | "created_at">>("searches", [
        {
          org_id: member.orgId,
          brief_id: brief.id,
          query: queryText,
          criteria: brief.criteria,
          results: [],
          result_count: 0,
          method: "triage",
          pool_size: 0,
          ran_by: member.userId,
        },
      ]);
      const saved = inserted[0];
      if (!saved) throw new Error("The search could not be saved");
      let poolSize: number;
      try {
        const snapshot = await client.rpc<number | null>("start_triage", {
          p_org: member.orgId,
          p_search: saved.id,
        });
        poolSize = typeof snapshot === "number" && Number.isFinite(snapshot) ? snapshot : 0;
        await client.patch(
          "searches",
          { id: saved.id, org_id: member.orgId },
          { pool_size: poolSize },
        );
      } catch (error) {
        // A search without its snapshot would never finish: it goes, and the team runs it again.
        await client
          .delete("searches", { id: saved.id, org_id: member.orgId })
          .catch((cleanup: unknown) =>
            log("search_cleanup_failed", {
              searchId: saved.id,
              error: String(cleanup).slice(0, 300),
            }),
          );
        throw error;
      }
      console.info(
        "[briefs]",
        JSON.stringify({
          event: "search",
          orgId: member.orgId,
          briefId: brief.id,
          method: "triage",
          poolSize,
          criteriaDerived,
          roleProfileDerived,
          needsCheck,
        }),
      );
      return {
        searchId: saved.id,
        method: "triage",
        results: [],
        criteria: brief.criteria,
        criteriaDerived,
        roleProfileDerived,
        needsCheck,
        poolSize,
        createdAt: saved.created_at,
      };
    }

    // Without a model, up to FULL_POOL_MAX active candidates the whole pool is read, so no
    // profile is left out by a ranking; above it the hybrid retrieval
    // answers the RETRIEVAL_LIMIT best rows and the rest is not looked at.
    // The pool's size is stored with the search so the page can say which.
    let method: SearchMethod = "text";
    const retrieval = new Map<string, { textRank: number | null; vectorRank: number | null }>();
    const poolSize = await poolSizeOf(client, member.orgId);
    const fullPool = poolSize <= FULL_POOL_MAX;
    let profiles: ProfileRow[];
    if (!fullPool) {
      const embedding = await embedQuery(member.orgId, queryText);
      method = embedding ? "hybrid" : "text";
      const answer = await client.rpc<RetrievalRow[] | null>("search_candidates", {
        p_org: member.orgId,
        p_query: textQueryOf(brief),
        p_embedding: embedding ? vectorLiteral(embedding) : null,
        p_limit: RETRIEVAL_LIMIT,
      });
      const retrieved = (Array.isArray(answer) ? answer : [])
        .filter((row) => row && typeof row.candidate_id === "string")
        .slice(0, RETRIEVAL_LIMIT);
      for (const row of retrieved) {
        retrieval.set(row.candidate_id, {
          textRank: typeof row.text_rank === "number" ? row.text_rank : null,
          vectorRank: typeof row.vector_rank === "number" ? row.vector_rank : null,
        });
      }
      const byId = await loadProfiles(client, member.orgId, [...retrieval.keys()]);
      profiles = [...retrieval.keys()].flatMap((id) => {
        const profile = byId.get(id);
        return profile ? [profile] : [];
      });
    } else {
      profiles = await loadPool(client, member.orgId, FULL_POOL_MAX);
    }

    const scored = profiles.map((profile) =>
      scoreCandidate(
        brief.criteria,
        profile,
        retrieval.get(profile.id) ?? { textRank: null, vectorRank: null },
      ),
    );
    const results = rankResults(scored);

    const inserted = await client.insert<Pick<SearchRow, "id" | "created_at">>("searches", [
      {
        org_id: member.orgId,
        brief_id: brief.id,
        query: queryText,
        criteria: brief.criteria,
        results,
        result_count: results.length,
        method,
        pool_size: poolSize,
        ran_by: member.userId,
      },
    ]);
    const saved = inserted[0];
    if (!saved) throw new Error("The search could not be saved");
    console.info(
      "[briefs]",
      JSON.stringify({
        event: "search",
        orgId: member.orgId,
        briefId: brief.id,
        method,
        poolSize,
        fullPool,
        results: results.length,
        criteriaDerived,
        roleProfileDerived,
        needsCheck,
      }),
    );
    return {
      searchId: saved.id,
      method,
      results,
      criteria: brief.criteria,
      criteriaDerived,
      roleProfileDerived,
      needsCheck,
      poolSize,
      createdAt: saved.created_at,
    };
  });

// ---------------------------------------------------------------------
// the triage of the whole pool, forty profiles at a time
// ---------------------------------------------------------------------

const triageAnswer = z.object({
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

export interface TriageBatch {
  /** The candidates of the batch that hold a verdict now: read by this call, or already read before (never read twice). */
  done: string[];
  /** The candidates not read: outside the search's snapshot, or gone from the pool since (taken out of the snapshot). */
  failed: string[];
  /** The verdicts this call gave. */
  counts: Record<TriageVerdict, number>;
}

/** The search of the brief, run as a triage, without its results; NOT_FOUND or INPUT:invalid otherwise. */
async function loadTriageSearch(
  client: ServiceClient,
  orgId: string,
  briefId: string,
  searchId: string,
): Promise<SearchHead> {
  const search = await loadSearchHead(client, orgId, searchId);
  if (search.brief_id !== briefId) throw new AppError("NOT_FOUND");
  if (search.method !== "triage") throw new AppError("INPUT:invalid");
  return search;
}

/**
 * Takes out of a search's snapshot the candidates that left the active
 * pool since it was taken (archived; an erased one takes its row with
 * it): they are no longer candidates for the brief, and a row nobody
 * can read would keep the analysis from ever ending. Best effort, one
 * row at a time (rare): a row left is sent again and settled then.
 */
async function leaveSnapshot(
  client: ServiceClient,
  orgId: string,
  searchId: string,
  candidateIds: readonly string[],
): Promise<void> {
  for (const candidateId of candidateIds) {
    try {
      await client.delete("search_triage", {
        search_id: searchId,
        org_id: orgId,
        candidate_id: candidateId,
      });
    } catch (error) {
      log("triage_leave_failed", { searchId, candidateId, error: String(error).slice(0, 300) });
    }
  }
}

/**
 * One batch of the triage: the profiles of the snapshot that no model
 * read yet, as compact cards (no name, no contact, no place, no link,
 * no photo, no summary, no CV text), in one call; the answer bound by
 * enforceTriage() (one verdict per card, an unanswered card unknown, a
 * reason naming a protected characteristic withheld, a "no" on a card
 * that carries the job's name read anyway) and written in one statement
 * (record_triage). A model failure throws: the browser sends the batch
 * once more at the end.
 */
export const triageCandidates = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => triageInput.parse(data))
  .handler(async ({ data }): Promise<TriageBatch> => {
    const member = await requireMember(data.accessToken, data.orgId, "member");
    await enforceRateLimit("triage", { userKey: member.userId });
    if (!modelConfigured()) throw new AppError("SETUP:model");
    const client = db();
    const brief = await loadBrief(client, member.orgId, data.briefId);
    const search = await loadTriageSearch(client, member.orgId, brief.id, data.searchId);
    // The job as the search's criteria and the brief's profile name it today.
    const role = triageRoleBrief({
      title: brief.title,
      criteria: search.criteria,
      role_profile: brief.role_profile,
    });
    if (!role.title) throw new AppError("INPUT:invalid");

    const org = encodeURIComponent(member.orgId);
    const wanted: string[] = [...new Set<string>(data.candidateIds)];
    const list = wanted.map((id) => encodeURIComponent(id)).join(",");
    const rows = await client.select<Pick<SearchTriageRow, "candidate_id" | "verdict">>(
      `search_triage?select=candidate_id,verdict&org_id=eq.${org}&search_id=eq.${encodeURIComponent(search.id)}&candidate_id=in.(${list})`,
    );
    const snapshot = new Map(rows.map((row) => [row.candidate_id, row.verdict] as const));
    const settled = new Set<string>();
    const failed: string[] = [];
    const pending: string[] = [];
    for (const id of wanted) {
      if (!snapshot.has(id)) failed.push(id);
      else if (snapshot.get(id)) settled.add(id);
      else pending.push(id);
    }
    const counts: Record<TriageVerdict, number> = { yes: 0, close: 0, no: 0, unknown: 0 };
    const answer = (): TriageBatch => ({
      done: wanted.filter((id) => settled.has(id)),
      failed,
      counts,
    });
    if (!pending.length) return answer();

    const loaded = await client.select<TriageProfile>(
      `candidates?select=${TRIAGE_PROFILE_COLUMNS}&org_id=eq.${org}&status=eq.active&id=in.(${pending.map((id) => encodeURIComponent(id)).join(",")})`,
    );
    const byId = new Map(loaded.map((profile) => [profile.id, profile] as const));
    const profiles = pending.flatMap((id) => {
      const profile = byId.get(id);
      return profile ? [profile] : [];
    });
    const gone = pending.filter((id) => !byId.has(id));
    if (gone.length) {
      await leaveSnapshot(client, member.orgId, search.id, gone);
      failed.push(...gone);
      log("triage_left_pool", { searchId: search.id, gone: gone.length });
    }
    if (!profiles.length) return answer();

    const entries = triageEntries(profiles);
    const reply = await completeJson<ModelTriageAnswer>({
      system: triageSystemPrompt(),
      user: JSON.stringify(
        triagePayload(
          role,
          entries.map((entry) => entry.card),
        ),
      ),
      schema: triageAnswer,
      temperature: 0,
      maxTokens: TRIAGE_TOKENS_BASE + TRIAGE_TOKENS_PER_CARD * entries.length,
      model: settings().llm.assessmentModel,
    });
    await recordUsage(member.orgId, "triage", reply.usage);
    const outcomes = enforceTriage(entries, reply.value, triageRoleTerms(role));
    await client.rpc<number | null>("record_triage", {
      p_org: member.orgId,
      p_search: search.id,
      p_model: reply.usage.model,
      p_rows: [...outcomes].map(([candidateId, outcome]) => ({
        candidate_id: candidateId,
        verdict: outcome.verdict,
        reason: outcome.reason,
      })),
    });
    for (const candidateId of outcomes.keys()) settled.add(candidateId);
    const tally = countTriage(outcomes.values());
    counts.yes = tally.yes;
    counts.close = tally.close;
    counts.no = tally.no;
    counts.unknown = tally.unknown;
    console.info(
      "[briefs]",
      JSON.stringify({
        event: "triage",
        orgId: member.orgId,
        searchId: search.id,
        sent: entries.length,
        yes: tally.yes,
        close: tally.close,
        no: tally.no,
        unknown: tally.unknown,
        guarded: tally.guarded,
      }),
    );
    return answer();
  });

export interface PromotionResult {
  /** The search's results once the profiles the triage kept are in, as stored. */
  results: MatchResult[];
  /** How many entries this call added (0 when it ran before: nothing is added twice). */
  promoted: number;
  /** The profiles of the snapshot taken when the search ran. */
  poolSize: number;
}

/**
 * The verdict and the reason of every profile the triage kept, by
 * candidate id, read in pages by candidate id (each page starts after
 * the last id of the one before, so a verdict written meanwhile never
 * shifts a page), until a page comes back empty.
 */
async function readKeptTriage(
  client: ServiceClient,
  orgId: string,
  searchId: string,
): Promise<Map<string, { verdict: TriageVerdict; reason: string | null }>> {
  const kept = new Map<string, { verdict: TriageVerdict; reason: string | null }>();
  const base = `search_triage?select=candidate_id,verdict,reason&org_id=eq.${encodeURIComponent(orgId)}&search_id=eq.${encodeURIComponent(searchId)}&verdict=in.(${TRIAGE_PASSING.join(",")})&order=candidate_id.asc&limit=${TRIAGE_PAGE}`;
  let after: string | null = null;
  for (;;) {
    const path: string =
      after === null ? base : `${base}&candidate_id=gt.${encodeURIComponent(after)}`;
    const page =
      await client.select<Pick<SearchTriageRow, "candidate_id" | "verdict" | "reason">>(path);
    const last = page[page.length - 1];
    if (!last || typeof last.candidate_id !== "string") return kept;
    for (const row of page) {
      if (typeof row.candidate_id !== "string" || !isTriageVerdict(row.verdict)) continue;
      kept.set(row.candidate_id, {
        verdict: row.verdict,
        reason: typeof row.reason === "string" ? row.reason : null,
      });
    }
    after = last.candidate_id;
  }
}

/**
 * The profiles the triage kept (yes, close, unknown) brought into the
 * search's results, each scored by the deterministic pass and carrying
 * its triage verdict and reason, yes first, then close, then unknown,
 * then the score; only the ones not there yet, so running it twice
 * adds nothing, and a profile that left the pool since is left out.
 * No model call: the full reading comes next.
 */
export const promoteTriage = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => searchInput.parse(data))
  .handler(async ({ data }): Promise<PromotionResult> => {
    const member = await requireMember(data.accessToken, data.orgId, "member");
    await enforceRateLimit("search", { userKey: member.userId });
    const client = db();
    const brief = await loadBrief(client, member.orgId, data.briefId);
    const search = await loadSearch(client, member.orgId, data.searchId);
    if (search.brief_id !== brief.id) throw new AppError("NOT_FOUND");
    if (search.method !== "triage") throw new AppError("INPUT:invalid");

    const kept = await readKeptTriage(client, member.orgId, search.id);
    const stored = new Set(search.results.map((result) => result.candidateId));
    const fresh = [...kept.keys()].filter((id) => !stored.has(id));
    const entries: MatchResult[] = [];
    for (const lot of batchesOf(fresh, IDS_PER_QUERY)) {
      const profiles = await loadProfiles(client, member.orgId, lot);
      for (const id of lot) {
        const profile = profiles.get(id);
        const triage = kept.get(id);
        if (!profile || !triage) continue;
        entries.push({
          ...scoreCandidate(search.criteria, profile, { textRank: null, vectorRank: null }),
          triage,
        });
      }
    }
    entries.sort(triageOrder);
    for (let start = 0; start < entries.length; start += MERGE_CHUNK)
      await mergeResults(
        client,
        member.orgId,
        search.id,
        entries.slice(start, start + MERGE_CHUNK),
      );
    const after = entries.length ? await loadSearch(client, member.orgId, search.id) : search;
    console.info(
      "[briefs]",
      JSON.stringify({
        event: "promote",
        orgId: member.orgId,
        searchId: search.id,
        kept: kept.size,
        promoted: entries.length,
        left: fresh.length - entries.length,
      }),
    );
    return {
      results: after.results,
      promoted: entries.length,
      poolSize: after.pool_size ?? 0,
    };
  });

// ---------------------------------------------------------------------
// the expert assessment, a few candidates at a time
// ---------------------------------------------------------------------

const dimensionAnswer = z
  .object({
    score: z.number().nullable().optional(),
    note: z.string().nullable().optional(),
    evidence: z.string().nullable().optional(),
  })
  .nullable()
  .optional();

const sentences = z.array(z.string()).max(12).nullable().optional();

/** The dimensions and the lists are optional, so a model that answers the older shape still gets through (its score is then the score). */
const assessmentAnswer = z.object({
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

export interface AssessmentBatch {
  /** The entries of the search that received an assessment in this call, as stored. */
  results: MatchResult[];
  /** The candidates left unassessed: the model did not answer for them, or they left the pool. */
  failed: string[];
}

interface AssessmentJob {
  id: string;
  result: MatchResult;
  profile: AssessmentProfile;
}

type ItemPick = Pick<ShortlistItemRow, "id" | "candidate_id" | "match">;

/**
 * The assessed results carried to the brief's shortlist: an item added
 * before its batch returned holds the result of that moment, without
 * assessment, and nothing else would update it (members may insert a
 * match, never update one). Only an item whose match carries no
 * assessment yet is written, with the search's criteria alongside so the
 * board and the dossier read the verdicts against the right brief; an
 * item already assessed is left as the team saw it. Best effort: a
 * failure here is logged, the batch itself is already stored.
 */
async function carryToShortlist(
  client: ServiceClient,
  orgId: string,
  briefId: string,
  criteria: readonly BriefCriterion[],
  results: readonly MatchResult[],
): Promise<number> {
  const org = encodeURIComponent(orgId);
  const shortlists = await client.select<{ id: string }>(
    `shortlists?select=id&org_id=eq.${org}&brief_id=eq.${encodeURIComponent(briefId)}&limit=1`,
  );
  const shortlistId = shortlists[0]?.id;
  if (!shortlistId || !results.length) return 0;
  const byCandidate = new Map(results.map((result) => [result.candidateId, result] as const));
  const ids = [...byCandidate.keys()].map((id) => encodeURIComponent(id)).join(",");
  const items = await client.select<ItemPick>(
    `shortlist_items?select=id,candidate_id,match&org_id=eq.${org}&shortlist_id=eq.${encodeURIComponent(shortlistId)}&candidate_id=in.(${ids})`,
  );
  let written = 0;
  for (const item of items) {
    const result = byCandidate.get(item.candidate_id);
    if (!result || (item.match && typeof item.match === "object" && item.match.assessment))
      continue;
    const match: MatchResult = { ...result, criteria: [...criteria] };
    await client.patch("shortlist_items", { id: item.id, org_id: orgId }, { match });
    written += 1;
  }
  return written;
}

export const assessCandidates = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => assessInput.parse(data))
  .handler(async ({ data }): Promise<AssessmentBatch> => {
    const member = await requireMember(data.accessToken, data.orgId, "member");
    await enforceRateLimit("assess", { userKey: member.userId });
    if (!modelConfigured()) throw new AppError("SETUP:model");
    const client = db();
    const brief = await loadBrief(client, member.orgId, data.briefId);
    const search = await loadSearch(client, member.orgId, data.searchId);
    if (search.brief_id !== brief.id) throw new AppError("NOT_FOUND");

    // The verdicts and the rows shown refer to the criteria of the search,
    // so the assessment reads those: a brief edited since gets a new search.
    // With no criteria there is nothing to check: no model call is spent
    // on a decision that would rest on nothing (the panel does not ask).
    const criteria = search.criteria;
    if (!criteria.length) throw new AppError("INPUT:invalid");
    const briefText = briefTextOf(brief, criteria);
    const stored = new Map(search.results.map((result) => [result.candidateId, result] as const));
    const wanted: string[] = [...new Set<string>(data.candidateIds)];
    const failed: string[] = [];
    const profiles = await loadProfiles(client, member.orgId, wanted);
    const jobs: AssessmentJob[] = [];
    for (const id of wanted) {
      const result = stored.get(id);
      const profile = profiles.get(id);
      if (result && profile) jobs.push({ id, result, profile });
      else failed.push(id);
    }

    const model = settings().llm.assessmentModel;
    const maxTokens = Math.min(
      ASSESSMENT_TOKENS_MAX,
      ASSESSMENT_TOKENS_BASE + ASSESSMENT_TOKENS_PER_REQUIREMENT * criteria.length,
    );
    // A junior brief reads internships as positions; every quote is checked against the payload's texts.
    const junior = brief.role_profile?.seniority === "junior";
    const assessOne = async (job: AssessmentJob): Promise<Assessment> => {
      const payload = assessmentPayload(briefText, job.profile);
      const answer = await completeJson<ModelAssessmentAnswer>({
        system: assessmentSystemPrompt(),
        user: JSON.stringify(payload),
        schema: assessmentAnswer,
        temperature: 0,
        maxTokens,
        model,
      });
      await recordUsage(member.orgId, "assess", answer.usage);
      const options: EnforceOptions = { texts: payloadTexts(payload), junior };
      return enforceAssessment(
        criteria,
        job.result.verdicts,
        answer.value,
        answer.usage.model,
        options,
      );
    };
    // The batch runs in parallel; one failure leaves that candidate unassessed, never the batch.
    const outcomes = await Promise.allSettled(jobs.map((job) => assessOne(job)));
    const assessed = new Map<string, Assessment>();
    outcomes.forEach((outcome, index) => {
      const job = jobs[index];
      if (!job) return;
      if (outcome.status === "fulfilled") {
        assessed.set(job.id, outcome.value);
      } else {
        failed.push(job.id);
        log("assess_failed", {
          searchId: search.id,
          candidateId: job.id,
          error: String(outcome.reason).slice(0, 300),
        });
      }
    });
    if (!assessed.size) return { results: [], failed };

    const answered = await storeAssessments(client, member.orgId, search.id, stored, assessed);
    let carried = 0;
    try {
      carried = await carryToShortlist(client, member.orgId, brief.id, criteria, answered);
    } catch (error) {
      log("carry_failed", { searchId: search.id, error: String(error).slice(0, 300) });
    }
    console.info(
      "[briefs]",
      JSON.stringify({
        event: "assess",
        orgId: member.orgId,
        searchId: search.id,
        assessed: assessed.size,
        failed: failed.length,
        carried,
      }),
    );
    return { results: answered, failed };
  });

// ---------------------------------------------------------------------
// the second opinion on the retained profiles
// ---------------------------------------------------------------------

const challengeAnswer = z.object({
  verdict: z.string(),
  reason: z.string().nullable().optional(),
  evidence: z.string().nullable().optional(),
});

/**
 * The entries of a search with their new assessments, and only those,
 * merged into the row in one statement (merge_search_results): batches
 * sent in parallel add up, and an entry another batch wrote meanwhile
 * is left as it is. Two people on the same entry at once is
 * last-write-wins on that entry alone. Answers the entries as stored.
 */
async function storeAssessments(
  client: ServiceClient,
  orgId: string,
  searchId: string,
  stored: ReadonlyMap<string, MatchResult>,
  updated: ReadonlyMap<string, Assessment>,
): Promise<MatchResult[]> {
  const entries: MatchResult[] = [];
  for (const [candidateId, assessment] of updated) {
    const result = stored.get(candidateId);
    if (result) entries.push({ ...result, assessment });
  }
  await mergeResults(client, orgId, searchId, entries);
  return entries;
}

export const challengeCandidates = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => challengeInput.parse(data))
  .handler(async ({ data }): Promise<AssessmentBatch> => {
    const member = await requireMember(data.accessToken, data.orgId, "member");
    await enforceRateLimit("assess", { userKey: member.userId });
    if (!modelConfigured()) throw new AppError("SETUP:model");
    const client = db();
    const brief = await loadBrief(client, member.orgId, data.briefId);
    const search = await loadSearch(client, member.orgId, data.searchId);
    if (search.brief_id !== brief.id) throw new AppError("NOT_FOUND");
    const briefText = briefTextOf(brief, search.criteria);
    const stored = new Map(search.results.map((result) => [result.candidateId, result] as const));
    const wanted: string[] = [...new Set<string>(data.candidateIds)];
    const failed: string[] = [];
    const profiles = await loadProfiles(client, member.orgId, wanted);
    // Only a retained profile gets a second opinion; another decision sent by mistake is left as it is, not failed.
    const jobs: (AssessmentJob & { assessment: Assessment })[] = [];
    for (const id of wanted) {
      const result = stored.get(id);
      const profile = profiles.get(id);
      const assessment = result?.assessment;
      if (!result || !assessment) {
        failed.push(id);
        continue;
      }
      if (assessment.decision !== "fit") continue;
      if (profile) jobs.push({ id, result, profile, assessment });
      else failed.push(id);
    }

    const model = settings().llm.assessmentModel;
    const challengeOne = async (
      job: AssessmentJob & { assessment: Assessment },
    ): Promise<Assessment> => {
      const payload = challengePayload(briefText, job.profile, job.assessment);
      const answer = await completeJson<ModelChallengeAnswer>({
        system: challengeSystemPrompt(),
        user: JSON.stringify(payload),
        schema: challengeAnswer,
        temperature: 0,
        maxTokens: CHALLENGE_TOKENS,
        model,
      });
      await recordUsage(member.orgId, "assess", answer.usage);
      return applyChallenge(job.assessment, answer.value, { texts: payloadTexts(payload) });
    };
    const outcomes = await Promise.allSettled(jobs.map((job) => challengeOne(job)));
    const challenged = new Map<string, Assessment>();
    outcomes.forEach((outcome, index) => {
      const job = jobs[index];
      if (!job) return;
      if (outcome.status === "fulfilled") {
        challenged.set(job.id, outcome.value);
      } else {
        failed.push(job.id);
        log("challenge_failed", {
          searchId: search.id,
          candidateId: job.id,
          error: String(outcome.reason).slice(0, 300),
        });
      }
    });
    if (!challenged.size) return { results: [], failed };
    const results = await storeAssessments(client, member.orgId, search.id, stored, challenged);
    console.info(
      "[briefs]",
      JSON.stringify({
        event: "challenge",
        orgId: member.orgId,
        searchId: search.id,
        challenged: challenged.size,
        doubts: results.filter((result) => result.assessment?.challenge?.verdict === "doubt")
          .length,
        failed: failed.length,
      }),
    );
    return { results, failed };
  });

// ---------------------------------------------------------------------
// the comparative tiering of a group
// ---------------------------------------------------------------------

const rankingAnswer = z.object({
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

export const rankCandidates = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => rankInput.parse(data))
  .handler(async ({ data }): Promise<AssessmentBatch> => {
    const member = await requireMember(data.accessToken, data.orgId, "member");
    await enforceRateLimit("assess", { userKey: member.userId });
    if (!modelConfigured()) throw new AppError("SETUP:model");
    const client = db();
    const brief = await loadBrief(client, member.orgId, data.briefId);
    const search = await loadSearch(client, member.orgId, data.searchId);
    if (search.brief_id !== brief.id) throw new AppError("NOT_FOUND");
    const stored = new Map(search.results.map((result) => [result.candidateId, result] as const));
    const wanted: string[] = [...new Set<string>(data.candidateIds)];
    const failed: string[] = [];
    // The sheets compare assessed, retained or borderline profiles; anything else in the group is left out.
    const group: MatchResult[] = [];
    for (const id of wanted) {
      const result = stored.get(id);
      const decision = result?.assessment?.decision;
      if (result && (decision === "fit" || decision === "borderline")) group.push(result);
      else failed.push(id);
    }
    if (group.length < RANK_GROUP_MIN) return { results: [], failed };

    const sheets = rankingSheets(group, search.criteria);
    const answer = await completeJson<ModelRankingAnswer>({
      system: rankingSystemPrompt(),
      user: JSON.stringify(
        rankingPayload(
          { title: brief.title, criteria: search.criteria, roleProfile: brief.role_profile },
          sheets,
        ),
      ),
      schema: rankingAnswer,
      temperature: 0,
      maxTokens: Math.min(2000, RANKING_TOKENS_PER_CANDIDATE * group.length + 200),
      model: settings().llm.assessmentModel,
    });
    await recordUsage(member.orgId, "assess", answer.usage);
    const groupIds = new Set(group.map((result) => result.candidateId));
    const ranked = applyRanking(group, {
      ranking: answer.value.ranking.filter((entry) => groupIds.has(entry.candidateId)),
    });
    const tiered = new Map<string, Assessment>();
    for (const result of ranked) {
      if (result.assessment?.tier) tiered.set(result.candidateId, result.assessment);
    }
    // A candidate the model left out of its answer is not failed: it simply has no tier yet, and the next run sends it again.
    if (!tiered.size) return { results: [], failed };
    const results = await storeAssessments(client, member.orgId, search.id, stored, tiered);
    console.info(
      "[briefs]",
      JSON.stringify({
        event: "rank",
        orgId: member.orgId,
        searchId: search.id,
        group: group.length,
        tiered: tiered.size,
        failed: failed.length,
      }),
    );
    return { results, failed };
  });
