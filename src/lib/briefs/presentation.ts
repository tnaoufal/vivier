/**
 * Pure helpers behind what the briefs pages show, kept apart from the
 * analysis itself (the shared package holds its rules): the status
 * filter of the list, the newest analysis of each brief, its method,
 * where its job stands and what it counted (kept current from the
 * realtime rows themselves), what its row says of it and how many
 * candidates each shortlist retained; and what the brief page's
 * "Correspondances" tab reads off an analysis: the state its band is in
 * (read off the row's status: the processor runs the job, the page
 * follows it), the time a run has left at the pace its row shows, what
 * a stopped run still has to do, the one line a failed run says, the
 * figures of its funnel and the one line that says them, the
 * matches, the near profiles and the profiles set aside in their order,
 * the one line each row shows (the reason a profile was set aside, the
 * screening's score among them), the turn each row takes when a list
 * unfolds (a batch that lands rises in one row after the other, a row
 * already on screen never moves again), the pages of a list read on
 * demand, and whether the brief's text changed since the model read it.
 * Tested in presentation.test.ts.
 */
import {
  isAnalysisStatus,
  LEFT_POOL_REASON,
  THIN_CARD_REASON,
  UNREADABLE_REASON,
} from "@vivier/analysis";

import type {
  AnalysisStage,
  AnalysisStatus,
  BriefCriterion,
  BriefRow,
  BriefStatus,
  MatchResult,
  SearchMethod,
  SearchRow,
} from "@/lib/db/types";

import { compareTiered, decisionOf, firstMissingRequirement } from "./assessment";
import { briefSourceHash } from "./role-profile";

/** The three views of the list: the briefs being worked on (open or draft), the closed ones, every brief. */
export type BriefFilter = "open" | "closed" | "all";

export const BRIEF_FILTERS: readonly BriefFilter[] = ["open", "closed", "all"];

export function isBriefFilter(value: unknown): value is BriefFilter {
  return typeof value === "string" && (BRIEF_FILTERS as readonly string[]).includes(value);
}

/** The rows the filter keeps, in the order given: "open" is every brief not closed (a draft is still being worked on). */
export function filterBriefs<T extends { status: BriefStatus }>(
  rows: readonly T[],
  filter: BriefFilter,
): T[] {
  if (filter === "all") return [...rows];
  if (filter === "closed") return rows.filter((row) => row.status === "closed");
  return rows.filter((row) => row.status !== "closed");
}

/** How many retained candidates each brief's shortlist holds, from the rows of its items; a brief without one is absent. */
export function retainedByBrief(rows: readonly { briefId: string | null }[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (!row.briefId) continue;
    counts.set(row.briefId, (counts.get(row.briefId) ?? 0) + 1);
  }
  return counts;
}

/** What an analysis counted: its results, how many the model read, how many match (decision fit, whatever their tier). */
export interface AnalysisDigest {
  total: number;
  assessed: number;
  present: number;
}

export function digestResults(results: readonly MatchResult[]): AnalysisDigest {
  let assessed = 0;
  let present = 0;
  for (const result of results) {
    if (result.assessment) assessed += 1;
    if (decisionOf(result) === "fit") present += 1;
  }
  return { total: results.length, assessed, present };
}

/** The newest analysis of a brief as its row says it: when it ran, how (the whole pool, the closest profiles, the text alone), where its job stands and what it counted. */
export interface LatestAnalysis extends AnalysisDigest {
  searchId: string;
  createdAt: string;
  method: SearchMethod;
  /** Where the job stands (the processor runs it); null when the row does not carry it (stored before the job existed, or a payload without the column). */
  status: AnalysisStatus | null;
  /**
   * For a whole-pool search, the profiles of its snapshot the triage has
   * not read, and the ones it kept: no row carries them, they are
   * counted apart by the callers that still read them. Null when not
   * read (the status says where the job stands; these are kept for the
   * rows without one).
   */
  triagePending: number | null;
  kept: number | null;
}

/** The method a row names; a row without one (or with an unknown one) reads as the text path, the oldest. */
function methodColumn(value: unknown): SearchMethod {
  return value === "triage" || value === "hybrid" ? value : "text";
}

