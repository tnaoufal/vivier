/**
 * The steps of an analysis, each idempotent: it reads what it lacks
 * from the database, writes what it settles as it goes, and leaves the
 * row's stage and progress behind it, so a run stopped, crashed or
 * redeployed in the middle resumes where it was. remainingWork() reads
 * what is left and the package's nextStage() names the step; runStep()
 * runs it. The reading of the brief (one call, when the brief was never
 * read or its text changed), the snapshot of the pool, the triage
 * (TRIAGE_BATCH_MAX cards a call, a thin card "unknown" without a call,
 * a batch the model cannot answer read again in halves, a part of
 * BATCH_MIN cards or fewer failing twice at that size settled
 * "unknown"), the screening of the cards kept (SCREEN_BATCH_MAX a
 * call, the same splitting), the promotion of the PROMOTE_MAX best and
 * every forced row into the results with the deterministic verdicts,
 * the full reading (one call per entry, a failure retried once), the
 * second opinion, the tiering by groups and the final comparison of
 * the A's. Every payload comes from the shared package (no name, no
 * contact, no photo; the triage and screening cards carry no place
 * either), every answer is bound by its rules before it is stored,
 * every call is recorded in ai_usage (a failed one with what it
 * billed, when its error carries it). The model calls go through
 * RunnerDeps, so the tests run a whole analysis against the in-memory
 * database and a fake model.
 */
import type { z, ZodTypeAny } from "zod";

import {
  applyChallenge,
  applyRanking,
  assessmentPayload,
  assessmentSystemPrompt,
  challengePayload,
  challengeSystemPrompt,
  enforceAssessment,
  enforceBriefReading,
  enforceScreen,
  enforceTriage,
  isThinCard,
  LEFT_POOL_REASON,
  jobTitleOf,
  lotsOf,
  needsDerivation,
  payloadTexts,
  promotable,
  rankingPayload,
  rankingSheets,
  rankingSystemPrompt,
  readBriefPrompt,
  roleCriterion,
  SCREEN_BATCH_MAX,
  scoreCandidate,
  screenEntries,
  screenPayload,
  screenRequirements,
  screenRoleBrief,
  screenSystemPrompt,
  statesMaximumYears,
  THIN_CARD_REASON,
  TRIAGE_BATCH_MAX,
  triageCard,
  triageEntries,
  triagePayload,
  triageRoleBrief,
  triageRoleTerms,
  triageSystemPrompt,
  UNREADABLE_REASON,
  type AnalysisStage,
  type BriefCriterion,
  type BriefText,
  type MatchResult,
  type RemainingWork,
  type RoleProfile,
  type ScreenEntry,
  type TriageEntry,
} from "@vivier/analysis";

import type { Db } from "../db.js";
import { describeError, logInfo, logWarn, type LogFields } from "../log.js";
import { ModelError, type JsonAnswer, type Usage } from "../model.js";
import type {
  AiUsageKind,
  CardProfile,
  FullProfile,
  ScreenWrite,
  SearchJobPatch,
  SearchJobRow,
  TriageRow,
  TriageWrite,
} from "../types.js";
import type { UsageRecorder } from "../usage.js";
import {
  failureKind,
  finalRankGroup,
  pendingRankGroups,
  readBatched,
  retryAfterMs,
  runPool,
  spansSeveralGroups,
} from "./batches.js";
import {
  assessmentAnswer,
  briefReadingAnswer,
  challengeAnswer,
  parseCriteria,
  parseResults,
  parseRoleProfile,
  rankingAnswer,
  screenAnswer,
  triageAnswer,
} from "./schemas.js";

/** The most entries one second-opinion batch holds (one call per entry; the batch is written in one merge). */
export const CHALLENGE_BATCH_MAX = 6;
/** The most rows one read of search_triage asks for (PostgREST's usual page). */
export const TRIAGE_PAGE = 1000;
/** A full reading that the model could not answer is sent once more before the entry is left unread. */
export const ASSESS_RETRIES = 1;
/**
 * The delays before a call is sent again after a failure of the
 * provider (its rate, a server error, the network); then the run
 * fails. About two minutes in all: a rate limit's window (a minute at
 * most) is waited out, while a provider really down still fails the
 * run instead of holding it for hours. A Retry-After the refusal
 * names is waited for when longer than the step.
 */
export const PROVIDER_RETRY_DELAYS_MS: readonly number[] = [2_000, 6_000, 15_000, 30_000, 60_000];

/**
 * The answer budgets: the one reading of a brief (the profile with its
 * lists full and up to twelve criteria), a triage verdict with a
 * fifteen-word reason per card, a screening score with a twelve-word
 * reason per card, an assessment that grows with the requirements (five
 * dimensions, three lists, a row per criterion), a second opinion, a
 * line per candidate of a ranking. A budget below cuts the JSON and
 * fails the call.
 */
const READ_BRIEF_TOKENS = 3200;
const TRIAGE_TOKENS_BASE = 600;
const TRIAGE_TOKENS_PER_CARD = 110;
const SCREEN_TOKENS_BASE = 400;
const SCREEN_TOKENS_PER_CARD = 90;
const ASSESSMENT_TOKENS_BASE = 1800;
const ASSESSMENT_TOKENS_PER_REQUIREMENT = 80;
const ASSESSMENT_TOKENS_MAX = 3200;
const CHALLENGE_TOKENS = 400;
const RANKING_TOKENS_PER_CANDIDATE = 120;
const RANKING_TOKENS_MAX = 2000;

/** The short code written on a failed run's row; the web app says a sentence for each. */
export type FailureCode =
  | "processor_error"
  | "model_unavailable"
  | "brief_missing"
  | "brief_empty"
  | "brief_unreadable"
  | "brief_changed";

/** A run that cannot go on: the code is stored, the cause logged. */
export class AnalysisFailure extends Error {
  readonly code: FailureCode;

