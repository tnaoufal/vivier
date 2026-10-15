/**
 * Server functions of the briefs: what the deployment can do (a model
 * or not); the one reading of a brief (the role profile and the
 * criteria, the role first, in one model call bound by
 * enforceBriefReading() and saved into the brief), made by the search
 * when the brief was never read or its text changed since
 * (needsDerivation), and by the two older surfaces kept until the page
 * work removes them (extractCriteria proposes without saving,
 * regenerateRoleProfile reads and saves); the search of the talent pool
 * for a brief (with a model, a snapshot of every active profile for the
 * triage, and without one the whole pool up to FULL_POOL_MAX active
 * candidates, else the hybrid retrieval, scored by the deterministic
 * verdicts), stored as a searches row; the triage of the snapshot
 * (forty compact cards per call, enforced by triage.ts, written to
 * search_triage), the snapshot extended to the profiles the pool gained
 * since, the promotion of the profiles it kept into the results, and a
 * profile it set aside that a person brings back to be read in full;
 * and the three passes the browser drives on the results: the screening
 * of a few candidates at a time (one model call per candidate, enforced
 * by assessment.ts, merged into the row entry by entry and carried to
 * the brief's shortlist items that still hold an unassessed match), the
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
  AiUsageKind,
  Assessment,
  BriefCriterion,
  BriefRow,
  MatchResult,
  RoleProfile,
  SearchMethod,
  SearchRow,
  SearchTriageRow,
  ShortlistItemRow,
  TriageVerdict,
} from "@/lib/db/types";
import {
  completeJson,
  embed,
  modelConfigured,
  usageOf,
  vectorLiteral,
  type JsonAnswer,
  type JsonRequest,
} from "@/lib/model/model.server";
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
import { countProtected, parseCriteria, roleCriterion } from "./criteria";
import { rankResults, scoreCandidate } from "./matching";
import { roleChangedSince } from "./presentation";
import {
  assessmentPayload,
  assessmentSystemPrompt,
  challengePayload,
  challengeSystemPrompt,
  enforceBriefReading,
  FULL_POOL_MAX,
  payloadTexts,
  queryTextOf,
  readBriefAnswer,
  readBriefPrompt,
  RETRIEVAL_LIMIT,
  textQueryOf,
  type AssessmentProfile,
  type BriefReading,
  type BriefReadingAnswer,
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
import { jobTitleOf, needsDerivation, parseRoleProfile } from "./role-profile";
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
  type TriageEntry,
  type TriageOutcome,
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
/**
 * The one reading of a brief answers the role profile (about 1200
 * tokens in French with its lists full) and up to twelve criteria with
 * their labels and the role's definition (about 800 more): a budget
 * below that cuts the JSON and fails the reading.
 */
const READ_BRIEF_TOKENS = 3200;
const CHALLENGE_TOKENS = 400;
/** One line per candidate of the group. */
const RANKING_TOKENS_PER_CANDIDATE = 120;
/**
 * A triage answer: the envelope, then one verdict per card with a reason
 * of fifteen words at most (about 25 to 40 tokens in French, 60 to 80
 * with the JSON around it, more when the model indents it); a budget
 * below that cuts the JSON and fails the whole batch.
 */
const TRIAGE_TOKENS_BASE = 600;
const TRIAGE_TOKENS_PER_CARD = 110;
/**
 * The most model calls one triage batch makes: the batch, then the
 * halves of a part the model could not answer, down to the card that
 * fails (six levels for forty cards, two calls each).
 */
const TRIAGE_CALLS_PER_BATCH = 16;
/** The most unread searches of a brief one run takes away. */
const UNREAD_SEARCHES_MAX = 10;
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

/**
 * One model call with its cost recorded in ai_usage, whether it answered
 * or not: a call that fails after attempts the provider billed carries
 * them (ModelAnswerError), and the error then goes on to the caller.
 */
