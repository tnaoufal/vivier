/**
 * Pure helpers behind what the briefs pages show, kept apart from the
 * analysis itself (assessment.ts and its rules are the frozen part):
 * the muted line of a brief card, the status filter of the list, the
 * newest analysis of each brief and what it counted (kept current from
 * the realtime rows themselves), and what the brief page's
 * "Correspondances" tab reads off an analysis: the state its band is in,
 * the four figures of its funnel, the matches and the near profiles in
 * their order, the one line each row shows, the split by tier, the step
 * a running stage belongs to, the time left, and the turn each row
 * takes when a list unfolds (a batch that lands rises in one row after
 * the other, a row already on screen never moves again). Tested in
 * presentation.test.ts.
 */
import type {
  AssessmentTier,
  BriefRow,
  BriefStatus,
  MatchResult,
  SearchMethod,
} from "@/lib/db/types";

import { compareTiered, decisionOf, tierOf } from "./assessment";
import type { AnalysisStep } from "./stages";

/** The first non-empty line of a text, trimmed; "" when there is none. */
export function firstLine(text: string | null | undefined): string {
  if (!text) return "";
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed) return trimmed;
  }
  return "";
}

/**
 * The muted line under a brief's title: the domain of its role profile
 * when one was written (what the job is in the market), else the first
 * line of the need; "" when the brief states neither.
 */
export function briefSubtitle(brief: Pick<BriefRow, "description" | "role_profile">): string {
  const domain = brief.role_profile?.domain?.trim();
  if (domain) return domain;
  return firstLine(brief.description);
}

export type BriefFilter = BriefStatus | "all";

export const BRIEF_FILTERS: readonly BriefFilter[] = ["all", "open", "draft", "closed"];

export function isBriefFilter(value: unknown): value is BriefFilter {
  return typeof value === "string" && (BRIEF_FILTERS as readonly string[]).includes(value);
}

/** The rows the filter keeps, in the order given. */
export function filterBriefs<T extends Pick<BriefRow, "status">>(
  rows: readonly T[],
  filter: BriefFilter,
): T[] {
  return filter === "all" ? [...rows] : rows.filter((row) => row.status === filter);
}

/** How many rows each filter would show, for the counts next to the options. */
export function countByFilter<T extends Pick<BriefRow, "status">>(
  rows: readonly T[],
): Record<BriefFilter, number> {
  const counts: Record<BriefFilter, number> = { all: rows.length, open: 0, draft: 0, closed: 0 };
  for (const row of rows) counts[row.status] += 1;
  return counts;
}