/** A count column of a row: a finite number, never below zero; null when the row does not carry it. */
function countColumn(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : null;
}

/**
 * The analysis a realtime change of a search carries, read off the row
 * itself (the processor writes the row stage after stage): its brief,
 * when it ran, where its job stands and what it counted. The summary
 * columns the database keeps (result_count, assessed_count,
 * match_count) are read first, so a row whose results realtime could
 * not carry still counts; a row without them is counted from its
 * results. The method and the status travel with them, so a row can
 * tell a run under way from one done, and an analysis a model reads
 * from a ranking on the text. Null when the row lacks its id, its brief
 * or its date, or carries neither, so the caller reads the analyses
 * again instead.
 */
export function analysisOfRow(
  row: Readonly<Record<string, unknown>>,
): { briefId: string; analysis: LatestAnalysis } | null {
  const id = row["id"];
  const briefId = row["brief_id"];
  const createdAt = row["created_at"];
  if (typeof id !== "string" || typeof briefId !== "string" || typeof createdAt !== "string")
    return null;
  const method = methodColumn(row["method"]);
  const rawStatus = row["status"];
  const status = isAnalysisStatus(rawStatus) ? rawStatus : null;
  const total = countColumn(row["result_count"]);
  const assessed = countColumn(row["assessed_count"]);
  const present = countColumn(row["match_count"]);
  // The triage's counts travel in no row: the caller keeps the last ones read, and reads them again.
  const triage = { triagePending: null, kept: null };
  if (total !== null && assessed !== null && present !== null)
    return {
      briefId,
      analysis: { searchId: id, createdAt, method, status, total, assessed, present, ...triage },
    };
  const results: unknown = row["results"];
  if (!Array.isArray(results)) return null;
  return {
    briefId,
    analysis: {
      searchId: id,
      createdAt,
      method,
      status,
      ...digestResults(results as MatchResult[]),
      ...triage,
    },
  };
}

/**
 * The newest analyses once one search changed: the change takes its
 * brief's place when it is the same search or a newer one, so a late
 * patch of an older search never hides the newest; a patch of the same
 * search that does not carry the status or the triage's counts keeps
 * the ones known. The map given is left untouched; it is answered as is
 * when nothing changes.
 */
export function withAnalysis(
  latest: ReadonlyMap<string, LatestAnalysis>,
  briefId: string,
  analysis: LatestAnalysis,
): ReadonlyMap<string, LatestAnalysis> {
  const kept = latest.get(briefId);
  if (
    kept &&
    kept.searchId !== analysis.searchId &&
    Date.parse(analysis.createdAt) <= Date.parse(kept.createdAt)
  )
    return latest;
  const same = kept?.searchId === analysis.searchId ? kept : undefined;
  const next = new Map(latest);
  next.set(briefId, {
    ...analysis,
    status: analysis.status ?? same?.status ?? null,
    triagePending: analysis.triagePending ?? same?.triagePending ?? null,
    kept: analysis.kept ?? same?.kept ?? null,
  });
  return next;
}

/**
 * The newest analyses once the triage's counts of one search were read
 * again: written into its brief's entry when that entry is still this
 * search, else nothing changes (the map given is answered as is).
 */
export function withTriageProgress(
  latest: ReadonlyMap<string, LatestAnalysis>,
  briefId: string,
  searchId: string,
  progress: { pending: number; kept: number },
): ReadonlyMap<string, LatestAnalysis> {
  const entry = latest.get(briefId);
  if (!entry || entry.searchId !== searchId) return latest;
  const next = new Map(latest);
  next.set(briefId, { ...entry, triagePending: progress.pending, kept: progress.kept });
  return next;
}

/**
 * What a brief's row says of its newest analysis:
 * - "unfinished": a whole-pool search whose job has not ended well:
 *   queued, running, stopped or failed. Its counts are not its answer
 *   yet, so it says neither. A row without the job's status (stored
 *   before the job existed and read without the column) is read as
 *   before: profiles of its snapshot wait for the triage, profiles it
 *   kept are not in the results, or results are not read in full;
 * - "matches": how many profiles match, once the job is done (0 for a
 *   triage that kept nobody);
 * - "ranked": how many profiles an analysis no model read ranked.
 */