  constructor(code: FailureCode, options?: ErrorOptions) {
    super(`analysis ${code}`, options);
    this.name = "AnalysisFailure";
    this.code = code;
  }
}

export interface ModelRequest<S extends ZodTypeAny> {
  system: string;
  user: string;
  schema: S;
  temperature?: number;
  maxTokens?: number;
}

/** One JSON completion validated by its schema: completeJson() bound to the analysis model, or a fake in the tests. */
export type CompleteJson = <S extends ZodTypeAny>(
  request: ModelRequest<S>,
) => Promise<JsonAnswer<z.output<S>>>;

export interface RunnerDeps {
  db: Db;
  /** Null without a model: a claimed run fails with model_unavailable. */
  complete: CompleteJson | null;
  /** The chat model the calls go to, written on the row. */
  model: string | null;
  /** Model calls one run keeps in flight. */
  concurrency: number;
  /** Writes the ai_usage row of each call; never throws. */
  recordUsage: UsageRecorder;
  now: () => Date;
  /** The wait before a call is sent again; the tests inject one that does not wait. */
  sleep: (ms: number) => Promise<void>;
}

/** The brief as the run reads it: its text, its reading parsed. */
export interface LoadedBrief {
  id: string;
  title: string;
  description: string;
  criteria: BriefCriterion[];
  role_profile: RoleProfile | null;
}

/** What a step counted, for its log line. */
interface CallTally {
  calls: number;
  tokensIn: number;
  tokensOut: number;
}

/**
 * The row's writer: the stage before a step runs, the progress and the
 * heartbeat after each batch, coalesced (the lanes finish batches at
 * once; the latest values win and land in order), and after each write
 * the stop flag read back, so a step never starts a batch once a person
 * asked it to stop. shouldStop() also answers true while the process
 * shuts down: the batches in flight end, nothing new starts, the row
 * stays running for the next boot.
 */
export class RunControl {
  stopRequested: boolean;
  /** The last progress written, for the final patch. */
  last = { done: 0, total: 0 };
  private latest: SearchJobPatch = {};
  private dirty = false;
  private flushing: Promise<void> | null = null;

  constructor(
    private readonly deps: RunnerDeps,
    readonly searchId: string,
    private readonly shuttingDown: () => boolean,
    stopRequested: boolean,
  ) {
    this.stopRequested = stopRequested;
  }

  shouldStop(): boolean {
    return this.stopRequested || this.shuttingDown();
  }

  /** True when the process is shutting down and nobody asked the run to stop: the row is left running. */
  interrupted(): boolean {
    return !this.stopRequested && this.shuttingDown();
  }

  /** The stage written on the row before it runs, with its progress. */
  stage(stage: AnalysisStage, done: number, total: number): Promise<void> {
    this.last = { done, total };
    return this.queue({ stage, progress_done: done, progress_total: total });
  }

  /** After a batch: the progress and the heartbeat, then the stop flag read. */
  progress(done: number, total: number): Promise<void> {
    this.last = { done, total };
    return this.queue({ progress_done: done, progress_total: total });
  }

  /** The heartbeat alone, from the timer that covers a long call. */
  heartbeat(): Promise<void> {
    return this.queue({});
  }

  /** Resolves once every queued write has landed. */
  async idle(): Promise<void> {
    if (this.flushing) await this.flushing;
  }

  private queue(patch: SearchJobPatch): Promise<void> {
    Object.assign(this.latest, patch);
    this.dirty = true;
    if (!this.flushing) {
      this.flushing = this.flush().finally(() => {
        this.flushing = null;
      });
    }
    return this.flushing;
  }

  private async flush(): Promise<void> {
    while (this.dirty) {
      this.dirty = false;
      const patch: SearchJobPatch = {
        ...this.latest,
        heartbeat_at: this.deps.now().toISOString(),
      };
      this.latest = {};
      await this.deps.db.patchSearch(this.searchId, patch);
      const row = await this.deps.db.getSearch(this.searchId);
      if (row?.stop_requested) this.stopRequested = true;
    }
  }
}

/** Everything a step reads and keeps for the run. */
export interface RunContext {
  deps: RunnerDeps;
  control: RunControl;
  search: SearchJobRow;
  orgId: string;
  searchId: string;
  brief: LoadedBrief;
  /** The criteria the verdicts refer to: the search's snapshot (the brief's at the first run, or its fresh reading). */
  criteria: BriefCriterion[];
  /** The stage the row held when the run was claimed: where the one before stopped. */
  stageAtClaim: AnalysisStage | null;
  /** Candidates settled this run that the database cannot mark: gone from the pool, a reading that failed, a group the tiering could not answer. */
  skip: Set<string>;
  /** True once this run took (or extended) the snapshot. */
  snapshotTaken: boolean;
  /** Full readings the model could not answer, kept on the row's error field at the end. */
  readFailures: number;
  /** Groups the tiering compared this run. */
  rankGroupsRun: number;
  /** True once this run made the final comparison. */
  finalRun: boolean;
  tally: CallTally;
}

export interface StepOutcome {
  /** True when the step stopped before its work was done: a stop was asked, or the process shuts down. */
  stopped: boolean;
}

function freshTally(): CallTally {
  return { calls: 0, tokensIn: 0, tokensOut: 0 };
}

/** The brief, its criteria and its reading parsed from the database; the run's criteria; the model written on the row. */
export async function prepareRun(
  search: SearchJobRow,
  deps: RunnerDeps,
  control: RunControl,
): Promise<RunContext> {
  if (!search.brief_id) throw new AnalysisFailure("brief_missing");
  const row = await deps.db.getBrief(search.brief_id);
  if (!row || row.org_id !== search.org_id) throw new AnalysisFailure("brief_missing");
  const brief: LoadedBrief = {
    id: row.id,
    title: row.title,
    description: row.description,
    criteria: parseCriteria(row.criteria),
    role_profile: parseRoleProfile(row.role_profile),
  };
  if (!jobTitleOf(brief)) throw new AnalysisFailure("brief_empty");
  const stored = parseCriteria(search.criteria);
  if (search.analysis_model !== deps.model)
    await deps.db.patchSearch(search.id, { analysis_model: deps.model });
  return {
    deps,
    control,
    search,
    orgId: search.org_id,
    searchId: search.id,
    brief,
    criteria: stored.length ? stored : brief.criteria,
    stageAtClaim: search.stage,
    skip: new Set<string>(),
    snapshotTaken: false,
    readFailures: 0,
    rankGroupsRun: 0,
    finalRun: false,
    tally: freshTally(),
  };
}

