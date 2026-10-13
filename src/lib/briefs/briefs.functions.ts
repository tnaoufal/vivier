/**
 * Server functions of the briefs: what the deployment can do (a model
 * or not), the criteria a model proposes from a brief's text, and the
 * search of the talent pool for a brief (hybrid retrieval in the
 * database, explained scoring here, a model's reading of the top
 * results when one is configured, the whole stored as a searches row).
 * Every handler reads the caller from the access token through
 * requireMember() and works only on the organisation it verified.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import type { BriefCriterion, BriefRow, MatchResult, SearchMethod, SearchRow } from "@/lib/db/types";
import { completeJson, embed, modelConfigured, vectorLiteral } from "@/lib/model/model.server";
import { AppError } from "@/lib/platform/errors";
import { enforceRateLimit } from "@/lib/platform/rate-limit.server";
import { db, requireMember, type ServiceClient } from "@/lib/platform/supabase.server";
import { recordUsage } from "@/lib/platform/usage.server";

import { isCriterionKind, LABEL_MAX, parseCriteria, toWeight, VALUE_MAX, withId } from "./criteria";
import { rankResults, scoreCandidate, type MatchProfile } from "./matching";
import {
  EXPLANATION_MAX,
  EXTRACTION_MAX,
  explanationPayload,
  explanationSystemPrompt,
  extractionSystemPrompt,
  extractionUserPrompt,
  protectedCriterion,
  queryTextOf,
  RETRIEVAL_LIMIT,
  textQueryOf,
  type ExplanationCandidate,
} from "./prompts";

const orgInput = z.object({
  accessToken: z.string().min(1).max(4096),
  orgId: z.uuid(),
});

const briefInput = orgInput.extend({
  briefId: z.uuid(),
});

type LoadedBrief = Pick<BriefRow, "id" | "title" | "description"> & { criteria: BriefCriterion[] };

/** The brief of the organisation, criteria parsed, or NOT_FOUND. */
async function loadBrief(client: ServiceClient, orgId: string, briefId: string): Promise<LoadedBrief> {
  const rows = await client.select<Pick<BriefRow, "id" | "title" | "description" | "criteria">>(
    `briefs?select=id,title,description,criteria&org_id=eq.${encodeURIComponent(orgId)}&id=eq.${encodeURIComponent(briefId)}&limit=1`,
  );
  const row = rows[0];
  if (!row) throw new AppError("NOT_FOUND");
  return { id: row.id, title: row.title, description: row.description, criteria: parseCriteria(row.criteria) };
}

function log(event: string, details: Record<string, unknown>): void {
  console.warn("[briefs]", JSON.stringify({ event, ...details }));
}

// ---------------------------------------------------------------------
// capabilities
// ---------------------------------------------------------------------

