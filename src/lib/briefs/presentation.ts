/**
 * Pure helpers behind what the briefs pages show, kept apart from the
 * analysis itself (assessment.ts and its rules are the frozen part):
 * the status filter of the list, the newest analysis of each brief,
 * its method and what it counted (kept current from the realtime rows
 * themselves, the triage's counts read apart), what its row says of it
 * and how many candidates each shortlist retained; and what the brief
 * page's "Correspondances" tab reads off an analysis: the state its
 * band is in, the figures of its funnel and the one line that says
 * them, the matches, the near profiles and the profiles set aside in
 * their order, the one line each row shows (the reason a profile was
 * set aside among them), the step a running stage belongs to, the time
 * left, the turn each row takes when a list unfolds (a batch that lands
 * rises in one row after the other, a row already on screen never moves
 * again), the pages of a list read on demand, whether the role a search
 * rests on is still the brief's, and whether the brief's text changed
 * since the model read it. Tested in presentation.test.ts.
 */
import type {
  BriefCriterion,
  BriefRow,
  BriefStatus,
  MatchResult,
  SearchMethod,
} from "@/lib/db/types";

import { compareTiered, decisionOf, firstMissingRequirement } from "./assessment";
import { protectedCriterion, roleCriterion } from "./criteria";
import { briefSourceHash, roleDefinitionOf } from "./role-profile";
import type { AnalysisStep } from "./stages";

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