/** The brief as the payloads read it: its text, the run's criteria, its role profile. */
function briefTextOf(ctx: RunContext): BriefText {
  return {
    title: ctx.brief.title,
    description: ctx.brief.description,
    criteria: [...ctx.criteria],
    roleProfile: ctx.brief.role_profile,
  };
}

/**
 * True when the brief states a maximum: its text writes a ceiling of
 * years (statesMaximumYears()), or its role profile holds a yearsMax
 * (the reading keeps one only when the text wrote it). Only then may a
 * reservation or a second opinion's doubt find the person above the
 * level (enforceAssessment(), applyChallenge()): a ceiling on
 * experience the brief did not state is a proxy for age. Read once per
 * step from the brief as the run holds it, after its reading.
 */
function maximumStatedOf(brief: LoadedBrief): boolean {
  return statesMaximumYears(brief) || typeof brief.role_profile?.yearsMax === "number";
}

/** The kept rows of the snapshot (yes, close), every page. */
async function listKept(ctx: RunContext): Promise<TriageRow[]> {
  const rows: TriageRow[] = [];
  let after: string | undefined;
  for (;;) {
    const page = await ctx.deps.db.listTriage(ctx.searchId, {
      verdict: "kept",
      limit: TRIAGE_PAGE,
      ...(after === undefined ? {} : { after }),
    });
    rows.push(...page);
    const last = page[page.length - 1];
    if (!last || page.length < TRIAGE_PAGE) return rows;
    after = last.candidate_id;
  }
}

/**
 * What the run still has to do, read from the database (the stop flag
 * read with it). The promotion's remainder is only worked out once the
 * triage and the screening are done, since nextStage() reads it after
 * them; the final comparison is due once the tiering spanned several
 * groups (this run, or the one that stopped during it) and two A's at
 * least stand.
 */
export async function remainingWork(ctx: RunContext): Promise<RemainingWork> {
  const { db } = ctx.deps;
  const row = await db.getSearch(ctx.searchId);
  if (row) {
    ctx.search = row;
    if (row.stop_requested) ctx.control.stopRequested = true;
  }
  const counts = await db.countTriage(ctx.searchId);
  const results = parseResults(await db.getResults(ctx.searchId));
  const screenPending = Math.max(0, counts.yes + counts.close - counts.scored);
  let promotionPending = false;
  if (counts.pending === 0 && screenPending === 0) {
    const stored = new Set(results.map((result) => result.candidateId));
    promotionPending = promotable(await listKept(ctx)).some(
      (kept) => !stored.has(kept.candidate_id) && !ctx.skip.has(kept.candidate_id),
    );
  }
  const unsettled = (result: MatchResult) => !ctx.skip.has(result.candidateId);
  const rankedBefore =
    ctx.rankGroupsRun > 0 || ctx.stageAtClaim === "ranking" || ctx.stageAtClaim === "final";
  return {
    briefUnread: needsDerivation(ctx.brief),
    snapshotTaken: ctx.snapshotTaken,
    triagePending: counts.pending,
    screenPending,
    promotionPending,
    assessPending: results.filter((result) => !result.assessment && unsettled(result)).length,
    challengePending: results.filter(
      (result) =>
        result.assessment?.decision === "fit" && !result.assessment.challenge && unsettled(result),
    ).length,
    rankPending: pendingRankGroups(results, ctx.skip).reduce((sum, group) => sum + group.length, 0),
    finalPending:
      !ctx.finalRun &&
      rankedBefore &&
      spansSeveralGroups(results, ctx.skip) &&
      finalRankGroup(results, ctx.skip).length > 0,
  };
}

// ---------------------------------------------------------------------
// the model
// ---------------------------------------------------------------------

/**
 * What a failed call billed before it failed: the completions
 * completeJson made before it gave up on the answer (a batch that is
 * split, a reading sent again, each cost one or two). The counts ride
 * on the error as `usage`; the field is read structurally, since the
 * ModelError of model.ts does not declare it yet (it drops its
 * counters when it throws): until it carries them, a failed call
 * costs the ledger nothing, and it is recorded as soon as it does.
 * Null when nothing was billed (a provider failure on the first
 * completion): no row for that.
 */
function billedUsage(error: unknown): Usage | null {
  if (!(error instanceof ModelError)) return null;
  const usage = (error as { usage?: Partial<Usage> | null }).usage;
  if (!usage || typeof usage.model !== "string") return null;
  const tokensIn = usage.tokensIn ?? 0;
  const tokensOut = usage.tokensOut ?? 0;
  return tokensIn > 0 || tokensOut > 0 ? { model: usage.model, tokensIn, tokensOut } : null;
}

/**
 * One call, its usage recorded, its tokens tallied; what a failed call
 * billed is recorded the same way before anything else is decided. A
 * failure of the provider (the rate, a server error, the network) is
 * sent again after PROVIDER_RETRY_DELAYS_MS (or the Retry-After it
 * names, when longer), then fails the run as model_unavailable; a
 * failure on the content (no valid JSON, a refusal of what was sent) is
 * thrown as it is: the caller splits the batch or sends it once more.
 */