export type CardAnalysis =
  | { kind: "unfinished" }
  | { kind: "matches"; count: number }
  | { kind: "ranked"; count: number };

export function cardAnalysisOf(
  analysis: Pick<LatestAnalysis, "method" | "total" | "assessed" | "present"> &
    Partial<Pick<LatestAnalysis, "status" | "triagePending" | "kept">>,
): CardAnalysis {
  if (analysis.method === "triage") {
    const status = analysis.status ?? null;
    if (status !== null)
      return status === "done"
        ? { kind: "matches", count: analysis.present }
        : { kind: "unfinished" };
    if (analysis.assessed < analysis.total) return { kind: "unfinished" };
    const pending = analysis.triagePending ?? null;
    const kept = analysis.kept ?? null;
    if (pending === null || kept === null)
      return analysis.assessed === 0
        ? { kind: "unfinished" }
        : { kind: "matches", count: analysis.present };
    if (pending > 0 || kept > analysis.total) return { kind: "unfinished" };
    return { kind: "matches", count: analysis.present };
  }
  if (analysis.assessed > 0) return { kind: "matches", count: analysis.present };
  return { kind: "ranked", count: analysis.total };
}

// ---------------------------------------------------------------------
// the "Correspondances" tab of a brief
// ---------------------------------------------------------------------

/** The matches of an analysis (decision fit) and nothing else, tier first, then score. */
export function matchesOf(results: readonly MatchResult[]): MatchResult[] {
  return results.filter((result) => decisionOf(result) === "fit").sort(compareTiered);
}

/** The near profiles (decision borderline), worth a look by a person, in the same order. */
export function nearOf(results: readonly MatchResult[]): MatchResult[] {
  return results.filter((result) => decisionOf(result) === "borderline").sort(compareTiered);
}

/** The profiles the full reading set aside (decision no_fit), the closest first, for the list a person opens on demand. */
export function setAsideOf(results: readonly MatchResult[]): MatchResult[] {
  return results.filter((result) => decisionOf(result) === "no_fit").sort(compareTiered);
}

/** What a whole-pool search's triage counted (the read profiles and their verdicts), as the funnel needs it. */
export interface TriageTally {
  read: number;
  yes: number;
  close: number;
  no: number;
  unknown: number;
}

/**
 * The figures of the funnel: the profiles the triage read, the ones it
 * kept (yes, close: the screening scores them and the best are read in
 * full), the ones read in full, the matches, and the ones set aside
 * (another métier at the triage, a card it could not read, or no_fit
 * after the full reading), which a person can always open. Without a
 * triage (an analysis stored before it, or the text path), every result
 * counts as read and kept.
 */
export interface Funnel {
  analysed: number;
  kept: number;
  assessed: number;
  matches: number;
  setAside: number;
}