async function completeBilled<T>(
  orgId: string,
  kind: AiUsageKind,
  request: JsonRequest<T>,
): Promise<JsonAnswer<T>> {
  let answer: JsonAnswer<T>;
  try {
    answer = await completeJson<T>(request);
  } catch (error) {
    const usage = usageOf(error);
    if (usage) await recordUsage(orgId, kind, usage);
    throw error;
  }
  await recordUsage(orgId, kind, answer.usage);
  return answer;
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
// the one reading of a brief: the role profile and the criteria
// ---------------------------------------------------------------------

/**
 * One call, at temperature 0 so the same brief gives the same reading,
 * that answers the role profile and the criteria together, bound by
 * enforceBriefReading() (a protected characteristic dropped and logged,
 * the role first with the profile's definition, EXTRACTION_MAX
 * criteria). Nothing is saved here. Throws when the model does not
 * answer: the caller decides whether the search goes on without it.
 */
async function readBrief(orgId: string, brief: LoadedBrief): Promise<BriefReading> {
  const prompt = readBriefPrompt(brief);
  const answer = await completeBilled<BriefReadingAnswer>(orgId, "brief", {
    system: prompt.system,
    user: prompt.user,
    schema: readBriefAnswer,
    temperature: 0,
    maxTokens: READ_BRIEF_TOKENS,
  });
  const reading = enforceBriefReading(brief, answer.value, {
    model: answer.usage.model,
    createdAt: new Date().toISOString(),
  });
  if (reading.dropped > 0)
    log("brief_reading_protected", { briefId: brief.id, dropped: reading.dropped });
  if (!roleCriterion(reading.criteria)) log("role_unnamed", { briefId: brief.id });
  return reading;
}

/** The reading saved into the brief, the profile and the criteria in one write, so a search never reads one without the other. */
async function saveReading(
  client: ServiceClient,
  orgId: string,
  brief: LoadedBrief,
  reading: BriefReading,
): Promise<void> {
  await client.patch(
    "briefs",
    { id: brief.id, org_id: orgId },
    { role_profile: reading.profile, criteria: reading.criteria },
  );
}

/**
 * The reading of a brief the search needs before anything else (no
 * profile, or one read from another text: needsDerivation), saved into
 * the brief. Null when there is no job to name (neither a title nor a
 * text), or when a brief never read could not be (logged: the search
 * then runs on its text alone). A brief read before whose reading fails
 * throws instead: its stored profile and criteria are of another text,
 * and an analysis resting on them would pretend.
 */
async function deriveBrief(
  client: ServiceClient,
  orgId: string,
  brief: LoadedBrief,
): Promise<BriefReading | null> {
  if (!jobTitleOf(brief)) return null;
  try {
    const reading = await readBrief(orgId, brief);
    await saveReading(client, orgId, brief, reading);
    return reading;
  } catch (error) {
    log("brief_reading_failed", { briefId: brief.id, error: String(error).slice(0, 300) });
    if (brief.role_profile) throw error;
    return null;
  }
}

export interface ExtractionResult {
  /** The criteria as one reading answers them, the role first; nothing saved. */
  criteria: BriefCriterion[];
  /** The model's sentences about requests it dropped, in the brief's language. */
  warnings: string[];
  /** Criteria and fields dropped because they named a protected characteristic. */
  dropped: number;
}

/**
 * Kept for the criteria editor's proposals until the page work removes
 * that surface (the criteria are the brief's reading, not the team's):
 * the criteria of one reading, proposed, nothing saved.
 */
export const extractCriteria = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => briefInput.parse(data))
  .handler(async ({ data }): Promise<ExtractionResult> => {
    const member = await requireMember(data.accessToken, data.orgId, "member");
    await enforceRateLimit("model", { userKey: member.userId });
    if (!modelConfigured()) throw new AppError("SETUP:model");
    const brief = await loadBrief(db(), member.orgId, data.briefId);
    const reading = await readBrief(member.orgId, brief);
    return { criteria: reading.criteria, warnings: reading.warnings, dropped: reading.dropped };
  });

export interface RoleProfileResult {
  roleProfile: RoleProfile;
}

/**
 * Kept for the role card's "regenerate" until the page work removes
 * that surface: the brief read again and saved, the profile and the
 * criteria together, as the next search would do it.
 */
