/**
 * Server functions of the briefs: what the deployment can do (a model
 * or not), the criteria a model proposes from a brief's text, the search
 * of the talent pool for a brief (the whole pool up to FULL_POOL_MAX
 * active candidates, else the hybrid retrieval; then the deterministic
 * verdicts, stored as a searches row), and the expert assessment of a
 * few results at a time (one model call per candidate, enforced by
 * assessment.ts, written back into the same row and carried to the
 * brief's shortlist items that still hold an unassessed match, so the
 * board and the dossier show what the brief page shows). Every handler
 * reads the caller from the access token through requireMember() and
 * works only on the organisation it verified. Nothing here decides: the
 * model proposes, the row keeps its reading, a person retains.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import type {
  Assessment,
  BriefCriterion,
  BriefRow,
  MatchResult,
  SearchMethod,
  SearchRow,
  ShortlistItemRow,
} from "@/lib/db/types";
import { completeJson, embed, modelConfigured, vectorLiteral } from "@/lib/model/model.server";
import { AppError } from "@/lib/platform/errors";
import { enforceRateLimit } from "@/lib/platform/rate-limit.server";
import { settings } from "@/lib/platform/settings.server";
import { db, requireMember, type ServiceClient } from "@/lib/platform/supabase.server";
import { recordUsage } from "@/lib/platform/usage.server";

import { ASSESS_BATCH_MAX, enforceAssessment, type ModelAssessmentAnswer } from "./assessment";
import {
  countProtected,
  isCriterionKind,
  LABEL_MAX,
  parseCriteria,
  protectedCriterion,
  toWeight,
  VALUE_MAX,
  withId,
} from "./criteria";
import { rankResults, scoreCandidate } from "./matching";
import {
  assessmentPayload,
  assessmentSystemPrompt,
  EXTRACTION_MAX,
  extractionSystemPrompt,
  extractionUserPrompt,
  FULL_POOL_MAX,
  queryTextOf,
  RETRIEVAL_LIMIT,
  textQueryOf,
  type AssessmentProfile,
} from "./prompts";

/** The answer's budget grows with the requirements: six of them make about 900 tokens. */
const ASSESSMENT_TOKENS_BASE = 600;
const ASSESSMENT_TOKENS_PER_REQUIREMENT = 50;
const ASSESSMENT_TOKENS_MAX = 2000;

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

type LoadedBrief = Pick<BriefRow, "id" | "title" | "description"> & { criteria: BriefCriterion[] };

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

/** The brief of the organisation, criteria parsed, or NOT_FOUND. */
async function loadBrief(client: ServiceClient, orgId: string, briefId: string): Promise<LoadedBrief> {
  const rows = await client.select<Pick<BriefRow, "id" | "title" | "description" | "criteria">>(
    `briefs?select=id,title,description,criteria&org_id=eq.${encodeURIComponent(orgId)}&id=eq.${encodeURIComponent(briefId)}&limit=1`,
  );
  const row = rows[0];
  if (!row) throw new AppError("NOT_FOUND");
  return { id: row.id, title: row.title, description: row.description, criteria: criteriaOf(row.criteria, { briefId: row.id }) };
}

type LoadedSearch = Pick<SearchRow, "id" | "brief_id" | "criteria" | "results">;