/** The newest analysis of a brief as its row says it: when it ran, how (the whole pool, the closest profiles, the text alone) and what it counted. */
export interface LatestAnalysis extends AnalysisDigest {
  searchId: string;
  createdAt: string;
  method: SearchMethod;
  /**
   * For a whole-pool search, the profiles of its snapshot the triage has
   * not read, and the ones it kept (yes, close, unknown): no row carries
   * them, they are counted apart. Null when not read (another method, a
   * realtime row, a count that failed).
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
 * itself (an analysis writes its results batch after batch): its brief,
 * when it ran and what it counted. The summary columns the database
 * keeps (result_count, assessed_count, match_count) are read first, so
 * a row whose results realtime could not carry still counts; a row
 * without them is counted from its results. The method travels with
 * them, so a row can tell an analysis a model reads from a ranking on
 * the text. Null when the row lacks its id, its brief or its date, or
 * carries neither, so the caller reads the analyses again instead.
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
  const total = countColumn(row["result_count"]);
  const assessed = countColumn(row["assessed_count"]);
  const present = countColumn(row["match_count"]);
  // The triage's counts travel in no row: the caller keeps the last ones read, and reads them again.
  const triage = { triagePending: null, kept: null };
  if (total !== null && assessed !== null && present !== null)
    return {
      briefId,
      analysis: { searchId: id, createdAt, method, total, assessed, present, ...triage },
    };
  const results: unknown = row["results"];
  if (!Array.isArray(results)) return null;
  return {
    briefId,
    analysis: {
      searchId: id,
      createdAt,
      method,
      ...digestResults(results as MatchResult[]),
      ...triage,
    },
  };
}

/**
 * The newest analyses once one search changed: the change takes its
 * brief's place when it is the same search or a newer one, so a late
 * patch of an older search never hides the newest; a patch of the same
 * search that does not carry the triage's counts keeps the ones known.
 * The map given is left untouched; it is answered as is when nothing
 * changes.
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
 * - "unfinished": a whole-pool search not through yet: profiles of its
 *   snapshot wait for the triage, profiles it kept are not in the
 *   results yet, or results are not read in full. Its counts are not its
 *   answer yet (a run still going and one interrupted look alike), so it
 *   says neither. Without the triage's counts, a search none of whose
 *   profiles was read in full cannot be told from a triage that kept
 *   nobody: it reads unfinished too;
 * - "matches": how many profiles match, once every profile was through
 *   (0 for a triage that kept nobody);
 * - "ranked": how many profiles an analysis no model read ranked.
 */
export type CardAnalysis =
  | { kind: "unfinished" }
  | { kind: "matches"; count: number }
  | { kind: "ranked"; count: number };

export function cardAnalysisOf(
  analysis: Pick<LatestAnalysis, "method" | "total" | "assessed" | "present"> &
    Partial<Pick<LatestAnalysis, "triagePending" | "kept">>,
): CardAnalysis {
  if (analysis.method === "triage") {
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
 * kept (yes, close, unknown: a card too thin to judge is read rather
 * than dropped), the ones read in full, the matches, and the ones set
 * aside (another métier at the triage, or no_fit after the full
 * reading), which a person can always open. Without a triage (an
 * analysis stored before it, or the text path), every result counts as
 * read and kept.
 */
export interface Funnel {
  analysed: number;
  kept: number;
  assessed: number;
  matches: number;
  setAside: number;
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
    analysed: Math.max(0, triage.read),
    kept: Math.max(0, triage.yes + triage.close + triage.unknown),
    assessed,
    matches,
    setAside: Math.max(0, triage.no) + noFit,
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
 * read in full, when that is not every profile kept (some are left);
 * the ones set aside (the triage's "no" and the readings' no_fit), the
 * figure that opens their list. The matches are the headline's and are
 * never said twice.
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

/**
 * Why a profile was set aside, as its row in the list of the profiles
 * set aside says it: for a "no" at the triage, the reason the model gave
 * on its card; else the first requirement at "no" that sets a profile
 * aside on its own (the role, then the required ones), then the
 * reading's main reservation, then the first sentence of its summary.
 * Null when nothing was written (the row then names the verdict alone).
 */
export type SetAsideReason =
  | { kind: "missing"; criterion: BriefCriterion }
  | { kind: "text"; text: string };

export function setAsideReason(
  criteria: readonly BriefCriterion[],
  entry: Pick<MatchResult, "assessment" | "triage">,
): SetAsideReason | null {
  if (entry.triage?.verdict === "no") {
    const reason = sentence(entry.triage.reason);
    return reason ? { kind: "text", text: reason } : null;
  }
  const missing = firstMissingRequirement(criteria, entry);
  if (missing) return { kind: "missing", criterion: missing };
  const assessment = entry.assessment;
  if (!assessment) return null;
  const text = sentence(assessment.concerns?.[0]) ?? sentence(firstSentence(assessment.summary));
  return text ? { kind: "text", text } : null;
}

/** How many profiles set aside one page of their list shows, and one "Voir plus" adds. */
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

/**
 * True when the role profile now defines the role otherwise than the
 * search's role criterion: the search ran on another job (runSearch
 * writes that definition from the profile, unless the profile defines
 * nothing or something protected, which this reads as no change).
 */
export function roleChangedSince(
  profile: BriefRow["role_profile"],
  searchCriteria: readonly BriefCriterion[],
): boolean {
  const role = roleCriterion(searchCriteria);
  if (!role || !profile) return false;
  const definition = roleDefinitionOf(profile);
  return (
    definition.length > 0 &&
    definition !== role.value &&
    !protectedCriterion(role.label, definition, "role")
  );
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

/**
 * The state the analysis band is in:
 * - "running": a search or a stage is being sent from this page;
 * - "empty": no analysis on screen;
 * - "textOnly": an analysis no model can read (no model on this
 *   deployment, or a brief without criteria), ranked on the text;
 * - "legacy": an analysis stored before the whole pool was read, which
 *   read only the profiles closest to the brief (or a pool of unknown
 *   size);
 * - "incomplete": profiles of the pool still wait for the triage, the
 *   promotion or a stage (interrupted, or batches that failed);
 * - "done": every stage ran on every profile it could send.
 */
export type BandState = "empty" | "running" | "incomplete" | "done" | "legacy" | "textOnly";

export interface BandInputs {
  /** Whether the deployment has a model; null while unknown (never read as "no model"). */
  model: boolean | null;
  /** The method of the analysis on screen; null when none is. */
  method: SearchMethod | null;
  /** True while this page sends the search or a stage. */
  running: boolean;
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
  const wholePool = inputs.method === "triage";
  if (!wholePool && (inputs.model === false || inputs.criteriaCount === 0)) return "textOnly";
  if (!wholePool && (inputs.poolSize === null || inputs.resultCount < inputs.poolSize))
    return "legacy";
  if (inputs.triagePending > 0 || inputs.promotionPending || inputs.stagePending > 0)
    return "incomplete";
  return "done";
}

/** The four steps the band names, in order. */
export const BAND_STEPS = ["triage", "read", "challenge", "rank"] as const;
export type BandStep = (typeof BAND_STEPS)[number];

/** The step (0 to 3) a stage belongs to: the promotion closes the triage, the final comparison is part of the tiering. */
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