function atLeastZero(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

export function funnelOf(results: readonly MatchResult[], triage: TriageTally | null): Funnel {
  let assessed = 0;
  let matches = 0;
  let noFit = 0;
  for (const result of results) {
    if (result.assessment) assessed += 1;
    const decision = decisionOf(result);
    if (decision === "fit") matches += 1;
    else if (decision === "no_fit") noFit += 1;
  }
  if (!triage)
    return { analysed: results.length, kept: results.length, assessed, matches, setAside: noFit };
  return {
    analysed: atLeastZero(triage.read),
    kept: atLeastZero(triage.yes) + atLeastZero(triage.close),
    assessed,
    matches,
    setAside: atLeastZero(triage.no) + atLeastZero(triage.unknown) + noFit,
  };
}

/** One figure of the band's line, by what it counts. */
export type FigureKey = "analysed" | "kept" | "assessed" | "setAside";

export interface Figure {
  key: FigureKey;
  count: number;
}

/**
 * The one line of figures under the band's headline, each figure once
 * and only when it says something the headline does not: the profiles
 * analysed; the ones the triage kept (a whole-pool analysis); the ones
 * read in full, when that is not every profile kept (the others are
 * the near profiles the screening scored); the ones set aside (the
 * triage's "no" and "unknown", the readings' no_fit), the figure that
 * opens their list. The matches are the headline's and are never said
 * twice.
 */
export function figuresLine(funnel: Funnel, wholePool: boolean): Figure[] {
  const line: Figure[] = [{ key: "analysed", count: funnel.analysed }];
  if (wholePool) line.push({ key: "kept", count: funnel.kept });
  if (funnel.assessed !== funnel.kept) line.push({ key: "assessed", count: funnel.assessed });
  if (funnel.setAside > 0) line.push({ key: "setAside", count: funnel.setAside });
  return line;
}

/**
 * The first sentence of a text, trimmed: up to the first full stop,
 * question or exclamation mark followed by a space or the end (so
 * "3.5 ans" never splits); the whole text when it has none; "" for a
 * blank one.
 */
export function firstSentence(text: string | null | undefined): string {
  const trimmed = text?.trim() ?? "";
  if (!trimmed) return "";
  const match = /^[\s\S]*?[.!?…](?=\s|$)/.exec(trimmed);
  return (match ? match[0] : trimmed).trim();
}

/** A sentence that says something, trimmed; null for a blank or missing one. */
function sentence(value: string | null | undefined): string | null {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed ? trimmed : null;
}

/**
 * The one line a match row shows: the tiering's note (why this rank
 * among the others), else the first sentence of the reading's summary;
 * null when the model wrote neither (a profile no model read).
 */
export function synthesisLine(result: Pick<MatchResult, "assessment">): string | null {
  const assessment = result.assessment;
  if (!assessment) return null;
  return sentence(assessment.rankNote) ?? sentence(firstSentence(assessment.summary));
}

/** The second opinion's doubt, when it doubted: the first thing any row of the profile says, a match's too. */
export function doubtLine(result: Pick<MatchResult, "assessment">): string | null {
  const challenge = result.assessment?.challenge;
  return challenge?.verdict === "doubt" ? sentence(challenge.reason) : null;
}

/**
 * The one line a near profile's row shows: its main reservation, the
 * second opinion's doubt first, then the first reservation the reading
 * named, else the synthesis line.
 */
export function reservationLine(result: Pick<MatchResult, "assessment">): string | null {
  const assessment = result.assessment;
  if (!assessment) return null;
  return doubtLine(result) ?? sentence(assessment.concerns?.[0]) ?? synthesisLine(result);
}

/**
 * The one line a profile the screening scored but no model read shows:
 * the score first, then the reason the model gave ("72 · Senior, huit
 * ans en contrôle de gestion"); the score alone without a reason, the
 * reason alone without a score; null when the screening wrote neither.
 * `scoreText` words the rounded score with its scale ("72 / 100"); the
 * figure alone by default.
 */
export function screenLine(
  screen: { score: number | null; reason: string | null } | null | undefined,
  scoreText: (score: number) => string = (score) => String(score),
): string | null {
  if (!screen) return null;
  const score =
    typeof screen.score === "number" && Number.isFinite(screen.score)
      ? scoreText(Math.round(screen.score))
      : null;
  const reason = sentence(screen.reason);
  if (score !== null && reason !== null) return `${score} · ${reason}`;
  return score ?? reason;
}

/**
 * Why a profile was set aside, as its row in the list of the profiles
 * set aside says it: for a "no" at the triage, the reason the model gave
 * on its card; for a card the triage could not judge ("unknown", read
 * by nobody), "unread" when the model could not read it and "thin" when
 * it carried no title and no position (or no reason at all); else the
 * first requirement at "no" that sets a profile aside on its own (the
 * role, then the required ones), then the reading's main reservation,
 * then the first sentence of its summary. Null when nothing was written
 * (the row then names the verdict alone).
 */
export type SetAsideReason =
  | { kind: "missing"; criterion: BriefCriterion }
  | { kind: "text"; text: string }
  | { kind: "unread" }
  | { kind: "thin" }
  | { kind: "gone" };

export function setAsideReason(
  criteria: readonly BriefCriterion[],
  entry: Pick<MatchResult, "assessment" | "triage">,
): SetAsideReason | null {
  const triage = entry.triage;
  if (triage?.verdict === "no") {
    const reason = sentence(triage.reason);
    return reason ? { kind: "text", text: reason } : null;
  }
  if (triage?.verdict === "unknown" && !entry.assessment) {
    const reason = sentence(triage.reason);
    if (reason === UNREADABLE_REASON) return { kind: "unread" };
    if (reason === LEFT_POOL_REASON) return { kind: "gone" };
    if (reason === null || reason === THIN_CARD_REASON) return { kind: "thin" };
    return { kind: "text", text: reason };
  }
  const missing = firstMissingRequirement(criteria, entry);
  if (missing) return { kind: "missing", criterion: missing };
  const assessment = entry.assessment;
  if (!assessment) return null;
  const text = sentence(assessment.concerns?.[0]) ?? sentence(firstSentence(assessment.summary));
  return text ? { kind: "text", text } : null;
}

/** How many rows one page of a list read on demand shows (the profiles set aside, the near profiles the screening scored), and one "Voir plus" adds. */
export const SET_ASIDE_PAGE = 50;

/**
 * The rows of a list read page after page, once the next page landed:
 * the rows known first, in their order, then the page's rows not known
 * yet (a verdict written between two reads can shift a page by a row,
 * and a row is listed once). The list given is left untouched.
 */
export function appendPage<T extends { candidateId: string }>(
  rows: readonly T[],
  page: readonly T[],
): T[] {
  const known = new Set(rows.map((row) => row.candidateId));
  const out = [...rows];
  for (const row of page) {
    if (known.has(row.candidateId)) continue;
    known.add(row.candidateId);
    out.push(row);
  }
  return out;
}

/** How many of a result's criteria the deterministic pass found, out of how many: the line of a row ranked on the text alone. */
export function requirementTally(result: Pick<MatchResult, "verdicts">): {
  met: number;
  total: number;
} {
  return {
    met: result.verdicts.filter((verdict) => verdict.verdict === "match").length,
    total: result.verdicts.length,
  };
}

/**
 * True when the brief's text (the title or the need) changed since the
 * model read it: the profile the brief holds was read from another
 * text, and the next analysis reads the brief again. A brief never
 * read, or read before the hash existed, says nothing (false): there is
 * no reading to be out of date.
 */
export function briefChangedSince(
  brief: Pick<BriefRow, "title" | "description" | "role_profile">,
): boolean {
  const hash = brief.role_profile?.sourceHash;
  return typeof hash === "string" && hash !== briefSourceHash(brief);
}

/** The most rows the deterministic ranking shows when no model reads the profiles. */
export const TEXT_RANKING_MAX = 20;

// ---------------------------------------------------------------------
// the band: the job as its row says it
// ---------------------------------------------------------------------

/**
 * The state the analysis band is in, read off the row of the newest
 * search (the processor runs the job and writes the row; the page
 * follows it):
 * - "empty": no analysis on screen;
 * - "queued": stored, not claimed by the processor yet (its poke, or
 *   its scan every thirty seconds, starts it);
 * - "running": the processor works on it; the row says the stage and
 *   how far it is;
 * - "stopped": a person interrupted it; what was stored stays and
 *   "Reprendre" queues the same row again;
 * - "failed": the run ended on an error the row names; "Relancer"
 *   queues it again;
 * - "done": every stage ran;
 * - "legacy": an analysis stored before the whole pool was read, which
 *   read only the profiles closest to the brief (or a pool of unknown
 *   size);
 * - "textOnly": an analysis no model can read (no model on this
 *   deployment, or a brief without criteria), ranked on the text.
 * A row stored before the job existed reads "done" (the column's
 * default), so an earlier analysis reads as it always did.
 */
export type BandState =
  | "empty"
  | "queued"
  | "running"
  | "stopped"
  | "failed"
  | "done"
  | "legacy"
  | "textOnly";

/** What the band reads of the newest search's row (and of its results, once opened). */
export interface BandRow {
  method: SearchMethod;
  status: AnalysisStatus;
  /** The active profiles of the pool when it ran; null for rows stored before that was recorded. */
  poolSize: number | null;
  resultCount: number;
  /** The criteria the analysis was run with. */
  criteriaCount: number;
}

/** `model`: whether the deployment has a model; null while unknown (never read as "no model"). */
export function bandStateOf(row: BandRow | null, model: boolean | null): BandState {
  if (!row) return "empty";
  if (row.status !== "done") return row.status;
  if (row.method === "triage") return "done";
  if (model === false || row.criteriaCount === 0) return "textOnly";
  if (row.poolSize === null || row.resultCount < row.poolSize) return "legacy";
  return "done";
}

/** The i18n key of a stage's name, for the band's heading while the job runs. */
export function stageKey(stage: AnalysisStage): `briefs.analysis.stage.${AnalysisStage}` {
  return `briefs.analysis.stage.${stage}`;
}

/** The shortest a run must have run before its pace says anything about the time left. */
export const ETA_MIN_ELAPSED_MS = 5000;

/**
 * The time a run has left, in milliseconds, at the pace its row shows
 * since it started: `done` of `total` settled since `startedAt` (the
 * overall progress the stage spans give, or a stage's own count), the
 * rest projected at the same pace. Null while that pace is not known
 * (no start, nothing settled yet, or too soon); 0 once nothing is
 * left.
 */
export function etaOf(
  startedAt: string | null | undefined,
  done: number,
  total: number,
  now: number,
): number | null {
  if (!startedAt) return null;
  const started = Date.parse(startedAt);
  if (!Number.isFinite(started) || !Number.isFinite(total) || total <= 0) return null;
  if (done >= total) return 0;
  if (!Number.isFinite(done) || done <= 0) return null;
  const elapsed = now - started;
  if (elapsed < ETA_MIN_ELAPSED_MS) return null;
  return Math.round((elapsed * (total - done)) / done);
}

/** The stages whose items are profiles: a card at the triage, a kept card at the screening, an entry at the full reading. The others count retained entries read again, groups, or one comparison. */
export const PROFILE_STAGES: readonly AnalysisStage[] = ["triage", "screening", "assessing"];

/**
 * What a stopped run's line says, from the stage it stopped at and its
 * count: the profiles that stage had left to read, when its items are
 * profiles ("640 profils restent à analyser"); else the stage with its
 * own count ("Classement · 2 / 4": groups of the tiering, retained
 * entries of the second reading, the triage once every card was read),
 * so a count of groups never reads as profiles; "unfinished" alone when
 * the row names no stage or the stage has no items (stopped before the
 * first step, or during the brief's reading, the snapshot or the
 * selection).
 */
export type StoppedLine =
  | { kind: "profiles"; count: number }
  | { kind: "stage"; stage: AnalysisStage; done: number; total: number }
  | { kind: "unfinished" };

export function stoppedLineOf(
  row: Pick<SearchRow, "stage" | "progress_done" | "progress_total">,
): StoppedLine {
  const stage = row.stage;
  const total = atLeastZero(row.progress_total);
  if (stage === null || total === 0) return { kind: "unfinished" };
  const done = Math.min(total, atLeastZero(row.progress_done));
  if (PROFILE_STAGES.includes(stage) && done < total)
    return { kind: "profiles", count: total - done };
  return { kind: "stage", stage, done, total };
}

/**
 * The one line a failed run says, from the code the processor wrote on
 * the row: the brief's text changed since this run read profiles on its
 * earlier reading (brief_changed: a new analysis reads the new text),
 * the model did not answer (model_unavailable), or any other error
 * (the log holds the cause; the person runs it again).
 */
export type FailureLine = "brief" | "model" | "other";

export function failureLineOf(error: string | null | undefined): FailureLine {
  const code = typeof error === "string" ? error.trim().toLowerCase() : "";
  if (code.startsWith("brief_changed")) return "brief";
  if (code.startsWith("model_unavailable")) return "model";
  return "other";
}

/**
 * The turn each key takes in a list that unfolds: a key already known
 * keeps the turn it was given (so a row on screen never animates
 * again), the new keys count from 0 in the order given (so a batch
 * that lands rises in one row after the other). Keys known before but
 * absent now are forgotten.
 */
export function arrivalIndexes(
  known: ReadonlyMap<string, number>,
  keys: readonly string[],
): Map<string, number> {
  const next = new Map<string, number>();
  let arrived = 0;
  for (const key of keys) {
    if (next.has(key)) continue;
    const turn = known.get(key);
    if (turn === undefined) {
      next.set(key, arrived);
      arrived += 1;
    } else {
      next.set(key, turn);
    }
  }
  return next;
}