async function callModel<S extends ZodTypeAny>(
  ctx: RunContext,
  kind: AiUsageKind,
  request: ModelRequest<S>,
): Promise<JsonAnswer<z.output<S>>> {
  const complete = ctx.deps.complete;
  if (!complete) throw new AnalysisFailure("model_unavailable");
  for (let attempt = 0; ; attempt += 1) {
    ctx.tally.calls += 1;
    try {
      const answer = await complete(request);
      ctx.tally.tokensIn += answer.usage.tokensIn;
      ctx.tally.tokensOut += answer.usage.tokensOut;
      await ctx.deps.recordUsage(ctx.orgId, kind, answer.usage);
      return answer;
    } catch (error) {
      const billed = billedUsage(error);
      if (billed) {
        ctx.tally.tokensIn += billed.tokensIn;
        ctx.tally.tokensOut += billed.tokensOut;
        await ctx.deps.recordUsage(ctx.orgId, kind, billed);
      }
      if (failureKind(error) !== "provider") throw error;
      const delay = PROVIDER_RETRY_DELAYS_MS[attempt];
      if (delay === undefined) throw new AnalysisFailure("model_unavailable", { cause: error });
      const wait = Math.max(delay, retryAfterMs(error));
      logWarn("analysis_call_retried", {
        searchId: ctx.searchId,
        kind,
        attempt: attempt + 1,
        delayMs: wait,
        error: describeError(error),
      });
      await ctx.deps.sleep(wait);
    }
  }
}

/** The error class of a failed batch, never its content. */
function logBatchFailure(
  ctx: RunContext,
  stage: AnalysisStage,
  cards: number,
  error: unknown,
): void {
  logWarn("analysis_batch_failed", {
    searchId: ctx.searchId,
    stage,
    cards,
    error: describeError(error),
  });
}

/** A call sent again on a content failure, `retries` times at most; null once they are spent. */
async function retryOnContent<T>(
  ctx: RunContext,
  stage: AnalysisStage,
  cards: number,
  retries: number,
  call: () => Promise<T>,
): Promise<T | null> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await call();
    } catch (error) {
      if (failureKind(error) !== "content") throw error;
      logBatchFailure(ctx, stage, cards, error);
      if (attempt >= retries) return null;
    }
  }
}

function logStep(
  ctx: RunContext,
  stage: AnalysisStage,
  startedAt: number,
  fields: LogFields,
): void {
  logInfo("analysis_step", {
    searchId: ctx.searchId,
    orgId: ctx.orgId,
    stage,
    ms: Date.now() - startedAt,
    calls: ctx.tally.calls,
    tokensIn: ctx.tally.tokensIn,
    tokensOut: ctx.tally.tokensOut,
    ...fields,
  });
}

// ---------------------------------------------------------------------
// the steps
// ---------------------------------------------------------------------

/**
 * The one reading of the brief: the role profile and the criteria in
 * one call at temperature 0, bound by enforceBriefReading(), saved into
 * the brief in one write, and the search's criteria snapshot refreshed
 * from it. A brief whose text changed since a search read profiles on
 * its earlier reading is not read again under that search: its verdicts
 * would be on another job (brief_changed: a new analysis runs on the
 * new text). A brief the model cannot read fails the run.
 */
async function stepReading(ctx: RunContext): Promise<StepOutcome> {
  const startedAt = Date.now();
  const { db } = ctx.deps;
  await ctx.control.stage("reading", 0, 1);
  // A verdict a person forced (readAnyway) is not a reading of the job; the model's are, and so are the scores and the results.
  const counts = await db.countTriage(ctx.searchId);
  const readBefore =
    ctx.search.result_count > 0 ||
    counts.no > 0 ||
    counts.scored > 0 ||
    (await listKept(ctx)).some((row) => row.model !== null);
  if (readBefore) throw new AnalysisFailure("brief_changed");
  const brief = ctx.brief;
  const prompt = readBriefPrompt(brief);
  let answer: JsonAnswer<z.output<typeof briefReadingAnswer>>;
  try {
    answer = await callModel(ctx, "brief", {
      system: prompt.system,
      user: prompt.user,
      schema: briefReadingAnswer,
      temperature: 0,
      maxTokens: READ_BRIEF_TOKENS,
    });
  } catch (error) {
    if (failureKind(error) === "content")
      throw new AnalysisFailure("brief_unreadable", { cause: error });
    throw error;
  }
  const reading = enforceBriefReading(brief, answer.value, {
    model: answer.usage.model,
    createdAt: ctx.deps.now().toISOString(),
  });
  await db.patchBrief(brief.id, { role_profile: reading.profile, criteria: reading.criteria });
  ctx.brief = { ...brief, role_profile: reading.profile, criteria: reading.criteria };
  ctx.criteria = reading.criteria;
  await db.patchSearch(ctx.searchId, { criteria: reading.criteria });
  if (!roleCriterion(reading.criteria))
    logWarn("analysis_role_unnamed", { searchId: ctx.searchId, briefId: brief.id });
  await ctx.control.progress(1, 1);
  logStep(ctx, "reading", startedAt, {
    criteria: reading.criteria.length,
    dropped: reading.dropped,
    warnings: reading.warnings.length,
  });
  return { stopped: false };
}

/** The snapshot of the pool: one row per active candidate the search lacks (start_triage), the pool's size on the row. */
async function stepSnapshot(ctx: RunContext): Promise<StepOutcome> {
  const startedAt = Date.now();
  const { db } = ctx.deps;
  await ctx.control.stage("snapshot", 0, 1);
  const added = await db.startTriage(ctx.orgId, ctx.searchId);
  const counts = await db.countTriage(ctx.searchId);
  await db.patchSearch(ctx.searchId, { pool_size: counts.total });
  ctx.snapshotTaken = true;
  await ctx.control.progress(1, 1);
  logStep(ctx, "snapshot", startedAt, { added, poolSize: counts.total });
  return { stopped: false };
}