export const regenerateRoleProfile = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => briefInput.parse(data))
  .handler(async ({ data }): Promise<RoleProfileResult> => {
    const member = await requireMember(data.accessToken, data.orgId, "member");
    await enforceRateLimit("model", { userKey: member.userId });
    if (!modelConfigured()) throw new AppError("SETUP:model");
    const client = db();
    const brief = await loadBrief(client, member.orgId, data.briefId);
    if (!jobTitleOf(brief)) throw new AppError("INPUT:invalid");
    const reading = await readBrief(member.orgId, brief);
    await saveReading(client, member.orgId, brief, reading);
    console.info(
      "[briefs]",
      JSON.stringify({
        event: "role_profile",
        orgId: member.orgId,
        briefId: brief.id,
        model: reading.profile.model,
      }),
    );
    return { roleProfile: reading.profile };
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
   * True when the brief's criteria were read from its text and saved
   * into it before the search: the brief had never been read, or its
   * text changed since (one reading answers them with the profile).
   */
  criteriaDerived: boolean;
  /** True when the role profile was read from the brief's text and saved before the search, with the criteria. */
  roleProfileDerived: boolean;
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
 * The member's earlier whole-pool searches of the brief that nothing was
 * read of (no verdict, no result): one stopped before its first batch
 * landed, or left by a tab closed as it started. They go when the member
 * runs a new search, so the list of analyses holds none that never
 * started; a colleague's are left alone (their tab may be starting one).
 * Best effort: a failure is logged and the new search stands.
 */
async function dropUnreadSearches(
  client: ServiceClient,
  orgId: string,
  briefId: string,
  userId: string,
  keep: string,
): Promise<void> {
  const org = encodeURIComponent(orgId);
  try {
    const rows = await client.select<Pick<SearchRow, "id">>(
      `searches?select=id&org_id=eq.${org}&brief_id=eq.${encodeURIComponent(briefId)}&ran_by=eq.${encodeURIComponent(userId)}&method=eq.triage&result_count=eq.0&id=neq.${encodeURIComponent(keep)}&order=created_at.desc&limit=${UNREAD_SEARCHES_MAX}`,
    );
    let dropped = 0;
    for (const row of rows) {
      const read = await client.count(
        `search_triage?select=candidate_id&org_id=eq.${org}&search_id=eq.${encodeURIComponent(row.id)}&verdict=not.is.null`,
      );
      if (read > 0) continue;
      await client.delete("searches", { id: row.id, org_id: orgId });
      dropped += 1;
    }
    if (dropped) log("unread_searches_dropped", { briefId, dropped });
  } catch (error) {
    log("unread_searches_failed", { briefId, error: String(error).slice(0, 300) });
  }
}

export const runSearch = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => briefInput.parse(data))
  .handler(async ({ data }): Promise<SearchResult> => {
    const member = await requireMember(data.accessToken, data.orgId, "member");
    await enforceRateLimit("search", { userKey: member.userId });
    const client = db();
    const loaded = await loadBrief(client, member.orgId, data.briefId);

    // The brief is the only source: one never read, or whose text changed
    // since it was, is read once (the role profile and the criteria, the
    // role first) before anything else; otherwise its stored reading
    // stands and no model call comes before the triage.
    let brief = loaded;
    let roleProfileDerived = false;
    let criteriaDerived = false;
    if (modelConfigured() && needsDerivation(loaded)) {
      const reading = await deriveBrief(client, member.orgId, loaded);
      if (reading) {
        brief = { ...loaded, role_profile: reading.profile, criteria: reading.criteria };
        roleProfileDerived = true;
        criteriaDerived = true;
      }
    }
    const queryText = queryTextOf(brief);

    // With a model every active profile of the pool is read: the search
    // stores a snapshot of the pool (search_triage, one row per active
    // candidate, in one statement) and the browser drives its triage,
    // then the promotion of the profiles kept into the results. Nothing
    // is retrieved, embedded or scored here. A brief that names no job
    // has nothing to sort on, and one without criteria nothing to read
    // the profiles kept against: both take the path below.
    if (modelConfigured() && brief.criteria.length > 0 && triageRoleBrief(brief).title) {
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
      await dropUnreadSearches(client, member.orgId, brief.id, member.userId, saved.id);
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
        }),
      );
      return {
        searchId: saved.id,
        method: "triage",
        results: [],
        criteria: brief.criteria,
        criteriaDerived,
        roleProfileDerived,
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
      }),
    );
    return {
      searchId: saved.id,
      method,
      results,
      criteria: brief.criteria,
      criteriaDerived,
      roleProfileDerived,
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
 * True for a failure a smaller batch may get past: the model answered
 * no valid JSON (cut at its length, or turned away by a filter), or the
 * call timed out or was refused for what it carried (400, 413). A
 * failure of the provider (its rate, the key, a server error), of the
 * setup or of the rate limit is the same for any batch: it is thrown
 * as it is.
 */
function failedOnContent(error: unknown): boolean {
  if (error instanceof AppError) return false;
  const status =
    typeof error === "object" && error !== null && "status" in error ? error.status : undefined;
  return typeof status !== "number" || status === 400 || status === 413;
}

/**
 * One batch of the triage: the profiles of the snapshot that no model
 * read yet, as compact cards (no name, no contact, no place, no link,
 * no photo, no summary, no CV text), in one call; the answer bound by
 * enforceTriage() (one verdict per card, an unanswered card unknown, a
 * reason naming a protected characteristic withheld, a "no" on a card
 * that carries the job's name read anyway) and written in one statement
 * (record_triage). A batch the model cannot answer is read again in
 * halves, down to the card that fails, which is settled "unknown" and
 * read in full (a batch that fails the same way on every try would
 * otherwise stay unread for good); each part read is written at once.
 * When both halves fail before any part went through, the model is
 * failing, not a card: the call throws, what was written stays, and the
 * browser sends the batch once more at the end.
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
    // Every batch of one search sorts on one job: once the brief's text
    // changed and was read again since the search ran, the batches left
    // would read another one, so the search stops here and a new one runs.
    if (roleChangedSince(brief.role_profile, search.criteria))
      throw new AppError("INPUT:job_changed");
    // The job as the brief's profile names it today, else as the search's role criterion does.
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
    const terms = triageRoleTerms(role);
    const outcomes = new Map<string, TriageOutcome>();
    let calls = 0;
    let answered = false;
    let unanswered = 0;
    let lastError: unknown = null;
    /** The verdicts of a part in one statement; the model is null for a card no model answered. */
    const write = async (
      part: ReadonlyMap<string, TriageOutcome>,
      model: string | null,
    ): Promise<void> => {
      await client.rpc<number | null>("record_triage", {
        p_org: member.orgId,
        p_search: search.id,
        p_model: model,
        p_rows: [...part].map(([candidateId, outcome]) => ({
          candidate_id: candidateId,
          verdict: outcome.verdict,
          reason: outcome.reason,
        })),
      });
      for (const [candidateId, outcome] of part) {
        outcomes.set(candidateId, outcome);
        settled.add(candidateId);
      }
    };
    /** One call on a part of the batch (its cards keep their refs): true once its verdicts are written. */
    const read = async (part: readonly TriageEntry[]): Promise<boolean> => {
      if (calls >= TRIAGE_CALLS_PER_BATCH)
        throw lastError instanceof Error ? lastError : new Error("triage_calls_exhausted");
      calls += 1;
      const reply = await completeBilled<ModelTriageAnswer>(member.orgId, "triage", {
        system: triageSystemPrompt(),
        user: JSON.stringify(
          triagePayload(
            role,
            part.map((entry) => entry.card),
          ),
        ),
        schema: triageAnswer,
        temperature: 0,
        maxTokens: TRIAGE_TOKENS_BASE + TRIAGE_TOKENS_PER_CARD * part.length,
        model: settings().llm.assessmentModel,
      }).catch((error: unknown) => {
        if (!failedOnContent(error)) throw error;
        lastError = error;
        log("triage_part_failed", {
          searchId: search.id,
          cards: part.length,
          error: String(error).slice(0, 300),
        });
        return null;
      });
      if (!reply) return false;
      answered = true;
      await write(enforceTriage(part, reply.value, terms), reply.usage.model);
      return true;
    };
    /** A part the model could not answer: one card is settled unknown, a larger part read again in halves. */
    const recover = async (part: readonly TriageEntry[]): Promise<void> => {
      const [only] = part;
      if (part.length === 1 && only) {
        await write(
          new Map([[only.candidateId, { verdict: "unknown", reason: null, guarded: false }]]),
          null,
        );
        unanswered += 1;
        return;
      }
      const half = Math.ceil(part.length / 2);
      const halves = [part.slice(0, half), part.slice(half)];
      // Both halves in flight at once; a refusal of one is thrown once the other has landed.
      const tries = await Promise.allSettled(halves.map((piece) => read(piece)));
      const missed: TriageEntry[][] = [];
      for (const [index, attempt] of tries.entries()) {
        if (attempt.status === "rejected") throw attempt.reason;
        const piece = halves[index];
        if (!attempt.value && piece) missed.push(piece);
      }
      if (missed.length === halves.length && !answered)
        throw lastError instanceof Error ? lastError : new Error("triage_failed");
      for (const piece of missed) await recover(piece);
    };
    if (!(await read(entries))) await recover(entries);
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
        calls,
        unanswered,
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
 * The profiles given (with the triage's verdict and reason each) brought
 * into the search's results, each scored by the deterministic pass and
 * carrying its triage, yes first, then close, then unknown, then the
 * score; only the ones the results do not hold yet, so nothing is added
 * twice. A profile that left the pool since is left out, and out of the
 * snapshot (as the triage does), so the profiles kept and the results
 * stay the same set. Answers the entries added and the ones gone.
 */
async function promote(
  client: ServiceClient,
  orgId: string,
  search: LoadedSearch,
  kept: ReadonlyMap<string, { verdict: TriageVerdict; reason: string | null }>,
): Promise<{ entries: MatchResult[]; gone: string[] }> {
  const stored = new Set(search.results.map((result) => result.candidateId));
  const fresh = [...kept.keys()].filter((id) => !stored.has(id));
  const entries: MatchResult[] = [];
  for (const lot of batchesOf(fresh, IDS_PER_QUERY)) {
    const profiles = await loadProfiles(client, orgId, lot);
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
  // A profile kept that left the pool before its promotion leaves the
  // snapshot too: its passing verdict would otherwise count among the
  // kept for good, and the analysis would read as unfinished on every visit.
  const added = new Set(entries.map((entry) => entry.candidateId));
  const gone = fresh.filter((id) => !added.has(id));
  if (gone.length) await leaveSnapshot(client, orgId, search.id, gone);
  entries.sort(triageOrder);
  for (let start = 0; start < entries.length; start += MERGE_CHUNK)
    await mergeResults(client, orgId, search.id, entries.slice(start, start + MERGE_CHUNK));
  return { entries, gone };
}

/**
 * The profiles the triage kept (yes, close, unknown) brought into the
 * search's results (promote()); running it twice adds nothing. No model
 * call: the full reading comes next.
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
    const { entries, gone } = await promote(client, member.orgId, search, kept);
    const after = entries.length ? await loadSearch(client, member.orgId, search.id) : search;
    console.info(
      "[briefs]",
      JSON.stringify({
        event: "promote",
        orgId: member.orgId,
        searchId: search.id,
        kept: kept.size,
        promoted: entries.length,
        left: gone.length,
      }),
    );
    return {
      results: after.results,
      promoted: entries.length,
      poolSize: after.pool_size ?? 0,
    };
  });

export interface ExtensionResult {
  /** The profiles the snapshot gained: active now, absent from it before. */
  added: number;
  /** The profiles of the snapshot now. */
  poolSize: number;
}

/**
 * The snapshot of a whole-pool search extended to the active profiles
 * the pool gained since it was taken (imported, or back from the
 * archive), so "every profile of the pool" stays true when the analysis
 * resumes: start_triage again, which adds only what is missing and
 * writes the snapshot's size itself. No model call; the triage reads
 * them next.
 */
export const extendTriage = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => searchInput.parse(data))
  .handler(async ({ data }): Promise<ExtensionResult> => {
    const member = await requireMember(data.accessToken, data.orgId, "member");
    await enforceRateLimit("search", { userKey: member.userId });
    const client = db();
    const search = await loadTriageSearch(client, member.orgId, data.briefId, data.searchId);
    const added = await client.rpc<number | null>("start_triage", {
      p_org: member.orgId,
      p_search: search.id,
    });
    const count = typeof added === "number" && Number.isFinite(added) ? Math.max(0, added) : 0;
    const after = count ? await loadSearchHead(client, member.orgId, search.id) : search;
    if (count)
      console.info(
        "[briefs]",
        JSON.stringify({
          event: "triage_extended",
          orgId: member.orgId,
          searchId: search.id,
          added: count,
        }),
      );
    return { added: count, poolSize: after.pool_size ?? 0 };
  });

export interface ReadAnywayResult {
  /** The profile's entry in the results, as stored; null when it left the pool (it leaves the snapshot too). */
  entry: MatchResult | null;
}

const readAnywayInput = searchInput.extend({
  candidateId: z.uuid(),
});

/**
 * A profile the triage set aside, brought back by a person to be read
 * in full: its "no" becomes "close", without the model's reason or name
 * (the verdict is no longer the model's), then it enters the results
 * like a profile the triage kept, and the next resume reads it. A
 * person decides, not the model: this is the way past a wrong "no". A
 * profile already brought back is answered as it is; one never set
 * aside, or outside the snapshot, is refused.
 */
export const readAnyway = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => readAnywayInput.parse(data))
  .handler(async ({ data }): Promise<ReadAnywayResult> => {
    const member = await requireMember(data.accessToken, data.orgId, "member");
    await enforceRateLimit("search", { userKey: member.userId });
    const client = db();
    const brief = await loadBrief(client, member.orgId, data.briefId);
    const head = await loadTriageSearch(client, member.orgId, brief.id, data.searchId);
    const match = {
      search_id: head.id,
      org_id: member.orgId,
      candidate_id: data.candidateId,
    };
    const changed = await client.patch<Pick<SearchTriageRow, "candidate_id">>(
      "search_triage",
      { ...match, verdict: "no" },
      { verdict: "close", reason: null, model: null },
    );
    if (!changed.length) {
      // Already brought back (by a colleague, or a click sent twice): the promotion below adds nothing twice.
      const rows = await client.select<Pick<SearchTriageRow, "verdict">>(
        `search_triage?select=verdict&org_id=eq.${encodeURIComponent(member.orgId)}&search_id=eq.${encodeURIComponent(head.id)}&candidate_id=eq.${encodeURIComponent(data.candidateId)}&limit=1`,
      );
      const verdict = rows[0]?.verdict;
      if (!verdict || !TRIAGE_PASSING.includes(verdict)) throw new AppError("INPUT:invalid");
    }
    const search = await loadSearch(client, member.orgId, head.id);
    const stored = search.results.find((result) => result.candidateId === data.candidateId);
    if (stored) return { entry: stored };
    const { entries } = await promote(
      client,
      member.orgId,
      search,
      new Map([[data.candidateId, { verdict: "close" as const, reason: null }]]),
    );
    console.info(
      "[briefs]",
      JSON.stringify({
        event: "read_anyway",
        orgId: member.orgId,
        searchId: search.id,
        userId: member.userId,
        promoted: entries.length,
      }),
    );
    return { entry: entries[0] ?? null };
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
      const answer = await completeBilled<ModelAssessmentAnswer>(member.orgId, "assess", {
        system: assessmentSystemPrompt(),
        user: JSON.stringify(payload),
        schema: assessmentAnswer,
        temperature: 0,
        maxTokens,
        model,
      });
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
      const answer = await completeBilled<ModelChallengeAnswer>(member.orgId, "assess", {
        system: challengeSystemPrompt(),
        user: JSON.stringify(payload),
        schema: challengeAnswer,
        temperature: 0,
        maxTokens: CHALLENGE_TOKENS,
        model,
      });
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
    const answer = await completeBilled<ModelRankingAnswer>(member.orgId, "assess", {
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