export interface BriefCapabilities {
  /** True when a model is set up: criteria can be proposed and searches explained. */
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

export const extractCriteria = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => briefInput.parse(data))
  .handler(async ({ data }): Promise<ExtractionResult> => {
    const member = await requireMember(data.accessToken, data.orgId, "member");
    await enforceRateLimit("model", { userKey: member.userId });
    if (!modelConfigured()) throw new AppError("SETUP:model");
    const brief = await loadBrief(db(), member.orgId, data.briefId);
    const answer = await completeJson({
      system: extractionSystemPrompt(),
      user: extractionUserPrompt(brief),
      schema: extractionAnswer,
      maxTokens: 1500,
    });
    await recordUsage(member.orgId, "brief", answer.usage);
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

const PROFILE_COLUMNS = "id,org_id,headline,summary,skills,languages,location,years_experience,availability,education,search_text";

type ProfileRow = MatchProfile & { org_id: string };

const explanationAnswer = z.object({
  explanations: z.array(z.object({ candidateId: z.string(), why: z.string() })).max(40),
});

export interface SearchResult {
  searchId: string;
  method: SearchMethod;
  /** Ranked: not blocked first, then score, then coverage. */
  results: MatchResult[];
  /** The criteria the verdicts refer to, as they were at run time. */
  criteria: BriefCriterion[];
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

/** The model's reading of the top results, written into `why`; a failure leaves every why null. */
async function explainTop(orgId: string, brief: LoadedBrief, results: MatchResult[], profiles: Map<string, ProfileRow>): Promise<void> {
  const top: ExplanationCandidate[] = [];
  for (const result of results.slice(0, EXPLANATION_MAX)) {
    const profile = profiles.get(result.candidateId);
    if (profile) top.push({ profile, result });
  }
  if (!top.length) return;
  try {
    const answer = await completeJson({
      system: explanationSystemPrompt(),
      user: JSON.stringify(explanationPayload(brief, top)),
      schema: explanationAnswer,
      maxTokens: 2500,
    });
    await recordUsage(orgId, "explain", answer.usage);
    const why = new Map<string, string>();
    for (const item of answer.value.explanations) {
      const text = item.why.trim().slice(0, 700);
      if (text) why.set(item.candidateId, text);
    }
    for (const { result } of top) {
      const text = why.get(result.candidateId);
      if (text) result.why = text;
    }
  } catch (error) {
    log("explain_failed", { error: String(error).slice(0, 300) });
  }
}

export const runSearch = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => briefInput.parse(data))
  .handler(async ({ data }): Promise<SearchResult> => {
    const member = await requireMember(data.accessToken, data.orgId, "member");
    await enforceRateLimit("search", { userKey: member.userId });
    const client = db();
    const brief = await loadBrief(client, member.orgId, data.briefId);
    const queryText = queryTextOf(brief);
    const textQuery = textQueryOf(brief);
    const embedding = await embedQuery(member.orgId, queryText);
    const method: SearchMethod = embedding ? "hybrid" : "text";

    const answer = await client.rpc<RetrievalRow[] | null>("search_candidates", {
      p_org: member.orgId,
      p_query: textQuery,
      p_embedding: embedding ? vectorLiteral(embedding) : null,
      p_limit: RETRIEVAL_LIMIT,
    });
    const retrieved = (Array.isArray(answer) ? answer : [])
      .filter((row) => row && typeof row.candidate_id === "string")
      .slice(0, RETRIEVAL_LIMIT);

    const profiles = new Map<string, ProfileRow>();
    if (retrieved.length) {
      const org = encodeURIComponent(member.orgId);
      const ids = retrieved.map((row) => encodeURIComponent(row.candidate_id)).join(",");
      const rows = await client.select<ProfileRow>(
        `candidates?select=${PROFILE_COLUMNS}&org_id=eq.${org}&status=eq.active&id=in.(${ids})`,
      );
      for (const row of rows) {
        if (row.org_id === member.orgId) profiles.set(row.id, row);
      }
    }

    const scored: MatchResult[] = [];
    for (const row of retrieved) {
      const profile = profiles.get(row.candidate_id);
      if (!profile) continue;
      scored.push(
        scoreCandidate(brief.criteria, profile, {
          textRank: typeof row.text_rank === "number" ? row.text_rank : null,
          vectorRank: typeof row.vector_rank === "number" ? row.vector_rank : null,
        }),
      );
    }
    const results = rankResults(scored);
    if (modelConfigured() && results.length) await explainTop(member.orgId, brief, results, profiles);

    const inserted = await client.insert<Pick<SearchRow, "id" | "created_at">>("searches", [
      {
        org_id: member.orgId,
        brief_id: brief.id,
        query: queryText,
        criteria: brief.criteria,
        results,
        result_count: results.length,
        method,
        ran_by: member.userId,
      },
    ]);
    const saved = inserted[0];
    if (!saved) throw new Error("The search could not be saved");
    console.info(
      "[briefs]",
      JSON.stringify({ event: "search", orgId: member.orgId, briefId: brief.id, method, retrieved: retrieved.length, results: results.length }),
    );
    return { searchId: saved.id, method, results, criteria: brief.criteria, createdAt: saved.created_at };
  });
