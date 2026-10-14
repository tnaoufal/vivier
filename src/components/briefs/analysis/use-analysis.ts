/**
 * The controller of a brief's analysis, used by the brief page: the
 * list of its analyses (summaries only), the one on screen with its
 * results and, for a whole-pool search, where its triage stands; the
 * search itself ("Lancer la recherche"), then the loop the browser
 * drives on it, stage after stage (the triage of every profile of the
 * pool, TRIAGE_CONCURRENCY batches at once; the promotion of the ones
 * kept; the full reading, READ_CONCURRENCY batches at once; the second
 * opinion; the tiering, then the final comparison), merging each answer
 * into the view as it lands; the way to stop it, to resume it from what
 * is stored, and to open an earlier analysis; the candidates the rows
 * show; the brief's shortlist. Once the team checked what the model
 * wrote, "Lancer la recherche" starts the search on screen when the job
 * is unchanged, or runs a new one on what they saved. A batch that fails
 * is sent once more at the end of its stage; an error that no retry
 * fixes (rights, setup, the session) stops the loop and says why; a rate
 * limit waits, longer each time, before the call counts as failed. A
 * candidate gone from the pool since the search is settled: never sent
 * again, never keeping an analysis from being complete. An analysis
 * another tab or a colleague is driving (its triage moves, its row
 * changes) is followed, not resumed a second time. Leaving the page
 * stops the loop; nothing stored is lost.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useAuth } from "@/lib/auth/auth-context";
import { requireSupabase } from "@/lib/auth/supabase-client";
import { ASSESS_BATCH_MAX, mostMissingRequirement } from "@/lib/briefs/assessment";
import {
  assessCandidates,
  challengeCandidates,
  promoteTriage,
  rankCandidates,
  runSearch,
  triageCandidates,
  type AssessmentBatch,
} from "@/lib/briefs/briefs.functions";
import { rankResults } from "@/lib/briefs/matching";
import {
  bandStateOf,
  funnelOf,
  jobChangedSince,
  matchesOf,
  mergeResults,
  nearOf,
  TEXT_RANKING_MAX,
  type BandState,
  type Funnel,
} from "@/lib/briefs/presentation";
import {
  addShortlistItem,
  ensureShortlist,
  listSearches,
  pendingTriageIds,
  readResultCandidates,
  readSearch,
  readShortlistState,
  readTriageState,
  type ResultCandidate,
  type SearchSummary,
  type TriageState,
} from "@/lib/briefs/queries";
import {
  batchesOf,
  CHALLENGE_BATCH_MAX,
  finalRankGroup,
  pendingChallenges,
  pendingCount,
  pendingRanks,
  pendingReads,
  READ_CONCURRENCY,
  runPool,
  type AnalysisStep,
} from "@/lib/briefs/stages";
import { TRIAGE_BATCH_MAX, TRIAGE_CONCURRENCY } from "@/lib/briefs/triage";
import { debounce, subscribeToTable } from "@/lib/data/realtime";
import { useQuery } from "@/lib/data/use-query";
import type { BriefCriterion, BriefRow, MatchResult, SearchMethod } from "@/lib/db/types";
import { useI18n } from "@/lib/i18n";
import { errorMessage, withToken } from "@/lib/platform/call";
import { appErrorCode } from "@/lib/platform/errors";
import { toast } from "@/lib/toast";

/** The analysis on screen, as stored. */
export interface AnalysisView {
  id: string;
  method: SearchMethod;
  createdAt: string;
  results: readonly MatchResult[];
  /** The criteria the verdicts refer to, as they were when the search ran. */
  criteria: BriefCriterion[];
  /** Active candidates in the pool at run time; null for a search stored before that was recorded. */
  poolSize: number | null;
}

/** Where the loop stands: the stage, how far it is, and what the time left is read from. */
export interface RunProgress {
  step: AnalysisStep;
  /** Profiles settled in this stage (answered, or stored before it started). */
  done: number;
  total: number;
  /** `done` when this page started the stage, and when: the pace that gives the time left. */
  doneAtStart: number;
  startedAt: number;
  /** During the triage: the profiles it kept so far (yes, close, unknown). */
  kept: number;
}

/** The candidate of a row: undefined while it is being read, null when it was erased. */
export type RowCandidate = ResultCandidate | null | undefined;

