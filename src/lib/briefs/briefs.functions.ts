/**
 * Server functions of the briefs: what the deployment can do (a model
 * or not), and the analysis of the talent pool for a brief as a job of
 * the processor. runSearch stores the searches row (status queued, the
 * brief's criteria of the moment) and pokes the processor, which reads
 * the brief once when it was never read or its text changed, sorts the
 * whole pool by métier, scores the profiles kept, reads the best in full
 * and writes every step on the row; a run stopped or failed on the same
 * reading of the brief is queued again instead of a new row, so it
 * resumes where it was. stopAnalysis asks the runner to stop at its next
 * step. readAnyway brings a profile the triage or the screening left out
 * back to be read in full (a person overrules the model) and queues the
 * run again when it had ended. Every handler reads the caller from the
 * access token through requireMember() and works only on the
 * organisation it verified. No model is called here: the Worker stores
 * and asks, the processor reads, a person retains.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import type {
  AnalysisStatus,
  BriefCriterion,
  BriefRow,
  RoleProfile,
  SearchRow,
  SearchTriageRow,
} from "@/lib/db/types";
import { modelConfigured } from "@/lib/model/model.server";
import { AppError } from "@/lib/platform/errors";
import { pokeAnalysis } from "@/lib/platform/processor.server";
import { enforceRateLimit } from "@/lib/platform/rate-limit.server";
import { db, requireMember, type ServiceClient } from "@/lib/platform/supabase.server";

import { countProtected, parseCriteria, sameCriteria } from "./criteria";
import { queryTextOf } from "./prompts";
import { jobTitleOf, needsDerivation, parseRoleProfile } from "./role-profile";

const orgInput = z.object({
  accessToken: z.string().min(1).max(4096),
  orgId: z.uuid(),
});

const briefInput = orgInput.extend({
  briefId: z.uuid(),
});

const searchInput = briefInput.extend({
  searchId: z.uuid(),
});

const readAnywayInput = searchInput.extend({
  candidateId: z.uuid(),
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

/** A search as the job reads it: never its results (the processor writes them, the browser reads them under RLS). */
type SearchHead = Pick<SearchRow, "id" | "brief_id" | "criteria" | "method" | "status" | "created_at">;

const SEARCH_HEAD_COLUMNS = "id,brief_id,criteria,method,status,created_at";

/** A row of searches with its criteria parsed and its status guarded (a row stored before the job existed reads done). */
function headOf(row: SearchHead): SearchHead {
  return {
    id: row.id,
    brief_id: row.brief_id,
    criteria: criteriaOf(row.criteria, { searchId: row.id }),
    method: row.method,
    status: isStatus(row.status) ? row.status : "done",
    created_at: row.created_at,
  };
}

function isStatus(value: unknown): value is AnalysisStatus {
  return (
    value === "queued" ||
    value === "running" ||
    value === "stopped" ||
    value === "done" ||
    value === "failed"
  );
}

/** One search of the organisation and of the brief, without its results, or NOT_FOUND. */
async function loadSearch(
  client: ServiceClient,
  orgId: string,
  briefId: string,
  searchId: string,
): Promise<SearchHead> {
  const rows = await client.select<SearchHead>(
    `searches?select=${SEARCH_HEAD_COLUMNS}&org_id=eq.${encodeURIComponent(orgId)}&id=eq.${encodeURIComponent(searchId)}&limit=1`,
  );
  const row = rows[0];
  if (!row || row.brief_id !== briefId) throw new AppError("NOT_FOUND");
  return headOf(row);
}

/** The newest search of the brief, without its results; null when the brief was never analysed. */
async function latestSearch(
  client: ServiceClient,
  orgId: string,
  briefId: string,
): Promise<SearchHead | null> {
  const rows = await client.select<SearchHead>(
    `searches?select=${SEARCH_HEAD_COLUMNS}&org_id=eq.${encodeURIComponent(orgId)}&brief_id=eq.${encodeURIComponent(briefId)}&order=created_at.desc&limit=1`,
  );
  const row = rows[0];
  return row ? headOf(row) : null;
}