/** One search of the organisation with its stored results and the criteria of the time, or NOT_FOUND. */
async function loadSearch(client: ServiceClient, orgId: string, searchId: string): Promise<LoadedSearch> {
  const rows = await client.select<LoadedSearch>(
    `searches?select=id,brief_id,criteria,results&org_id=eq.${encodeURIComponent(orgId)}&id=eq.${encodeURIComponent(searchId)}&limit=1`,
  );
  const row = rows[0];
  if (!row) throw new AppError("NOT_FOUND");
  return {
    id: row.id,
    brief_id: row.brief_id,
    criteria: criteriaOf(row.criteria, { searchId: row.id }),
    results: Array.isArray(row.results) ? row.results : [],
  };
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
  criteria: { kind: string; label: string; value: string; required?: boolean | undefined; weight?: number | undefined }[];
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

/** One extraction call: the model's proposals cleaned, capped, and stripped of protected characteristics. */
async function proposeCriteria(orgId: string, brief: LoadedBrief): Promise<ExtractionResult> {
  const answer = await completeJson<ExtractionAnswer>({
    system: extractionSystemPrompt(),
    user: extractionUserPrompt(brief),
    schema: extractionAnswer,
    maxTokens: 1500,
  });
  await recordUsage(orgId, "brief", answer.usage);
  const criteria: BriefCriterion[] = [];
  let dropped = 0;
  for (const item of answer.value.criteria) {
    const label = item.label.trim().slice(0, LABEL_MAX);
    const value = item.value.trim().slice(0, VALUE_MAX);
    if (!label || !value) continue;
    if (protectedCriterion(label, value)) {
      dropped += 1;
      continue;
    }
    criteria.push(
      withId({
        kind: isCriterionKind(item.kind) ? item.kind : "other",
        label,
        value,
        required: item.required === true,
        weight: toWeight(item.weight),
      }),
    );
    if (criteria.length >= EXTRACTION_MAX) break;
  }
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
  method: SearchMethod;
  /** Ranked by the deterministic pass: not blocked first, then score, then coverage. No assessment yet. */
  results: MatchResult[];
  /** The criteria the verdicts refer to, as they were at run time. */
  criteria: BriefCriterion[];
  /** True when the brief had no criteria and the model derived them from its text (saved into the brief). */
  criteriaDerived: boolean;
  /** Active candidates in the pool at run time: above FULL_POOL_MAX only the retrieved rows were read, and the panel says so. */
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
  return client.count(`candidates?select=id&org_id=eq.${encodeURIComponent(orgId)}&status=eq.active`);
}

/** The active profiles of the organisation, newest first, `limit` at most. */
async function loadPool(client: ServiceClient, orgId: string, limit: number): Promise<ProfileRow[]> {
  return client.select<ProfileRow>(
    `candidates?select=${PROFILE_COLUMNS}&org_id=eq.${encodeURIComponent(orgId)}&status=eq.active&order=updated_at.desc&limit=${limit}`,
  );
}

/** The active profiles among `ids`, by id; one archived or erased since is absent. */
async function loadProfiles(client: ServiceClient, orgId: string, ids: readonly string[]): Promise<Map<string, ProfileRow>> {
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
async function deriveCriteria(client: ServiceClient, orgId: string, brief: LoadedBrief): Promise<BriefCriterion[] | null> {
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

export const runSearch = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => briefInput.parse(data))
  .handler(async ({ data }): Promise<SearchResult> => {
    const member = await requireMember(data.accessToken, data.orgId, "member");
    await enforceRateLimit("search", { userKey: member.userId });
    const client = db();
    const loaded = await loadBrief(client, member.orgId, data.briefId);

    let criteriaDerived = false;
    let brief = loaded;
    if (!loaded.criteria.length && modelConfigured()) {
      const derived = await deriveCriteria(client, member.orgId, loaded);
      if (derived) {
        brief = { ...loaded, criteria: derived };
        criteriaDerived = true;
      }
    }
    const queryText = queryTextOf(brief);

    // Up to FULL_POOL_MAX active candidates the whole pool is read, so no
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
      scoreCandidate(brief.criteria, profile, retrieval.get(profile.id) ?? { textRank: null, vectorRank: null }),
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
      }),
    );
    return {
      searchId: saved.id,
      method,
      results,
      criteria: brief.criteria,
      criteriaDerived,
      poolSize,
      createdAt: saved.created_at,
    };
  });

// ---------------------------------------------------------------------
// the expert assessment, a few candidates at a time
// ---------------------------------------------------------------------

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
    if (!result || (item.match && typeof item.match === "object" && item.match.assessment)) continue;
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
    const briefText = { title: brief.title, description: brief.description, criteria };
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
    const maxTokens = Math.min(ASSESSMENT_TOKENS_MAX, ASSESSMENT_TOKENS_BASE + ASSESSMENT_TOKENS_PER_REQUIREMENT * criteria.length);
    const assessOne = async (job: AssessmentJob): Promise<Assessment> => {
      const answer = await completeJson<ModelAssessmentAnswer>({
        system: assessmentSystemPrompt(),
        user: JSON.stringify(assessmentPayload(briefText, job.profile)),
        schema: assessmentAnswer,
        temperature: 0,
        maxTokens,
        model,
      });
      await recordUsage(member.orgId, "assess", answer.usage);
      return enforceAssessment(criteria, job.result.verdicts, answer.value, answer.usage.model);
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
        log("assess_failed", { searchId: search.id, candidateId: job.id, error: String(outcome.reason).slice(0, 300) });
      }
    });
    if (!assessed.size) return { results: [], failed };

    // The row is read again right before writing so the batches one browser
    // sends one after the other add up. Two people assessing the same search
    // at once is last-write-wins between their batches: the loser's entries
    // stay unassessed and "resume" picks them up again, nothing is corrupted.
    const fresh = await loadSearch(client, member.orgId, search.id);
    const results = fresh.results.map((result) => {
      const assessment = assessed.get(result.candidateId);
      return assessment ? { ...result, assessment } : result;
    });
    await client.patch("searches", { id: search.id, org_id: member.orgId }, { results });
    const answered = results.filter((result) => assessed.has(result.candidateId));
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