/**
 * How long the loop waits before each new try of a call the rate limit
 * refused: the limiter counts over a minute, so the waits grow past it;
 * still refused after the last one (about two minutes), the call fails
 * like a model error and the end of its stage, or a resume, sends it again.
 */
const RATE_PAUSES_MS = [20_000, 40_000, 65_000] as const;
/** A random part added to each wait, so the lanes of one run (or the tabs of one office) do not come back together. */
const RATE_JITTER_MS = 3_000;
/** The most ids one read of candidates names (the gateway refuses a URL past 16 KB). */
const CANDIDATE_LOT = 100;
/** How often the triage of an analysis this page is not driving is read again. */
const TRIAGE_POLL_MS = 15_000;
/**
 * How long an analysis reads as driven elsewhere after it last moved:
 * longer than the slowest call of a stage (a tiering call), short enough
 * that the calls a closed tab left in flight hold "Reprendre" briefly.
 */
const ELSEWHERE_QUIET_MS = 90_000;
/** How long the writes of a loop of this page may still echo back (realtime, the last reads) once it ended. */
const OWN_ECHO_MS = 5_000;

/** Waits `ms`, or less once `stop` says the loop ended (checked every second). */
async function pause(ms: number, stop: () => boolean = () => false): Promise<void> {
  const end = Date.now() + ms;
  while (!stop() && Date.now() < end) {
    await new Promise((resolve) => {
      setTimeout(resolve, Math.min(1_000, Math.max(0, end - Date.now())));
    });
  }
}

export interface AnalysisController {
  /** The analyses of the brief, newest first; null until read. */
  searches: SearchSummary[] | null;
  searchesLoading: boolean;
  view: AnalysisView | null;
  /** True while an analysis is being opened (not a quiet refresh). */
  opening: boolean;
  /** The analysis that could not be opened, for "retry". */
  openFailed: string | null;
  /** Where the triage of the analysis on screen stands; null without one, or while it is read. */
  triage: TriageState | null;
  /** True while the details the band needs are still being read (a whole-pool search's triage). */
  detailsLoading: boolean;
  starting: boolean;
  progress: RunProgress | null;
  band: BandState;
  funnel: Funnel;
  /** Profiles left: unread by the triage, plus what the stages after it still have to send. */
  remaining: number;
  /** True while another tab or a colleague drives the analysis on screen: it moves without this page. */
  elsewhere: boolean;
  matches: MatchResult[];
  near: MatchResult[];
  /** The deterministic ranking a text-only analysis shows, TEXT_RANKING_MAX at most. */
  ranking: MatchResult[];
  /** The requirement most often at "no" among the profiles read, for the zero state. */
  mostMissing: BriefCriterion | null;
  candidateOf: (candidateId: string) => RowCandidate;
  shortlistId: string | null;
  addedIds: ReadonlySet<string>;
  canRun: boolean;
  canResume: boolean;
  /** A new search, or the start of the one on screen once the team checked the job and changed nothing. */
  run: () => Promise<void>;
  /** Sends what the analysis on screen still lacks. */
  resume: () => void;
  stop: () => void;
  open: (searchId: string) => void;
  add: (result: MatchResult) => Promise<void>;
}