/** The row set to queued for the runner: nothing asks it to stop any more, and the last error is gone. */
async function queueSearch(client: ServiceClient, orgId: string, searchId: string): Promise<void> {
  await client.patch(
    "searches",
    { id: searchId, org_id: orgId },
    { status: "queued", stop_requested: false, error: null },
  );
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
// the analysis: one button, one job
// ---------------------------------------------------------------------

export interface RunResult {
  searchId: string;
  createdAt: string;
  /** "queued" once stored (the processor claims it on the poke, or at its next scan); the status as it stands when a run was already under way. */
  status: AnalysisStatus;
}

/**
 * Starts the analysis of the brief: the searches row the processor runs
 * (status queued, the brief's criteria as they are, method triage: the
 * whole active pool), then one poke so it starts now rather than at the
 * next scan (a poke that fails is logged, never an error: the scan picks
 * the row up). A run of this brief stopped or failed on the same reading
 * of the brief (its text unchanged since the model read it, the same
 * criteria) is queued again instead: every step reads what it lacks from
 * the database, so it resumes where it was. A run already queued or
 * running is answered as it is, never doubled. A brief that names no job
 * (neither a title nor a text) has nothing to sort the pool on.
 */
export const runSearch = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => briefInput.parse(data))
  .handler(async ({ data }): Promise<RunResult> => {
    const member = await requireMember(data.accessToken, data.orgId, "member");
    await enforceRateLimit("search", { userKey: member.userId });
    const client = db();
    const brief = await loadBrief(client, member.orgId, data.briefId);
    if (!jobTitleOf(brief)) throw new AppError("INPUT:invalid");

    const latest = await latestSearch(client, member.orgId, brief.id);
    if (latest && (latest.status === "queued" || latest.status === "running")) {
      log("search_already_running", { briefId: brief.id, searchId: latest.id });
      return { searchId: latest.id, createdAt: latest.created_at, status: latest.status };
    }

    let saved: Pick<SearchRow, "id" | "created_at">;
    let resumed = false;
    const resumable =
      latest !== null &&
      (latest.status === "stopped" || latest.status === "failed") &&
      latest.method === "triage" &&
      !needsDerivation(brief) &&
      sameCriteria(latest.criteria, brief.criteria);
    if (resumable) {
      await queueSearch(client, member.orgId, latest.id);
      saved = { id: latest.id, created_at: latest.created_at };
      resumed = true;
    } else {
      const inserted = await client.insert<Pick<SearchRow, "id" | "created_at">>("searches", [
        {
          org_id: member.orgId,
          brief_id: brief.id,
          query: queryTextOf({
            title: brief.title,
            description: brief.description,
            criteria: brief.criteria,
          }),
          criteria: brief.criteria,
          results: [],
          result_count: 0,
          method: "triage",
          status: "queued",
          pool_size: 0,
          ran_by: member.userId,
        },
      ]);
      const row = inserted[0];
      if (!row) throw new Error("The search could not be saved");
      saved = row;
    }
    const poke = await pokeAnalysis(saved.id);
    console.info(
      "[briefs]",
      JSON.stringify({
        event: "search_queued",
        orgId: member.orgId,
        briefId: brief.id,
        searchId: saved.id,
        resumed,
        poked: poke.reached,
      }),
    );
    return { searchId: saved.id, createdAt: saved.created_at, status: "queued" };
  });

export interface StopResult {
  searchId: string;
  /** True when the runner was asked to stop; false when the run had already ended. */
  requested: boolean;
}

/**
 * Asks the runner to stop the run at its next step ("Interrompre"): the
 * row says so, the processor reads it between two steps and writes
 * status stopped; what was stored stays, and "Reprendre" queues the same
 * row again. A run that already ended is left as it is.
 */
export const stopAnalysis = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => searchInput.parse(data))
  .handler(async ({ data }): Promise<StopResult> => {
    const member = await requireMember(data.accessToken, data.orgId, "member");
    const client = db();
    const search = await loadSearch(client, member.orgId, data.briefId, data.searchId);
    const live = search.status === "queued" || search.status === "running";
    if (live) {
      await client.patch(
        "searches",
        { id: search.id, org_id: member.orgId },
        { stop_requested: true },
      );
      console.info(
        "[briefs]",
        JSON.stringify({
          event: "search_stop_requested",
          orgId: member.orgId,
          searchId: search.id,
          userId: member.userId,
        }),
      );
    }
    return { searchId: search.id, requested: live };
  });

export interface ReadAnywayResult {
  /** True when the run was queued again for it (it had ended); false when a run under way reads it at its next step, or a failed one once it is run again. */
  queued: boolean;
}

/**
 * A profile the analysis left out, brought back by a person to be read
 * in full: one the triage set aside ("no", or "unknown": the card could
 * not be read) becomes "close" without the model's reason or name (the
 * verdict is no longer the model's), one the screening kept but did not
 * promote keeps its verdict and score; either is marked forced, and the
 * promotion always takes a forced row. A run that had ended (done or
 * stopped) is queued again, so the runner screens, promotes and reads
 * it; a run under way reads it at its next step; a failed run keeps the
 * mark until it is run again. A person decides, not the model: this is
 * the way past a wrong "no". A profile outside the snapshot is refused.
 */
export const readAnyway = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => readAnywayInput.parse(data))
  .handler(async ({ data }): Promise<ReadAnywayResult> => {
    const member = await requireMember(data.accessToken, data.orgId, "member");
    await enforceRateLimit("search", { userKey: member.userId });
    const client = db();
    const search = await loadSearch(client, member.orgId, data.briefId, data.searchId);
    if (search.method !== "triage") throw new AppError("INPUT:invalid");
    const match = {
      search_id: search.id,
      org_id: member.orgId,
      candidate_id: data.candidateId,
    };
    const rows = await client.select<Pick<SearchTriageRow, "verdict" | "forced">>(
      `search_triage?select=verdict,forced&org_id=eq.${encodeURIComponent(member.orgId)}&search_id=eq.${encodeURIComponent(search.id)}&candidate_id=eq.${encodeURIComponent(data.candidateId)}&limit=1`,
    );
    const row = rows[0];
    if (!row) throw new AppError("INPUT:invalid");
    const kept = row.verdict === "yes" || row.verdict === "close";
    if (kept) {
      if (row.forced !== true) await client.patch("search_triage", match, { forced: true });
    } else {
      // "no", "unknown", or not read yet (a run stopped before it): the verdict is a person's now.
      await client.patch("search_triage", match, {
        verdict: "close",
        forced: true,
        reason: null,
        model: null,
      });
    }
    const ended = search.status === "done" || search.status === "stopped";
    let poked = false;
    if (ended) {
      await queueSearch(client, member.orgId, search.id);
      poked = (await pokeAnalysis(search.id)).reached;
    }
    console.info(
      "[briefs]",
      JSON.stringify({
        event: "read_anyway",
        orgId: member.orgId,
        searchId: search.id,
        userId: member.userId,
        verdict: row.verdict,
        queued: ended,
        poked,
      }),
    );
    return { queued: ended };
  });