/**
 * The triage: the pending rows of the snapshot, a page at a time; a
 * candidate gone from the pool or a card with nothing to judge is
 * settled "unknown" without a call; the rest is read in batches of
 * TRIAGE_BATCH_MAX through readBatched(), each answer bound by
 * enforceTriage() and written at once (record_triage: the first write
 * wins, so a batch sent again never overwrites a verdict). Every
 * failed call is counted on its cards' rows (bump_triage_attempts),
 * for the record; readBatched() settles a part on its own count.
 */
async function stepTriage(ctx: RunContext): Promise<StepOutcome> {
  const startedAt = Date.now();
  const { db, concurrency } = ctx.deps;
  const brief = ctx.brief;
  const role = triageRoleBrief({
    title: brief.title,
    criteria: ctx.criteria,
    role_profile: brief.role_profile,
  });
  if (!role.title) throw new AnalysisFailure("brief_empty");
  const terms = triageRoleTerms(role);
  const counts = await db.countTriage(ctx.searchId);
  const total = counts.total;
  let done = total - counts.pending;
  await ctx.control.stage("triage", done, total);
  const tally = {
    yes: 0,
    close: 0,
    no: 0,
    unknown: 0,
    guarded: 0,
    thin: 0,
    gone: 0,
    unreadable: 0,
  };
  const settle = async (ids: readonly string[], reason: string): Promise<void> => {
    const rows: TriageWrite[] = ids.map((candidate_id) => ({
      candidate_id,
      verdict: "unknown",
      reason,
    }));
    await db.recordTriage(ctx.orgId, ctx.searchId, null, rows);
    tally.unknown += ids.length;
    done += ids.length;
  };
  let calls = 0;
  let failures = 0;
  let stopped = false;
  let after: string | undefined;
  for (;;) {
    if (ctx.control.shouldStop()) {
      stopped = true;
      break;
    }
    const page = await db.listTriage(ctx.searchId, {
      verdict: "pending",
      limit: TRIAGE_PAGE,
      ...(after === undefined ? {} : { after }),
    });
    const last = page[page.length - 1];
    if (!last) break;
    after = last.candidate_id;
    const ids = page.map((row) => row.candidate_id);
    const profiles = await db.loadProfiles(ctx.orgId, ids, "card");
    const byId = new Map(profiles.map((profile) => [profile.id, profile] as const));
    const gone = ids.filter((id) => !byId.has(id));
    if (gone.length) {
      await settle(gone, LEFT_POOL_REASON);
      tally.gone += gone.length;
    }
    const thin: string[] = [];
    const readable: CardProfile[] = [];
    for (const profile of profiles) {
      if (isThinCard(triageCard(profile, "c0"))) thin.push(profile.id);
      else readable.push(profile);
    }
    if (thin.length) {
      await settle(thin, THIN_CARD_REASON);
      tally.thin += thin.length;
    }
    if (gone.length || thin.length) await ctx.control.progress(done, total);
    const batches = lotsOf(readable, TRIAGE_BATCH_MAX).map((batch) => triageEntries(batch));
    const report = await readBatched<TriageEntry>(
      batches,
      concurrency,
      {
        read: async (part) => {
          const payload = triagePayload(
            role,
            part.map((entry) => entry.card),
          );
          let answer: JsonAnswer<z.output<typeof triageAnswer>>;
          try {
            answer = await callModel(ctx, "triage", {
              system: triageSystemPrompt(),
              user: JSON.stringify(payload),
              schema: triageAnswer,
              temperature: 0,
              maxTokens: TRIAGE_TOKENS_BASE + TRIAGE_TOKENS_PER_CARD * part.length,
            });
          } catch (error) {
            if (failureKind(error) !== "content") throw error;
            logBatchFailure(ctx, "triage", part.length, error);
            return false;
          }
          const outcomes = enforceTriage(part, answer.value, terms);
          const rows: TriageWrite[] = [];
          for (const [candidate_id, outcome] of outcomes) {
            rows.push({ candidate_id, verdict: outcome.verdict, reason: outcome.reason });
            tally[outcome.verdict] += 1;
            if (outcome.guarded) tally.guarded += 1;
          }
          await db.recordTriage(ctx.orgId, ctx.searchId, answer.usage.model, rows);
          done += part.length;
          await ctx.control.progress(done, total);
          return true;
        },
        failed: async (part) => {
          await db.bumpAttempts(
            ctx.searchId,
            part.map((entry) => entry.candidateId),
          );
        },
        settle: async (part) => {
          await settle(
            part.map((entry) => entry.candidateId),
            UNREADABLE_REASON,
          );
          tally.unreadable += part.length;
          await ctx.control.progress(done, total);
        },
      },
      () => ctx.control.shouldStop(),
    );
    calls += report.calls;
    failures += report.failures;
    if (report.stopped) {
      stopped = true;
      break;
    }
    if (page.length < TRIAGE_PAGE) break;
  }
  logStep(ctx, "triage", startedAt, {
    ...tally,
    batches: calls,
    failedBatches: failures,
    done,
    total,
    stopped,
  });
  return { stopped };
}

/**
 * The screening: the kept rows the screening has not read, a page at a
 * time, in batches of SCREEN_BATCH_MAX through readBatched(), each
 * answer bound by enforceScreen() and written at once (record_screen:
 * the first write wins); a part the model cannot read keeps a null
 * score, as does a candidate gone from the pool.
 */