export function useAnalysis({
  brief,
  canEdit,
  criteriaDirty,
  modelAvailable,
  onStarted,
}: {
  brief: BriefRow;
  canEdit: boolean;
  /** True while the criteria or the role profile hold unsaved edits: a search reads the saved brief. */
  criteriaDirty: boolean;
  /** Null while unknown, then whether the deployment has a model. */
  modelAvailable: boolean | null;
  /** Called when a search starts, so the page can show its tab. */
  onStarted?: (() => void) | undefined;
}): AnalysisController {
  const { t, locale } = useI18n();
  const { user } = useAuth();
  const orgId = brief.org_id;
  const briefId = brief.id;

  const [view, setView] = useState<AnalysisView | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [openFailed, setOpenFailed] = useState<string | null>(null);
  const [autoOpened, setAutoOpened] = useState(false);
  const [starting, setStarting] = useState(false);
  const [progress, setProgress] = useState<RunProgress | null>(null);
  // The search whose understanding of the job the model wrote and the team has not checked yet.
  const [checkFor, setCheckFor] = useState<string | null>(null);
  const [triage, setTriage] = useState<{ searchId: string; state: TriageState } | null>(null);
  const triageRef = useRef(triage);
  triageRef.current = triage;
  // The analysis seen moving while this page was not driving it, cleared once it stays still ELSEWHERE_QUIET_MS.
  const [elsewhere, setElsewhere] = useState<string | null>(null);
  const elsewhereTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The loops of this page still landing their calls (a stopped one finishes the calls in flight): their writes are not someone else's.
  const ownLoops = useRef(0);
  // The whole-pool searches this page promoted: a profile kept by the
  // triage that left the pool before its promotion never enters the
  // results, and must not keep the analysis "incomplete" forever.
  const [promoted, setPromoted] = useState<ReadonlySet<string>>(() => new Set());
  // The candidates the rows show and the stages settle, by id (null: erased).
  const [people, setPeople] = useState<ReadonlyMap<string, ResultCandidate | null>>(
    () => new Map(),
  );
  const asked = useRef(new Set<string>());
  // Each open (and each search started) takes a number: a read answers only if it is still the latest.
  const loadSeq = useRef(0);

  // The run token: each loop owns one; stopping, starting another or
  // leaving the page changes it, and the loop stops at its next call.
  const runToken = useRef(0);
  const viewRef = useRef(view);
  viewRef.current = view;
  const running = starting || progress !== null;
  const runningRef = useRef(running);
  runningRef.current = running;

  const searches = useQuery(`brief-searches:${briefId}`, async () =>
    listSearches(await requireSupabase(), orgId, briefId),
  );
  const shortlist = useQuery(`brief-shortlist:${briefId}`, async () =>
    readShortlistState(await requireSupabase(), orgId, briefId),
  );
  const refreshSearches = searches.refresh;
  const refreshShortlist = shortlist.refresh;
  const shortlistId = shortlist.data?.shortlistId ?? null;
  const addedIds = useMemo<ReadonlySet<string>>(
    () => new Set(shortlist.data?.candidateIds ?? []),
    [shortlist.data],
  );

  const results = useMemo<readonly MatchResult[]>(() => view?.results ?? [], [view]);
  const matches = useMemo(() => matchesOf(results), [results]);
  const near = useMemo(() => nearOf(results), [results]);
  const textOnly =
    view !== null &&
    view.method !== "triage" &&
    (modelAvailable === false || view.criteria.length === 0);
  const ranking = useMemo(
    () => (textOnly ? rankResults(results).slice(0, TEXT_RANKING_MAX) : []),
    [results, textOnly],
  );

  // A candidate gone from the pool (erased, or archived: the stages read
  // active profiles only) is settled. Only the candidates read so far
  // count, so nothing is settled on a guess.
  const skip = useMemo(() => {
    const out = new Set<string>();
    for (const [id, row] of people) if (row === null || row.status !== "active") out.add(id);
    return out;
  }, [people]);
  const skipRef = useRef(skip);
  skipRef.current = skip;

  /** The candidates the stages still have to send, whatever the pool says of them. */
  const pendingIds = useMemo(() => {
    if (running || textOnly) return [];
    const none = new Set<string>();
    return [
      ...pendingReads(results, none),
      ...pendingChallenges(results, none),
      ...pendingRanks(results, none).flat(),
    ];
  }, [results, running, textOnly]);

  // The rows shown and the candidates still pending are read once each, in lots, as they appear.
  const wanted = useMemo(() => {
    const ids = new Set<string>();
    for (const list of [matches, near, ranking])
      for (const result of list) ids.add(result.candidateId);
    for (const id of pendingIds) ids.add(id);
    return [...ids];
  }, [matches, near, pendingIds, ranking]);

  /**
   * Reads the candidates given, in lots, into the map the rows and the
   * stages read (an erased one is null), and answers what was read.
   */
  const readPeople = useCallback(
    async (ids: readonly string[]): Promise<Map<string, ResultCandidate | null>> => {
      const read = new Map<string, ResultCandidate | null>();
      const supabase = await requireSupabase();
      for (const lot of batchesOf(ids, CANDIDATE_LOT)) {
        const rows = await readResultCandidates(supabase, orgId, lot);
        const byId = new Map(rows.map((row) => [row.id, row] as const));
        for (const id of lot) read.set(id, byId.get(id) ?? null);
        setPeople((current) => {
          const next = new Map(current);
          for (const id of lot) next.set(id, byId.get(id) ?? null);
          return next;
        });
      }
      return read;
    },
    [orgId],
  );

  useEffect(() => {
    const missing = wanted.filter((id) => !people.has(id) && !asked.current.has(id));
    if (!missing.length) return;
    for (const id of missing) asked.current.add(id);
    readPeople(missing).catch((error: unknown) => {
      // Read again on the next change: the ids are no longer marked as asked.
      console.error(error);
      for (const id of missing) asked.current.delete(id);
    });
  }, [people, readPeople, wanted]);

  const candidateOf = useCallback(
    (candidateId: string): RowCandidate => people.get(candidateId),
    [people],
  );

  const triageState = view && triage && triage.searchId === view.id ? triage.state : null;
  const wholePool = view?.method === "triage";
  const detailsLoading = wholePool && triageState === null;
  const funnel = useMemo(
    () => funnelOf(results, wholePool ? triageState : null),
    [results, triageState, wholePool],
  );
  const stagePending = useMemo(() => pendingCount(results, skip), [results, skip]);
  const triagePending = wholePool ? (triageState?.pending ?? 0) : 0;
  const promotionPending =
    wholePool &&
    view !== null &&
    triageState !== null &&
    triageState.pending === 0 &&
    funnel.kept > results.length &&
    !promoted.has(view.id);
  const band = bandStateOf({
    model: modelAvailable,
    method: view?.method ?? null,
    running,
    needsCheck: view !== null && checkFor === view.id,
    criteriaCount: view?.criteria.length ?? 0,
    resultCount: results.length,
    poolSize: view?.poolSize ?? null,
    triagePending,
    promotionPending,
    stagePending,
  });
  const mostMissing = useMemo(
    () => (view ? mostMissingRequirement(view.criteria, results) : null),
    [results, view],
  );

  /**
   * Reads one stored analysis; `quiet` refreshes the one on screen
   * without the skeleton. Only the latest open counts: a read that lands
   * after another open, or after a search started, is dropped.
   */
  const load = useCallback(
    async (searchId: string, quiet: boolean) => {
      const mine = quiet ? loadSeq.current : ++loadSeq.current;
      const current = () =>
        loadSeq.current === mine &&
        (!quiet || (!runningRef.current && viewRef.current?.id === searchId));
      if (!quiet) {
        setOpening(searchId);
        setOpenFailed(null);
        // Another analysis opened: the check waiting on the previous one no longer applies.
        setCheckFor((pending) => (pending === searchId ? pending : null));
      }
      try {
        const supabase = await requireSupabase();
        const row = await readSearch(supabase, orgId, searchId);
        if (!row) throw new Error("NOT_FOUND");
        const state =
          row.method === "triage" ? await readTriageState(supabase, orgId, row.id) : null;
        if (!current()) return;
        setView({
          id: row.id,
          method: row.method,
          createdAt: row.created_at,
          results: row.results,
          criteria: row.criteria,
          poolSize: typeof row.pool_size === "number" ? row.pool_size : null,
        });
        setTriage(state ? { searchId: row.id, state } : null);
      } catch (error) {
        console.error(error);
        if (!quiet && current()) {
          setOpenFailed(searchId);
          toast.error(t("briefs.analysis.loadFailed"));
        }
      } finally {
        if (!quiet && loadSeq.current === mine) setOpening(null);
      }
    },
    [orgId, t],
  );

  const open = useCallback(
    (searchId: string) => {
      if (runningRef.current) return;
      setAutoOpened(true);
      void load(searchId, false);
    },
    [load],
  );

  // The latest analysis opens by itself once the list is known.
  useEffect(() => {
    if (autoOpened || view || searches.loading) return;
    setAutoOpened(true);
    const latest = searches.data?.[0];
    if (latest) void load(latest.id, false);
  }, [autoOpened, load, searches.data, searches.loading, view]);

  /** Notes that the analysis given moved without this page: "Reprendre" waits until it stays still. */
  const sawActivity = useCallback((searchId: string) => {
    if (ownLoops.current > 0) return;
    setElsewhere(searchId);
    if (elsewhereTimer.current) clearTimeout(elsewhereTimer.current);
    elsewhereTimer.current = setTimeout(() => {
      elsewhereTimer.current = null;
      setElsewhere(null);
    }, ELSEWHERE_QUIET_MS);
  }, []);
  useEffect(
    () => () => {
      if (elsewhereTimer.current) clearTimeout(elsewhereTimer.current);
    },
    [],
  );

  useEffect(() => {
    const refreshList = debounce(() => {
      void refreshSearches();
    }, 400);
    // A colleague's batches land in the row shown: read it again, unless
    // this page is the one writing (its own answers are already on screen).
    // Written while this page is not driving it, the analysis is driven
    // elsewhere: "Reprendre" would send its profiles a second time.
    const reread = debounce(() => {
      const id = viewRef.current?.id;
      if (id && !runningRef.current) void load(id, true);
    }, 800);
    return subscribeToTable("searches", `brief_id=eq.${briefId}`, (change) => {
      refreshList();
      const id = viewRef.current?.id;
      if (change.eventType === "UPDATE" && id !== undefined && change.new["id"] === id) {
        if (!runningRef.current) sawActivity(id);
        reread();
      }
    });
  }, [briefId, load, refreshSearches, sawActivity]);

  useEffect(() => {
    if (!shortlistId) return undefined;
    return subscribeToTable(
      "shortlist_items",
      `shortlist_id=eq.${shortlistId}`,
      debounce(() => {
        void refreshShortlist();
      }, 400),
    );
  }, [refreshShortlist, shortlistId]);

  // Leaving the page ends the loop (and keeps a search still being prepared from starting one): what was stored stays.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      runToken.current += 1;
    };
  }, []);

  const stop = useCallback(() => {
    runToken.current += 1;
    setProgress(null);
  }, []);

  /** Reads again where a whole-pool search's triage stands, for the analysis on screen. */
  const refreshTriage = useCallback(
    async (searchId: string) => {
      try {
        const state = await readTriageState(await requireSupabase(), orgId, searchId);
        setTriage((previous) =>
          viewRef.current?.id === searchId ? { searchId, state } : previous,
        );
      } catch (error) {
        console.error(error);
      }
    },
    [orgId],
  );

  // A triage this page is not driving is read again now and then: the
  // verdicts are not broadcast, and another tab or a colleague may be
  // driving it. Its counts then move on screen, and a move means it is
  // driven elsewhere.
  const viewId = view?.id ?? null;
  const triageOpen = wholePool && !running && triageState !== null && triageState.pending > 0;
  useEffect(() => {
    if (!triageOpen || viewId === null) return undefined;
    const searchId = viewId;
    const timer = setInterval(() => {
      // A tab out of sight waits: it reads again when it is looked at.
      if (document.visibilityState === "hidden") return;
      void (async () => {
        try {
          const state = await readTriageState(await requireSupabase(), orgId, searchId);
          if (viewRef.current?.id !== searchId || runningRef.current) return;
          const before = triageRef.current;
          if (
            before?.searchId === searchId &&
            before.state.read === state.read &&
            before.state.pending === state.pending
          )
            return;
          if (before?.searchId === searchId) sawActivity(searchId);
          setTriage({ searchId, state });
        } catch (error) {
          console.error(error);
        }
      })();
    }, TRIAGE_POLL_MS);
    return () => clearInterval(timer);
  }, [orgId, sawActivity, triageOpen, viewId]);

  /**
   * Drives the stages on `start`: for a whole-pool search, the triage of
   * every profile of the snapshot not read yet, then the promotion of
   * the ones kept; then, on the results as each stage leaves them, the
   * full reading of every result not read, the second opinion on the
   * retained ones, the tiering of the retained and borderline ones in
   * groups, and the final comparison of the A's when there were several
   * groups. A stored analysis resumes from what it lacks.
   */
  const analyse = useCallback(
    async (start: AnalysisView) => {
      if (!mounted.current) return;
      const token = ++runToken.current;
      const live = () => runToken.current === token;
      let fatal = false;
      const stopped = () => !live() || fatal;
      const now = Date.now();
      setCheckFor(null);
      setProgress({
        step: start.method === "triage" ? "triage" : "read",
        done: 0,
        total: 0,
        doneAtStart: 0,
        startedAt: now,
        kept: 0,
      });
      const common = async () => ({
        ...(await withToken()),
        orgId,
        briefId,
        searchId: start.id,
      });
      // The results as the stages leave them; each answer is merged into the view as it lands.
      let current: readonly MatchResult[] = start.results;
      const merge = (answered: readonly MatchResult[]) => {
        current = mergeResults(current, answered);
        setView((previous) =>
          previous && previous.id === start.id
            ? { ...previous, results: mergeResults(previous.results, answered) }
            : previous,
        );
      };
      /**
       * One call to the server: null when it failed. A rate limit waits,
       * longer each time, and tries again, then fails this call only (a
       * refusal is never the end of the analysis: the limiter counts per
       * minute, and an office behind one address shares it); an error
       * with another code (rights, setup, the session, the search gone)
       * stops the whole loop and says why; any other (the model, the
       * network) only fails this call.
       */
      const attempt = async <R>(send: () => Promise<R>): Promise<R | null> => {
        for (let round = 0; ; round += 1) {
          if (stopped()) return null;
          try {
            return await send();
          } catch (error) {
            const code = appErrorCode(error);
            if (code === "RATE:limited") {
              const wait = RATE_PAUSES_MS[round];
              if (wait !== undefined) {
                await pause(wait + Math.floor(Math.random() * RATE_JITTER_MS), stopped);
                continue;
              }
              // Still refused after about two minutes: the end of the stage, or a resume, sends it again.
              console.error(error);
              return null;
            }
            console.error(error);
            if (code !== null && !fatal) {
              fatal = true;
              if (live()) toast.error(errorMessage(locale, error));
            }
            return null;
          }
        }
      };
      /** Sends the batches of one stage, a few at once, the failed ones once more at the end; false when the loop must stop. */
      const stage = async (
        step: AnalysisStep,
        batches: readonly string[][],
        concurrency: number,
        send: (candidateIds: string[]) => Promise<AssessmentBatch>,
        already = 0,
      ): Promise<boolean> => {
        if (!batches.length) return true;
        const total = already + batches.reduce((sum, batch) => sum + batch.length, 0);
        let done = already;
        setProgress({ step, done, total, doneAtStart: done, startedAt: Date.now(), kept: 0 });
        const worker = async (batch: string[]) => {
          const answer = await attempt(() => send(batch));
          if (!answer) return null;
          // What came back is stored whatever happened here since: merge it, then obey the token.
          merge(answer.results);
          done += batch.length;
          if (live())
            setProgress((previous) =>
              previous && previous.step === step ? { ...previous, done } : previous,
            );
          return answer;
        };
        const first = await runPool(batches, concurrency, worker, stopped);
        if (stopped()) return false;
        if (first.failed.length) await runPool(first.failed, concurrency, worker, stopped);
        return !stopped();
      };

      // The profiles the triage could not read in this run, even sent twice.
      let triageLeft = 0;
      ownLoops.current += 1;
      try {
        const supabase = await requireSupabase();
        if (start.method === "triage") {
          const [state, unread] = await Promise.all([
            readTriageState(supabase, orgId, start.id),
            pendingTriageIds(supabase, orgId, start.id),
          ]);
          if (!live()) return;
          setTriage({ searchId: start.id, state });
          if (unread.length) {
            let read = state.read;
            let total = state.total;
            let kept = state.yes + state.close + state.unknown;
            setProgress({
              step: "triage",
              done: read,
              total,
              doneAtStart: read,
              startedAt: Date.now(),
              kept,
            });
            const worker = async (batch: string[]) => {
              const answer = await attempt(async () =>
                triageCandidates({ data: { ...(await common()), candidateIds: batch } }),
              );
              if (!answer) return null;
              read += answer.done.length;
              // A profile gone from the pool left the snapshot: the total follows.
              total -= answer.failed.length;
              kept += answer.counts.yes + answer.counts.close + answer.counts.unknown;
              if (live())
                setProgress((previous) =>
                  previous && previous.step === "triage"
                    ? { ...previous, done: read, total, kept }
                    : previous,
                );
              return answer;
            };
            const first = await runPool(
              batchesOf(unread, TRIAGE_BATCH_MAX),
              TRIAGE_CONCURRENCY,
              worker,
              stopped,
            );
            if (stopped()) return;
            if (first.failed.length)
              await runPool(first.failed, TRIAGE_CONCURRENCY, worker, stopped);
            if (stopped()) return;
            const after = await readTriageState(supabase, orgId, start.id);
            if (!live()) return;
            setTriage({ searchId: start.id, state: after });
            triageLeft = after.pending;
          }
          // The profiles kept enter the results (nothing is added twice).
          setProgress({
            step: "promote",
            done: 0,
            total: 0,
            doneAtStart: 0,
            startedAt: Date.now(),
            kept: 0,
          });
          const promotion = await attempt(async () =>
            promoteTriage({ data: { ...(await common()) } }),
          );
          if (!live()) return;
          if (!promotion) {
            if (!fatal) toast.error(t("common.error"));
            return;
          }
          current = promotion.results;
          setView((previous) =>
            previous && previous.id === start.id
              ? { ...previous, results: promotion.results, poolSize: promotion.poolSize }
              : previous,
          );
          setPromoted((previous) => new Set(previous).add(start.id));
        }

        const readBatch = async (candidateIds: string[]): Promise<AssessmentBatch> =>
          assessCandidates({ data: { ...(await common()), candidateIds } });
        const challengeBatch = async (candidateIds: string[]): Promise<AssessmentBatch> =>
          challengeCandidates({ data: { ...(await common()), candidateIds } });
        const rankBatch = async (candidateIds: string[]): Promise<AssessmentBatch> =>
          rankCandidates({ data: { ...(await common()), candidateIds } });
        const reads = pendingReads(current, skipRef.current);
        if (
          !(await stage(
            "read",
            batchesOf(reads, ASSESS_BATCH_MAX),
            READ_CONCURRENCY,
            readBatch,
            current.length - reads.length,
          ))
        )
          return;
        if (
          !(await stage(
            "challenge",
            batchesOf(pendingChallenges(current, skipRef.current), CHALLENGE_BATCH_MAX),
            READ_CONCURRENCY,
            challengeBatch,
          ))
        )
          return;
        // The groups are compared one after the other: each call already weighs several profiles.
        const groups = pendingRanks(current, skipRef.current);
        if (!(await stage("rank", groups, 1, rankBatch))) return;
        // Several groups were tiered apart: the A's of every group are compared once, so their order is one comparison.
        if (
          groups.length > 1 &&
          !(await stage("final", finalRankGroup(current, skipRef.current), 1, rankBatch))
        )
          return;
        // What is left once the candidates gone from the pool are known: they are settled, not left.
        const none = new Set<string>();
        const unsent = [
          ...pendingReads(current, none),
          ...pendingChallenges(current, none),
          ...pendingRanks(current, none).flat(),
        ];
        const settled = new Set<string>(skipRef.current);
        if (unsent.length) {
          const read = await readPeople([...new Set(unsent)]);
          for (const [id, row] of read)
            if (row === null || row.status !== "active") settled.add(id);
        }
        if (!live()) return;
        const left = triageLeft + pendingCount(current, settled);
        if (left > 0)
          toast.error(
            left === 1
              ? t("briefs.analysis.left.one")
              : t("briefs.analysis.left.many", { count: left }),
          );
      } catch (error) {
        console.error(error);
        if (live()) toast.error(errorMessage(locale, error));
      } finally {
        if (live()) setProgress(null);
        // Stopped or done, the counts on screen are read again once the calls in flight have landed.
        void refreshSearches();
        if (start.method === "triage") void refreshTriage(start.id);
        setTimeout(() => {
          ownLoops.current -= 1;
        }, OWN_ECHO_MS);
      }
    },
    [briefId, locale, orgId, readPeople, refreshSearches, refreshTriage, t],
  );

  const run = useCallback(async () => {
    if (!canEdit || criteriaDirty || runningRef.current) return;
    // The team checked what the model wrote for the search on screen:
    // left as it was, that search starts; changed, a new search takes
    // what they saved (a search reads the criteria it was run with).
    const checked = viewRef.current;
    if (
      checked !== null &&
      checkFor === checked.id &&
      modelAvailable !== false &&
      !jobChangedSince(brief, checked.criteria)
    ) {
      onStarted?.();
      void analyse(checked);
      return;
    }
    // An analysis still being opened gives way to the new one.
    loadSeq.current += 1;
    setOpening(null);
    setStarting(true);
    onStarted?.();
    try {
      const answer = await runSearch({ data: { ...(await withToken()), orgId, briefId } });
      const next: AnalysisView = {
        id: answer.searchId,
        method: answer.method,
        createdAt: answer.createdAt,
        results: answer.results,
        criteria: answer.criteria,
        poolSize: answer.poolSize,
      };
      setOpenFailed(null);
      setAutoOpened(true);
      setView(next);
      setTriage(
        answer.method === "triage"
          ? {
              searchId: answer.searchId,
              state: {
                total: answer.poolSize,
                read: 0,
                yes: 0,
                close: 0,
                no: 0,
                unknown: 0,
                pending: answer.poolSize,
              },
            }
          : null,
      );
      void refreshSearches();
      if (answer.roleProfileDerived) toast(t("briefs.profile.derived"));
      else if (answer.criteriaDerived) toast(t("briefs.search.derived"));
      // Nothing a model can read: the ranking on the text is all there is.
      if (next.method !== "triage" && (modelAvailable === false || !next.criteria.length)) return;
      if (next.method !== "triage" && !next.results.length) return;
      // The model wrote the job's understanding this search rests on: the team checks it before a profile is read.
      if (answer.needsCheck) {
        setCheckFor(next.id);
        return;
      }
      void analyse(next);
    } catch (error) {
      console.error(error);
      toast.error(errorMessage(locale, error));
    } finally {
      setStarting(false);
    }
  }, [
    analyse,
    brief,
    briefId,
    canEdit,
    checkFor,
    criteriaDirty,
    locale,
    modelAvailable,
    onStarted,
    orgId,
    refreshSearches,
    t,
  ]);

  const resume = useCallback(() => {
    const current = viewRef.current;
    if (!canEdit || criteriaDirty || !current || runningRef.current || modelAvailable === false)
      return;
    // Driven elsewhere: resuming it here would send its profiles a second time.
    if (elsewhere === current.id) return;
    // Nothing of it was read and the team changed the job since it ran
    // (the check of the model's draft, seen again after a reload): a new
    // search takes what they saved.
    const read = triageRef.current;
    const untouched =
      current.method === "triage" &&
      current.results.length === 0 &&
      read?.searchId === current.id &&
      read.state.read === 0;
    if (untouched && jobChangedSince(brief, current.criteria)) {
      void run();
      return;
    }
    void analyse(current);
  }, [analyse, brief, canEdit, criteriaDirty, elsewhere, modelAvailable, run]);

  const add = useCallback(
    async (result: MatchResult) => {
      if (!user || !canEdit) return;
      // The freshest entry of the analysis (a batch may have landed since the
      // row rendered), with the criteria of the search alongside, so the
      // shortlist reads the verdicts against the brief they were made for.
      const current = viewRef.current;
      const fresh =
        current?.results.find((entry) => entry.candidateId === result.candidateId) ?? result;
      const match: MatchResult = current ? { ...fresh, criteria: current.criteria } : fresh;
      try {
        const supabase = await requireSupabase();
        const id =
          shortlistId ?? (await ensureShortlist(supabase, { orgId, briefId, userId: user.id }));
        const outcome = await addShortlistItem(supabase, {
          orgId,
          shortlistId: id,
          candidateId: result.candidateId,
          match,
          userId: user.id,
        });
        await refreshShortlist();
        toast.success(
          outcome === "added" ? t("briefs.results.addedToast") : t("briefs.results.alreadyAdded"),
        );
      } catch (error) {
        console.error(error);
        toast.error(t("common.error"));
      }
    },
    [briefId, canEdit, orgId, refreshShortlist, shortlistId, t, user],
  );

  return {
    searches: searches.data,
    searchesLoading: searches.loading && searches.data === null,
    view,
    opening: opening !== null,
    openFailed,
    triage: triageState,
    detailsLoading,
    starting,
    progress,
    band,
    funnel,
    remaining: triagePending + stagePending,
    elsewhere: view !== null && elsewhere === view.id,
    matches,
    near,
    ranking,
    mostMissing,
    candidateOf,
    shortlistId,
    addedIds,
    canRun: canEdit && !criteriaDirty && !running,
    canResume:
      canEdit &&
      !criteriaDirty &&
      modelAvailable !== false &&
      !running &&
      band === "incomplete" &&
      !(view !== null && elsewhere === view.id),
    run,
    resume,
    stop,
    open,
    add,
  };
}