/** The newest row of each brief, whatever order the rows come in; a row without a brief is skipped. */
export function latestPerBrief<T extends { brief_id: string | null; created_at: string }>(
  rows: readonly T[],
): Map<string, T> {
  const latest = new Map<string, T>();
  for (const row of rows) {
    if (!row.brief_id) continue;
    const kept = latest.get(row.brief_id);
    if (!kept || Date.parse(row.created_at) > Date.parse(kept.created_at))
      latest.set(row.brief_id, row);
  }
  return latest;
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

/** The newest analysis of a brief as its card says it: when it ran and what it counted. */
export interface LatestAnalysis extends AnalysisDigest {
  searchId: string;
  createdAt: string;
}

/** A count column of a row: a finite number, never below zero; null when the row does not carry it. */
function countColumn(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : null;
}

/**
 * The analysis a realtime change of a search carries, read off the row
 * itself (an analysis writes its results batch after batch): its brief,
 * when it ran and what it counted. The summary columns the database
 * keeps (result_count, assessed_count, match_count) are read first, so
 * a row whose results realtime could not carry still counts; a row
 * without them is counted from its results. Null when the row lacks its
 * id, its brief or its date, or carries neither, so the caller reads
 * the analyses again instead.
 */
export function analysisOfRow(
  row: Readonly<Record<string, unknown>>,
): { briefId: string; analysis: LatestAnalysis } | null {
  const id = row["id"];
  const briefId = row["brief_id"];
  const createdAt = row["created_at"];
  if (typeof id !== "string" || typeof briefId !== "string" || typeof createdAt !== "string")
    return null;
  const total = countColumn(row["result_count"]);
  const assessed = countColumn(row["assessed_count"]);
  const present = countColumn(row["match_count"]);
  if (total !== null && assessed !== null && present !== null)
    return { briefId, analysis: { searchId: id, createdAt, total, assessed, present } };
  const results: unknown = row["results"];
  if (!Array.isArray(results)) return null;
  return {
    briefId,
    analysis: { searchId: id, createdAt, ...digestResults(results as MatchResult[]) },
  };
}

/**
 * The newest analyses once one search changed: the change takes its
 * brief's place when it is the same search or a newer one, so a late
 * patch of an older search never hides the newest. The map given is
 * left untouched; it is answered as is when nothing changes.
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
  const next = new Map(latest);
  next.set(briefId, analysis);
  return next;
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

/** How many matches each tier holds; a match the tiering has not reached yet counts in none. */
export function tierCounts(results: readonly MatchResult[]): Record<AssessmentTier, number> {
  const counts: Record<AssessmentTier, number> = { A: 0, B: 0, C: 0 };
  for (const result of results) {
    if (decisionOf(result) !== "fit") continue;
    const tier = tierOf(result);
    if (tier) counts[tier] += 1;
  }
  return counts;
}

/** What a whole-pool search's triage counted (the read profiles and their verdicts), as the funnel needs it. */
export interface TriageTally {
  read: number;
  yes: number;
  close: number;
  unknown: number;
}

/**
 * The four figures of the funnel: the profiles the triage read, the
 * ones it kept (yes, close, unknown: a card too thin to judge is read
 * rather than dropped), the ones read in full, the matches. Without a
 * triage (an analysis stored before it, or the text path), every
 * result counts as read and kept.
 */
export interface Funnel {
  analysed: number;
  kept: number;
  assessed: number;
  matches: number;
}

export function funnelOf(results: readonly MatchResult[], triage: TriageTally | null): Funnel {
  let assessed = 0;
  let matches = 0;
  for (const result of results) {
    if (result.assessment) assessed += 1;
    if (decisionOf(result) === "fit") matches += 1;
  }
  if (!triage) return { analysed: results.length, kept: results.length, assessed, matches };
  return {
    analysed: Math.max(0, triage.read),
    kept: Math.max(0, triage.yes + triage.close + triage.unknown),
    assessed,
    matches,
  };
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

/**
 * The one line a near profile's row shows: its main reservation, the
 * second opinion's doubt first, then the first reservation the reading
 * named, else the synthesis line.
 */
export function reservationLine(result: Pick<MatchResult, "assessment">): string | null {
  const assessment = result.assessment;
  if (!assessment) return null;
  const challenge = assessment.challenge;
  const doubt = challenge?.verdict === "doubt" ? sentence(challenge.reason) : null;
  return doubt ?? sentence(assessment.concerns?.[0]) ?? synthesisLine(result);
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
 * The results once a stage's answer is in, as the database merges it
 * (merge_search_results): an entry of the answer replaces the entry of
 * the same candidate where it stands, an entry the results lack is
 * appended. The list given is left untouched; it is answered as is
 * when the answer is empty.
 */
export function mergeResults(
  results: readonly MatchResult[],
  answered: readonly MatchResult[],
): readonly MatchResult[] {
  if (!answered.length) return results;
  const updated = new Map(answered.map((entry) => [entry.candidateId, entry] as const));
  const merged = results.map((entry) => {
    const next = updated.get(entry.candidateId);
    if (next) updated.delete(entry.candidateId);
    return next ?? entry;
  });
  return [...merged, ...updated.values()];
}

/** The most rows the deterministic ranking shows when no model reads the profiles. */
export const TEXT_RANKING_MAX = 20;

/**
 * The state the analysis band is in:
 * - "running": a search or a stage is being sent from this page;
 * - "empty": no analysis on screen;
 * - "needsCheck": the model wrote the understanding of the job this
 *   search rests on, and the team checks it before a profile is read;
 * - "textOnly": an analysis no model can read (no model on this
 *   deployment, or a brief without criteria), ranked on the text;
 * - "legacy": an analysis stored before the whole pool was read, which
 *   read only the profiles closest to the brief (or a pool of unknown
 *   size);
 * - "incomplete": profiles of the pool still wait for the triage, the
 *   promotion or a stage (interrupted, or batches that failed);
 * - "done": every stage ran on every profile it could send.
 */
export type BandState =
  | "empty"
  | "running"
  | "needsCheck"
  | "incomplete"
  | "done"
  | "legacy"
  | "textOnly";

export interface BandInputs {
  /** Whether the deployment has a model; null while unknown (never read as "no model"). */
  model: boolean | null;
  /** The method of the analysis on screen; null when none is. */
  method: SearchMethod | null;
  /** True while this page sends the search or a stage. */
  running: boolean;
  /** True when the analysis on screen waits for the team's check. */
  needsCheck: boolean;
  /** The criteria the analysis on screen was run with. */
  criteriaCount: number;
  /** Its results. */
  resultCount: number;
  /** The active profiles of the pool when it ran; null for rows stored before that was recorded. */
  poolSize: number | null;
  /** Profiles of the snapshot the triage has not read (0 without a triage). */
  triagePending: number;
  /** True when the triage kept profiles the results do not hold yet. */
  promotionPending: boolean;
  /** What the stages after the triage still have to send. */
  stagePending: number;
}

export function bandStateOf(inputs: BandInputs): BandState {
  if (inputs.running) return "running";
  if (inputs.method === null) return "empty";
  if (inputs.needsCheck) return "needsCheck";
  const wholePool = inputs.method === "triage";
  if (!wholePool && (inputs.model === false || inputs.criteriaCount === 0)) return "textOnly";
  if (!wholePool && (inputs.poolSize === null || inputs.resultCount < inputs.poolSize))
    return "legacy";
  if (inputs.triagePending > 0 || inputs.promotionPending || inputs.stagePending > 0)
    return "incomplete";
  return "done";
}

/** The four steps the stepper names, in order. */
export const BAND_STEPS = ["triage", "read", "challenge", "rank"] as const;
export type BandStep = (typeof BAND_STEPS)[number];

/** The step of the stepper (0 to 3) a stage belongs to: the promotion closes the triage, the final comparison is part of the tiering. */
export function stepOf(stage: AnalysisStep): number {
  switch (stage) {
    case "triage":
    case "promote":
      return 0;
    case "read":
      return 1;
    case "challenge":
      return 2;
    case "rank":
    case "final":
      return 3;
  }
}

/** The shortest a stage must have run before its pace says anything about the time left. */
export const ETA_MIN_ELAPSED_MS = 5000;

/**
 * The time a stage has left, in milliseconds, at the pace this page saw
 * since it started it (`doneAtStart` profiles already settled then);
 * null while that pace is not known (nothing came back yet, or too
 * soon), 0 once nothing is left.
 */
export function remainingMs(progress: {
  done: number;
  total: number;
  doneAtStart: number;
  startedAt: number;
  now: number;
}): number | null {
  const left = progress.total - progress.done;
  if (left <= 0) return 0;
  const advanced = progress.done - progress.doneAtStart;
  const elapsed = progress.now - progress.startedAt;
  if (advanced <= 0 || elapsed < ETA_MIN_ELAPSED_MS) return null;
  return Math.round((left * elapsed) / advanced);
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