async function stepScreening(ctx: RunContext): Promise<StepOutcome> {
  const startedAt = Date.now();
  const { db, concurrency } = ctx.deps;
  const brief = ctx.brief;
  const role = screenRoleBrief({
    title: brief.title,
    criteria: ctx.criteria,
    role_profile: brief.role_profile,
  });
  const requirements = screenRequirements(ctx.criteria);
  const counts = await db.countTriage(ctx.searchId);
  const total = counts.yes + counts.close;
  let done = Math.min(total, counts.scored);
  await ctx.control.stage("screening", done, total);
  const tally = { scored: 0, unscorable: 0, gone: 0 };
  const settle = async (ids: readonly string[]): Promise<void> => {
    const rows: ScreenWrite[] = ids.map((candidate_id) => ({
      candidate_id,
      score: null,
      reason: null,
    }));
    await db.recordScreen(ctx.orgId, ctx.searchId, rows);
    done += ids.length;
  };
  let calls = 0;
  let failures = 0;
  let stopped = false;
  let after: string | undefined;
  for (;;) {
    if (ctx.control.shouldStop()) {
      stopped = true;
      break;
    }
    const page = await db.listTriage(ctx.searchId, {
      verdict: "kept",
      unscored: true,
      limit: TRIAGE_PAGE,
      ...(after === undefined ? {} : { after }),
    });
    const last = page[page.length - 1];
    if (!last) break;
    after = last.candidate_id;
    const ids = page.map((row) => row.candidate_id);
    const profiles = await db.loadProfiles(ctx.orgId, ids, "card");
    const byId = new Map(profiles.map((profile) => [profile.id, profile] as const));
    const gone = ids.filter((id) => !byId.has(id));
    if (gone.length) {
      await settle(gone);
      tally.gone += gone.length;
      await ctx.control.progress(done, total);
    }
    const batches = lotsOf(profiles, SCREEN_BATCH_MAX).map((batch) => screenEntries(batch));
    const report = await readBatched<ScreenEntry>(
      batches,
      concurrency,
      {
        read: async (part) => {
          const payload = screenPayload(
            role,
            requirements,
            part.map((entry) => entry.card),
          );
          let answer: JsonAnswer<z.output<typeof screenAnswer>>;
          try {
            answer = await callModel(ctx, "screen", {
              system: screenSystemPrompt(),
              user: JSON.stringify(payload),
              schema: screenAnswer,
              temperature: 0,
              maxTokens: SCREEN_TOKENS_BASE + SCREEN_TOKENS_PER_CARD * part.length,
            });
          } catch (error) {
            if (failureKind(error) !== "content") throw error;
            logBatchFailure(ctx, "screening", part.length, error);
            return false;
          }
          const outcomes = enforceScreen(part, answer.value);
          const rows: ScreenWrite[] = [];
          for (const [candidate_id, outcome] of outcomes) {
            rows.push({ candidate_id, score: outcome.score, reason: outcome.reason });
            if (outcome.score === null) tally.unscorable += 1;
            else tally.scored += 1;
          }
          await db.recordScreen(ctx.orgId, ctx.searchId, rows);
          done += part.length;
          await ctx.control.progress(done, total);
          return true;
        },
        failed: async (part) => {
          await db.bumpAttempts(
            ctx.searchId,
            part.map((entry) => entry.candidateId),
          );
        },
        settle: async (part) => {
          await settle(part.map((entry) => entry.candidateId));
          tally.unscorable += part.length;
          await ctx.control.progress(done, total);
        },
      },
      () => ctx.control.shouldStop(),
    );
    calls += report.calls;
    failures += report.failures;
    if (report.stopped) {
      stopped = true;
      break;
    }
    if (page.length < TRIAGE_PAGE) break;
  }
  logStep(ctx, "screening", startedAt, {
    ...tally,
    batches: calls,
    failedBatches: failures,
    done,
    total,
    stopped,
  });
  return { stopped };
}

/**
 * The promotion: the rows promotable() names (every forced row, then
 * the PROMOTE_MAX best by score) that the results lack yet, each read
 * in full, scored by the deterministic pass and written with its triage
 * and its screening on the entry (merge_search_results: an entry is
 * never added twice). No model call. A candidate gone from the pool is
 * left out for this run.
 */
async function stepPromotion(ctx: RunContext): Promise<StepOutcome> {
  const startedAt = Date.now();
  const { db } = ctx.deps;
  const kept = await listKept(ctx);
  const results = parseResults(await db.getResults(ctx.searchId));
  const stored = new Set(results.map((result) => result.candidateId));
  const wanted = promotable(kept).filter(
    (row) => !stored.has(row.candidate_id) && !ctx.skip.has(row.candidate_id),
  );
  await ctx.control.stage("promotion", 0, wanted.length);
  const profiles = await db.loadProfiles(
    ctx.orgId,
    wanted.map((row) => row.candidate_id),
    "full",
  );
  const byId = new Map(profiles.map((profile) => [profile.id, profile] as const));
  const entries: MatchResult[] = [];
  let gone = 0;
  let forced = 0;
  for (const row of wanted) {
    const profile = byId.get(row.candidate_id);
    if (!profile || row.verdict === null) {
      ctx.skip.add(row.candidate_id);
      gone += 1;
      continue;
    }
    if (row.forced) forced += 1;
    entries.push({
      ...scoreCandidate(ctx.criteria, profile, { textRank: null, vectorRank: null }),
      triage: { verdict: row.verdict, reason: row.reason },
      screen: { score: row.score, reason: row.score_reason },
    });
  }
  const held = entries.length
    ? await db.mergeResults(ctx.orgId, ctx.searchId, entries)
    : results.length;
  await ctx.control.progress(entries.length, wanted.length);
  logStep(ctx, "promotion", startedAt, {
    kept: kept.length,
    promoted: entries.length,
    forced,
    gone,
    results: held,
  });
  return { stopped: false };
}

/**
 * The assessed entries carried to the brief's shortlist: an item added
 * before its reading landed holds a match without assessment, and
 * nothing else would update it. Only such an item is written, with the
 * run's criteria alongside so the board and the dossier read the
 * verdicts against the right brief. Best effort: a failure is logged,
 * the entry itself is already stored.
 */
async function carryToShortlist(ctx: RunContext, entries: readonly MatchResult[]): Promise<number> {
  const { db } = ctx.deps;
  let written = 0;
  try {
    const byCandidate = new Map(entries.map((entry) => [entry.candidateId, entry] as const));
    const items = await db.listShortlistItemsFor(ctx.orgId, ctx.brief.id, [...byCandidate.keys()]);
    for (const item of items) {
      const entry = byCandidate.get(item.candidate_id);
      if (!entry || item.match?.assessment) continue;
      await db.patchShortlistItemMatch(item.id, ctx.orgId, {
        ...entry,
        criteria: [...ctx.criteria],
      });
      written += 1;
    }
  } catch (error) {
    logWarn("analysis_carry_failed", { searchId: ctx.searchId, error: describeError(error) });
  }
  return written;
}

/**
 * The full reading: one call per entry without an assessment, the
 * answer bound by enforceAssessment() against the run's criteria and
 * the deterministic verdicts, every quote checked against what the
 * model was given, the reservations held to what one may say (never
 * the CV's silence; the person above the level only when the brief
 * states a maximum, maximumStatedOf()), written entry by entry and
 * carried to the brief's shortlist. A call the model cannot answer is
 * sent once more; then the entry is left unread for this run and
 * counted on the row.
 */
async function stepAssessing(ctx: RunContext): Promise<StepOutcome> {
  const startedAt = Date.now();
  const { db, concurrency } = ctx.deps;
  const results = parseResults(await db.getResults(ctx.searchId));
  const pending = results.filter(
    (result) => !result.assessment && !ctx.skip.has(result.candidateId),
  );
  const total = results.length;
  let done = total - pending.length;
  await ctx.control.stage("assessing", done, total);
  const briefText = briefTextOf(ctx);
  const junior = ctx.brief.role_profile?.seniority === "junior";
  const maximumStated = maximumStatedOf(ctx.brief);
  const maxTokens = Math.min(
    ASSESSMENT_TOKENS_MAX,
    ASSESSMENT_TOKENS_BASE + ASSESSMENT_TOKENS_PER_REQUIREMENT * ctx.criteria.length,
  );
  const profiles = await db.loadProfiles(
    ctx.orgId,
    pending.map((result) => result.candidateId),
    "full",
  );
  const byId = new Map(profiles.map((profile) => [profile.id, profile] as const));
  const jobs: { result: MatchResult; profile: FullProfile }[] = [];
  let gone = 0;
  for (const result of pending) {
    const profile = byId.get(result.candidateId);
    if (profile) jobs.push({ result, profile });
    else {
      ctx.skip.add(result.candidateId);
      gone += 1;
    }
  }
  const tally = { assessed: 0, fit: 0, borderline: 0, noFit: 0, failed: 0, carried: 0 };
  const stopped = await runPool(
    jobs,
    concurrency,
    async (job) => {
      const payload = assessmentPayload(briefText, job.profile);
      const answer = await retryOnContent(ctx, "assessing", 1, ASSESS_RETRIES, () =>
        callModel(ctx, "assess", {
          system: assessmentSystemPrompt(),
          user: JSON.stringify(payload),
          schema: assessmentAnswer,
          temperature: 0,
          maxTokens,
        }),
      );
      if (!answer) {
        ctx.skip.add(job.result.candidateId);
        ctx.readFailures += 1;
        tally.failed += 1;
      } else {
        const assessment = enforceAssessment(
          ctx.criteria,
          job.result.verdicts,
          answer.value,
          answer.usage.model,
          { texts: payloadTexts(payload), junior, maximumStated },
        );
        const entry: MatchResult = { ...job.result, assessment };
        await db.mergeResults(ctx.orgId, ctx.searchId, [entry]);
        tally.carried += await carryToShortlist(ctx, [entry]);
        tally.assessed += 1;
        if (assessment.decision === "fit") tally.fit += 1;
        else if (assessment.decision === "borderline") tally.borderline += 1;
        else tally.noFit += 1;
      }
      done += 1;
      await ctx.control.progress(done, total);
    },
    () => ctx.control.shouldStop(),
  );
  logStep(ctx, "assessing", startedAt, { ...tally, gone, done, total, stopped });
  return { stopped };
}

/**
 * The second opinion: every retained entry without one, in batches of
 * CHALLENGE_BATCH_MAX (one call per entry, the batch written in one
 * merge), applyChallenge() binding the answer: a doubt stands only on a
 * quote found in the profile, never on the CV's silence, and above the
 * level only when the brief states a maximum (maximumStatedOf()). A
 * call the model cannot answer is sent once more, then the entry keeps
 * its first reading for this run.
 */
async function stepChallenging(ctx: RunContext): Promise<StepOutcome> {
  const startedAt = Date.now();
  const { db, concurrency } = ctx.deps;
  const results = parseResults(await db.getResults(ctx.searchId));
  const retained = results.filter((result) => result.assessment?.decision === "fit");
  const pending = retained.filter(
    (result) => !result.assessment?.challenge && !ctx.skip.has(result.candidateId),
  );
  const total = retained.length;
  let done = total - pending.length;
  await ctx.control.stage("challenging", done, total);
  const briefText = briefTextOf(ctx);
  const maximumStated = maximumStatedOf(ctx.brief);
  const tally = { challenged: 0, doubts: 0, failed: 0, gone: 0 };
  let stopped = false;
  for (const batch of lotsOf(pending, CHALLENGE_BATCH_MAX)) {
    if (ctx.control.shouldStop()) {
      stopped = true;
      break;
    }
    const profiles = await db.loadProfiles(
      ctx.orgId,
      batch.map((result) => result.candidateId),
      "full",
    );
    const byId = new Map(profiles.map((profile) => [profile.id, profile] as const));
    const updated: MatchResult[] = [];
    let settled = 0;
    const stoppedInBatch = await runPool(
      batch,
      concurrency,
      async (result) => {
        settled += 1;
        const assessment = result.assessment;
        const profile = byId.get(result.candidateId);
        if (!assessment || !profile) {
          ctx.skip.add(result.candidateId);
          tally.gone += 1;
          return;
        }
        const payload = challengePayload(briefText, profile, assessment);
        const answer = await retryOnContent(ctx, "challenging", 1, 1, () =>
          callModel(ctx, "assess", {
            system: challengeSystemPrompt(),
            user: JSON.stringify(payload),
            schema: challengeAnswer,
            temperature: 0,
            maxTokens: CHALLENGE_TOKENS,
          }),
        );
        if (!answer) {
          ctx.skip.add(result.candidateId);
          tally.failed += 1;
          return;
        }
        const challenged = applyChallenge(assessment, answer.value, {
          texts: payloadTexts(payload),
          maximumStated,
        });
        updated.push({ ...result, assessment: challenged });
        tally.challenged += 1;
        if (challenged.challenge?.verdict === "doubt") tally.doubts += 1;
      },
      () => ctx.control.shouldStop(),
    );
    if (updated.length) await db.mergeResults(ctx.orgId, ctx.searchId, updated);
    done += settled;
    await ctx.control.progress(done, total);
    if (stoppedInBatch) {
      stopped = true;
      break;
    }
  }
  logStep(ctx, "challenging", startedAt, { ...tally, done, total, stopped });
  return { stopped };
}

/**
 * One group compared: the sheets (no name, no CV text), one call, the
 * answer bound by applyRanking(); the entries tiered, or null when the
 * model could not answer twice. An entry the model left out of its
 * answer is settled for this run (the next run sends it again).
 */
async function rankGroup(
  ctx: RunContext,
  stage: "ranking" | "final",
  group: readonly MatchResult[],
): Promise<MatchResult[] | null> {
  const sheets = rankingSheets(group, ctx.criteria);
  const payload = rankingPayload(
    { title: ctx.brief.title, criteria: ctx.criteria, roleProfile: ctx.brief.role_profile },
    sheets,
  );
  const answer = await retryOnContent(ctx, stage, group.length, 1, () =>
    callModel(ctx, "assess", {
      system: rankingSystemPrompt(),
      user: JSON.stringify(payload),
      schema: rankingAnswer,
      temperature: 0,
      maxTokens: Math.min(RANKING_TOKENS_MAX, RANKING_TOKENS_PER_CANDIDATE * group.length + 200),
    }),
  );
  if (!answer) return null;
  const ids = new Set(group.map((result) => result.candidateId));
  const ranked = applyRanking(group, {
    ranking: answer.value.ranking.filter((entry) => ids.has(entry.candidateId)),
  });
  const tiered = ranked.filter((result) => Boolean(result.assessment?.tier));
  const answered = new Set(tiered.map((result) => result.candidateId));
  for (const id of ids) if (!answered.has(id)) ctx.skip.add(id);
  return tiered;
}

/**
 * The tiering: the groups pendingRankGroups() makes of the retained and
 * borderline entries without a tier, each compared in one call, the
 * tiers merged group by group. A group the model cannot answer is
 * settled for this run.
 */
async function stepRanking(ctx: RunContext): Promise<StepOutcome> {
  const startedAt = Date.now();
  const { db, concurrency } = ctx.deps;
  const results = parseResults(await db.getResults(ctx.searchId));
  const byId = new Map(results.map((result) => [result.candidateId, result] as const));
  const groups = pendingRankGroups(results, ctx.skip);
  const total = groups.length;
  let done = 0;
  await ctx.control.stage("ranking", 0, total);
  const tally = { groups: 0, tiered: 0, failed: 0 };
  const stopped = await runPool(
    groups,
    concurrency,
    async (ids) => {
      const group = ids.flatMap((id) => {
        const result = byId.get(id);
        return result ? [result] : [];
      });
      const tiered = await rankGroup(ctx, "ranking", group);
      if (tiered === null) {
        for (const id of ids) ctx.skip.add(id);
        tally.failed += 1;
      } else {
        if (tiered.length) await db.mergeResults(ctx.orgId, ctx.searchId, tiered);
        tally.tiered += tiered.length;
      }
      tally.groups += 1;
      ctx.rankGroupsRun += 1;
      done += 1;
      await ctx.control.progress(done, total);
    },
    () => ctx.control.shouldStop(),
  );
  logStep(ctx, "ranking", startedAt, { ...tally, done, total, stopped });
  return { stopped };
}

/** The final comparison: the A's of the groups, best first, once, so the order of what is presented is one comparison. */
async function stepFinal(ctx: RunContext): Promise<StepOutcome> {
  const startedAt = Date.now();
  const { db } = ctx.deps;
  await ctx.control.stage("final", 0, 1);
  const results = parseResults(await db.getResults(ctx.searchId));
  const byId = new Map(results.map((result) => [result.candidateId, result] as const));
  const group = finalRankGroup(results, ctx.skip).flatMap((id) => {
    const result = byId.get(id);
    return result ? [result] : [];
  });
  let tiered = 0;
  if (group.length) {
    const ranked = await rankGroup(ctx, "final", group);
    if (ranked?.length) {
      await db.mergeResults(ctx.orgId, ctx.searchId, ranked);
      tiered = ranked.length;
    }
  }
  ctx.finalRun = true;
  await ctx.control.progress(1, 1);
  logStep(ctx, "final", startedAt, { compared: group.length, tiered });
  return { stopped: false };
}

/** One step of the run, by stage. */
export async function runStep(ctx: RunContext, stage: AnalysisStage): Promise<StepOutcome> {
  ctx.tally = freshTally();
  switch (stage) {
    case "reading":
      return stepReading(ctx);
    case "snapshot":
      return stepSnapshot(ctx);
    case "triage":
      return stepTriage(ctx);
    case "screening":
      return stepScreening(ctx);
    case "promotion":
      return stepPromotion(ctx);
    case "assessing":
      return stepAssessing(ctx);
    case "challenging":
      return stepChallenging(ctx);
    case "ranking":
      return stepRanking(ctx);
    case "final":
      return stepFinal(ctx);
  }
}
