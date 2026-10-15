/**
 * The controller of a brief's analysis, used by the brief page. The
 * processor runs the analysis as a job and writes its row (the status,
 * the stage, how far it is, how it ended); this hook follows the row
 * and never drives a step. It keeps the newest search of the brief (one
 * summary row, live through realtime on `searches` and read again every
 * ten seconds while the job is queued or running), opens it with its
 * stored results (read again when the job's status changes, so the
 * matches land when it ends, and every twenty seconds while the
 * processor reads the profiles in full, so they land as they are read),
 * the triage's counts once the job ended (the band's figures), the near
 * profiles the screening scored but nobody read (page by page, best
 * first, a person may still have one read in full), the profiles the
 * rows show (read in lots, with the years and the place the reading
 * pane says), and the brief's shortlist, kept live. "Analyser" stores
 * the row and pokes the processor (a run stopped or failed on the same
 * reading of the brief is queued again and resumes where it was);
 * "Interrompre" asks the runner to stop at its next step; closing the
 * tab changes nothing. `add` puts a match on the shortlist in one
 * click, to examine or straight as retained or dismissed (the database
 * stamps who and when, as for any decision). Earlier analyses stay in the database and
 * are not opened here: the newest is the one on screen, and a newer one
 * a colleague starts takes its place.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isTerminalStatus, unreadOf } from "@vivier/analysis";

import { useAuth } from "@/lib/auth/auth-context";
import { requireSupabase } from "@/lib/auth/supabase-client";
import { mostMissingRequirement } from "@/lib/briefs/assessment";
import { readAnyway, runSearch, stopAnalysis } from "@/lib/briefs/briefs.functions";
import { rankResults } from "@/lib/briefs/matching";
import {
  appendPage,
  bandStateOf,
  funnelOf,
  matchesOf,
  nearOf,
  SET_ASIDE_PAGE,
  setAsideOf,
  stoppedLineOf,
  TEXT_RANKING_MAX,
  type BandRow,
  type BandState,
  type Funnel,
  type StoppedLine,
} from "@/lib/briefs/presentation";
import {
  ensureShortlist,
  listScreened,
  listSearches,
  readSearch,
  readShortlistState,
  readTriageState,
  type ScreenedEntry,
  type SearchSummary,
  type TriageState,
} from "@/lib/briefs/queries";
import { debounce, subscribeToTable } from "@/lib/data/realtime";
import { useQuery } from "@/lib/data/use-query";
import type {
  AnalysisStage,
  AnalysisStatus,
  BriefCriterion,
  BriefRow,
  MatchResult,
  SearchMethod,
  ShortlistItemStatus,
} from "@/lib/db/types";
import { useI18n, type TranslationKey } from "@/lib/i18n";
import { errorMessage, withToken } from "@/lib/platform/call";
import { addWithStatus, readProfilesById, type ProfileCandidate } from "@/lib/shortlists/queries";
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

/** The candidate of a row: undefined while it is being read, null when it was erased. */
export type RowCandidate = ProfileCandidate | null | undefined;

/** The toast of a profile entering the shortlist: two words, by the status it enters with. */
const ADDED_TOASTS: Record<ShortlistItemStatus, TranslationKey> = {
  to_review: "briefs.results.addedToast",
  retained: "shortlists.toast.retained",
  dismissed: "shortlists.toast.dismissed",
};

/** The near profiles the screening scored but nobody read in full, best first, read page by page. */
export interface ScreenedList {
  rows: readonly ScreenedEntry[];
  /** How many there are in all; the rows are the first of them. */
  total: number;
  /** True while a page is being read. */
  loading: boolean;
  /** True when the last read failed: retry() reads it again. */
  failed: boolean;
  /** True while pages are left to read. */
  hasMore: boolean;
  more: () => Promise<void>;
  retry: () => Promise<void>;
}

/** How often the row is read again while the job is queued or running, besides realtime (belt and braces). */
const ROW_POLL_MS = 10_000;
/** How often the results are read again while the processor reads the profiles in full, so the matches land as they are read. */
const RESULTS_POLL_MS = 20_000;
/** How long a quiet read that failed waits before its one retry. */
const QUIET_RETRY_MS = 5_000;
/** The stages during which the results fill up: the full reading, the second opinion, the tiering. */
const READING_STAGES: readonly AnalysisStage[] = ["assessing", "challenging", "ranking", "final"];

function isLive(status: AnalysisStatus): boolean {
  return status === "queued" || status === "running";
}

export interface AnalysisController {
  /** The newest analysis of the brief as its row says it; null until read, or when there is none. */
  latest: SearchSummary | null;
  /** True while the newest analysis is still being looked up. */
  latestLoading: boolean;
  view: AnalysisView | null;
  /** True while the analysis is being opened (not a quiet refresh). */
  opening: boolean;
  /** True when the newest analysis could not be read or opened, and nothing is on screen: "retry" reads it again. */
  loadFailed: boolean;
  retry: () => void;
  /** The triage's counts of the analysis on screen, once its job ended; null before, or without one. */
  triage: TriageState | null;
  /** True while the figures the band needs are still being read (a whole-pool search's triage counts, once its job ended). */
  detailsLoading: boolean;
  /** True while "Lancer l'analyse" stores the row. */
  starting: boolean;
  /** True while "Interrompre" is being sent, or once the row carries the request and the runner has not stopped yet. */
  stopping: boolean;
  /** True while the job is queued or running (or being started). */
  running: boolean;
  band: BandState;
  funnel: Funnel;
  /** What a stopped run still has to do, as the band's line says it: the profiles its stage had left, else the stage with its own count. */
  stoppedLine: StoppedLine;
  matches: MatchResult[];
  near: MatchResult[];
  /** The near profiles the screening scored but nobody read, listed after the near ones read in full. */
  screened: ScreenedList;
  /** The profiles the full reading set aside (no_fit), listed on demand with those the triage set aside. */
  setAside: MatchResult[];
  /** The deterministic ranking a text-only analysis shows, TEXT_RANKING_MAX at most. */
  ranking: MatchResult[];
  /** The requirement most often at "no" among the profiles read, for the zero state. */
  mostMissing: BriefCriterion | null;
  candidateOf: (candidateId: string) => RowCandidate;
  shortlistId: string | null;
  addedIds: ReadonlySet<string>;
  /** How many of them the team retained. */
  retained: number;
  canRun: boolean;
  /** True when the band carries the primary action (Reprendre, Relancer): the header's button steps back. */
  canResume: boolean;
  canStop: boolean;
  /** Stores the search (or queues the stopped one again) and pokes the processor; the band follows the row from there. */
  run: () => Promise<void>;
  /** Asks the runner to stop at its next step; what was stored stays. */
  stop: () => Promise<void>;
  /** Puts a match on the shortlist, to examine by default, or straight as retained or dismissed (one click, the database stamps who and when); true once stored. */
  add: (result: MatchResult, status?: ShortlistItemStatus) => Promise<boolean>;
  /** Brings a profile the triage or the screening left out back to be read in full (a person overrules the model); true once stored. */
  readAnyway: (candidateId: string) => Promise<boolean>;
}

export function useAnalysis({
  brief,
  canEdit,
  modelAvailable,
  runOnMount = false,
  onStarted,
}: {
  brief: BriefRow;
  canEdit: boolean;
  /** Null while unknown, then whether the deployment has a model. */
  modelAvailable: boolean | null;
  /** True when the page was opened to analyse at once (a brief just created): the search starts by itself when the brief has no analysis yet and the person may run one. */
  runOnMount?: boolean | undefined;
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
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const startingRef = useRef(starting);
  startingRef.current = starting;
  const stoppingRef = useRef(stopping);
  stoppingRef.current = stopping;
  const [triage, setTriage] = useState<{ searchId: string; state: TriageState } | null>(null);
  // The candidates the rows show, by id (null: erased).
  const [people, setPeople] = useState<ReadonlyMap<string, ProfileCandidate | null>>(
    () => new Map(),
  );
  const asked = useRef(new Set<string>());
  // Each open takes a number: a read answers only if it is still the latest.
  const loadSeq = useRef(0);
  // The search and the status the view was last read for: a status that moved on reads it again.
  const loadedFor = useRef<{ id: string; status: AnalysisStatus } | null>(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // The newest analysis alone: the earlier ones stay in the database and are not opened here.
  const searches = useQuery(`brief-latest-search:${briefId}`, async () =>
    listSearches(await requireSupabase(), orgId, briefId, 1),
  );
  const shortlist = useQuery(`brief-shortlist:${briefId}`, async () =>
    readShortlistState(await requireSupabase(), orgId, briefId),
  );
  const refreshSearches = searches.refresh;
  const refreshShortlist = shortlist.refresh;
  const latest = searches.data?.[0] ?? null;
  const latestRef = useRef(latest);
  latestRef.current = latest;
  const shortlistId = shortlist.data?.shortlistId ?? null;
  const addedIds = useMemo<ReadonlySet<string>>(
    () => new Set(shortlist.data?.candidateIds ?? []),
    [shortlist.data],
  );

  const results = useMemo<readonly MatchResult[]>(() => view?.results ?? [], [view]);
  const latestId = latest?.id ?? null;
  const latestStatus = latest?.status ?? null;
  const live = latestStatus !== null && isLive(latestStatus);
  const terminal = latestStatus !== null && isTerminalStatus(latestStatus);
  const reading =
    latest !== null &&
    latest.status === "running" &&
    latest.stage !== null &&
    READING_STAGES.includes(latest.stage);

  // A candidate gone from the pool (erased, or archived) is listed nowhere. Only the candidates read so far count, so nothing is hidden on a guess.
  const skip = useMemo(() => {
    const out = new Set<string>();
    for (const [id, row] of people) if (row === null || row.status !== "active") out.add(id);
    return out;
  }, [people]);

  const matches = useMemo(
    () => matchesOf(results).filter((result) => !skip.has(result.candidateId)),
    [results, skip],
  );
  const near = useMemo(
    () => nearOf(results).filter((result) => !skip.has(result.candidateId)),
    [results, skip],
  );
  const setAside = useMemo(() => setAsideOf(results), [results]);
  const textOnly =
    view !== null &&
    view.method !== "triage" &&
    (modelAvailable === false || view.criteria.length === 0);
  const ranking = useMemo(
    () => (textOnly ? rankResults(results).slice(0, TEXT_RANKING_MAX) : []),
    [results, textOnly],
  );

  /**
   * Reads one stored analysis; `quiet` refreshes the one on screen
   * without the skeleton (and, when the read fails, tries once more a
   * few seconds later). The triage's counts come with it once the job
   * ended: the band's figures read them, and while the job runs the row
   * says enough. Only the latest open counts: a read that lands after
   * another open is dropped.
   */
  const load = useCallback(
    async (searchId: string, quiet: boolean, retry = true): Promise<void> => {
      const mine = quiet ? loadSeq.current : ++loadSeq.current;
      const current = () =>
        mounted.current && loadSeq.current === mine && (!quiet || viewRef.current?.id === searchId);
      if (!quiet) {
        setOpening(searchId);
        setOpenFailed(null);
      }
      try {
        const supabase = await requireSupabase();
        const row = await readSearch(supabase, orgId, searchId);
        if (!row) throw new Error("NOT_FOUND");
        const state =
          row.method === "triage" && isTerminalStatus(row.status)
            ? await readTriageState(supabase, orgId, row.id)
            : null;
        if (!current()) return;
        loadedFor.current = { id: row.id, status: row.status };
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
        if (!current()) return;
        if (!quiet) {
          setOpenFailed(searchId);
          toast.error(t("briefs.analysis.loadFailed"));
        } else if (retry) {
          setTimeout(() => {
            if (current()) void load(searchId, true, false);
          }, QUIET_RETRY_MS);
        }
      } finally {
        if (!quiet && loadSeq.current === mine) setOpening(null);
      }
    },
    [orgId, t],
  );

  // The newest row opens by itself; the row on screen is read again when its job moved on (queued, running, then stopped, done or failed): the results and the figures follow.
  useEffect(() => {
    if (latestId === null || latestStatus === null) return;
    if (openFailed === latestId) return;
    if (viewRef.current?.id !== latestId) {
      if (opening !== latestId) void load(latestId, false);
      return;
    }
    const seen = loadedFor.current;
    if (seen?.id === latestId && seen.status !== latestStatus) void load(latestId, true);
  }, [latestId, latestStatus, load, openFailed, opening]);

  // Live on the row: realtime, and a read every ten seconds while the job is queued or running (a lost event never freezes the band).
  useEffect(() => {
    const refreshList = debounce(() => {
      void refreshSearches();
    }, 400);
    return subscribeToTable("searches", `brief_id=eq.${briefId}`, refreshList);
  }, [briefId, refreshSearches]);
  useEffect(() => {
    if (!live) return undefined;
    const timer = setInterval(() => {
      // A tab out of sight waits: it reads again when it is looked at.
      if (document.visibilityState === "hidden") return;
      void refreshSearches();
    }, ROW_POLL_MS);
    return () => clearInterval(timer);
  }, [live, refreshSearches]);

  // While the processor reads the profiles in full, the results are read again now and then: the matches land as they are read.
  useEffect(() => {
    if (!reading || latestId === null) return undefined;
    const searchId = latestId;
    const timer = setInterval(() => {
      if (document.visibilityState === "hidden") return;
      if (viewRef.current?.id === searchId) void load(searchId, true);
    }, RESULTS_POLL_MS);
    return () => clearInterval(timer);
  }, [latestId, load, reading]);

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

  // Until the brief has a shortlist, the one a colleague creates is read as it lands: its id then starts the subscription above.
  useEffect(() => {
    if (shortlistId) return undefined;
    return subscribeToTable(
      "shortlists",
      `brief_id=eq.${briefId}`,
      debounce(() => {
        void refreshShortlist();
      }, 400),
    );
  }, [briefId, refreshShortlist, shortlistId]);

  // ---------------------------------------------------------------------
  // the near profiles the screening scored but nobody read
  // ---------------------------------------------------------------------

  const [screened, setScreened] = useState<{
    searchId: string;
    rows: ScreenedEntry[];
    total: number;
    /** The rows the pages answered so far, before the ones in the results were left out: the next page starts after them. */
    fetched: number;
    ended: boolean;
  } | null>(null);
  const screenedRef = useRef(screened);
  screenedRef.current = screened;
  const [screenedBusy, setScreenedBusy] = useState(false);
  // Set as a read starts and ends (the state above follows at the next render): two reads never overlap.
  const screenedReading = useRef(false);
  // A first page asked for while another page was being read: read once that read ends, so the list follows the promoted set.
  const firstPageAgain = useRef<string | null>(null);
  const [screenedFailed, setScreenedFailed] = useState(false);
  const wholePool = view?.method === "triage";
  // Once the promotion ran (the processor reads the promoted profiles, or the job ended), the kept rows it did not take are the near profiles left.
  const screenedWanted =
    wholePool && view !== null && latestId === view.id && (terminal || reading);

  /** Reads one page of the screened profiles for the analysis on screen: the first (`from` 0) replaces the list, a later one is appended. */
  const loadScreened = useCallback(
    async (searchId: string, from: number): Promise<void> => {
      if (screenedReading.current) {
        if (from === 0) firstPageAgain.current = searchId;
        return;
      }
      screenedReading.current = true;
      setScreenedBusy(true);
      setScreenedFailed(false);
      try {
        const page = await listScreened(await requireSupabase(), orgId, searchId, {
          exclude: (viewRef.current?.results ?? []).map((result) => result.candidateId),
          from,
          limit: SET_ASIDE_PAGE,
        });
        if (!mounted.current || viewRef.current?.id !== searchId) return;
        const ended = page.fetched < SET_ASIDE_PAGE;
        setScreened((previous) =>
          from === 0 || !previous || previous.searchId !== searchId
            ? {
                searchId,
                rows: page.rows,
                total: page.total ?? page.rows.length,
                fetched: page.fetched,
                ended,
              }
            : {
                ...previous,
                rows: appendPage(previous.rows, page.rows),
                fetched: previous.fetched + page.fetched,
                ended,
              },
        );
      } catch (error) {
        console.error(error);
        if (mounted.current) setScreenedFailed(true);
      } finally {
        screenedReading.current = false;
        if (mounted.current) setScreenedBusy(false);
        const again = firstPageAgain.current;
        firstPageAgain.current = null;
        if (again !== null && mounted.current && viewRef.current?.id === again)
          void loadScreened(again, 0);
      }
    },
    [orgId],
  );

  // The first page is read when the promoted profiles change (they are
  // left out of it) or another search is on screen, so the list follows
  // the job; a quiet reading of the results that promotes nobody (an
  // assessment landing every twenty seconds) leaves the pages a person
  // opened where they are.
  const viewId = view?.id ?? null;
  const promotedKey = useMemo(
    () =>
      (view?.results ?? [])
        .map((result) => result.candidateId)
        .sort()
        .join(","),
    [view],
  );
  useEffect(() => {
    if (!screenedWanted || viewId === null) return;
    void loadScreened(viewId, 0);
  }, [loadScreened, promotedKey, screenedWanted, viewId]);

  const screenedShown = screened !== null && view !== null && screened.searchId === view.id;
  const screenedRows = useMemo<readonly ScreenedEntry[]>(
    () => (screenedShown && screened ? screened.rows : []),
    [screened, screenedShown],
  );
  const moreScreened = useCallback(async () => {
    const current = screenedRef.current;
    if (!current || current.ended || viewRef.current?.id !== current.searchId) return;
    await loadScreened(current.searchId, current.fetched);
  }, [loadScreened]);
  const retryScreened = useCallback(async () => {
    const id = viewRef.current?.id;
    if (id === undefined) return;
    const current = screenedRef.current;
    await loadScreened(id, current && current.searchId === id ? current.fetched : 0);
  }, [loadScreened]);

  // ---------------------------------------------------------------------
  // the candidates the rows show
  // ---------------------------------------------------------------------

  const wanted = useMemo(() => {
    const ids = new Set<string>();
    for (const list of [matches, near, ranking])
      for (const result of list) ids.add(result.candidateId);
    for (const row of screenedRows) ids.add(row.candidateId);
    return [...ids];
  }, [matches, near, ranking, screenedRows]);

  // The rows shown are read once each, in lots, as they appear.
  useEffect(() => {
    const missing = wanted.filter((id) => !people.has(id) && !asked.current.has(id));
    if (!missing.length) return;
    for (const id of missing) asked.current.add(id);
    void (async () => {
      try {
        const found = await readProfilesById(await requireSupabase(), orgId, missing);
        if (!mounted.current) return;
        setPeople((current) => {
          const next = new Map(current);
          for (const [id, row] of found) next.set(id, row);
          return next;
        });
      } catch (error) {
        // Read again on the next change: the ids are no longer marked as asked.
        console.error(error);
        for (const id of missing) asked.current.delete(id);
      }
    })();
  }, [orgId, people, wanted]);

  const candidateOf = useCallback(
    (candidateId: string): RowCandidate => people.get(candidateId),
    [people],
  );

  // ---------------------------------------------------------------------
  // the band
  // ---------------------------------------------------------------------

  const triageState = view && triage && triage.searchId === view.id ? triage.state : null;
  // The figures need the triage's counts once the job ended; they come with the read that follows the status.
  const detailsLoading = wholePool && terminal && triageState === null;
  const funnel = useMemo(
    () => funnelOf(results, wholePool ? triageState : null),
    [results, triageState, wholePool],
  );
  const bandRow: BandRow | null =
    latest && view && view.id === latest.id
      ? {
          method: latest.method,
          status: latest.status,
          poolSize: latest.pool_size,
          resultCount: results.length,
          criteriaCount: view.criteria.length,
        }
      : null;
  const band: BandState = starting ? "queued" : bandStateOf(bandRow, modelAvailable);
  const mostMissing = useMemo(
    () => (view ? mostMissingRequirement(view.criteria, results) : null),
    [results, view],
  );

  // ---------------------------------------------------------------------
  // the actions
  // ---------------------------------------------------------------------

  const run = useCallback(async () => {
    if (!canEdit || startingRef.current) return;
    setStarting(true);
    onStarted?.();
    try {
      await runSearch({ data: { ...(await withToken()), orgId, briefId } });
      // The row is stored, or queued again: the list read shows it, and the band follows it from there.
      await refreshSearches();
    } catch (error) {
      console.error(error);
      toast.error(errorMessage(locale, error));
    } finally {
      if (mounted.current) setStarting(false);
    }
  }, [briefId, canEdit, locale, onStarted, orgId, refreshSearches]);

  // The page opened to analyse at once (a brief just created): the search
  // starts by itself, once, when the brief has no analysis yet and the
  // person may run one. An analysis already there is simply shown.
  const autoRun = useRef(false);
  useEffect(() => {
    if (!runOnMount || autoRun.current || searches.loading || searches.data === null) return;
    autoRun.current = true;
    if (searches.data.length === 0 && canEdit && !startingRef.current) void run();
  }, [canEdit, run, runOnMount, searches.data, searches.loading]);

  const stop = useCallback(async () => {
    const current = latestRef.current;
    if (!canEdit || !current || !isLive(current.status) || stoppingRef.current) return;
    setStopping(true);
    try {
      await stopAnalysis({
        data: { ...(await withToken()), orgId, briefId, searchId: current.id },
      });
      await refreshSearches();
    } catch (error) {
      console.error(error);
      toast.error(errorMessage(locale, error));
    } finally {
      if (mounted.current) setStopping(false);
    }
  }, [briefId, canEdit, locale, orgId, refreshSearches]);

  const add = useCallback(
    async (result: MatchResult, status: ShortlistItemStatus = "to_review"): Promise<boolean> => {
      if (!user || !canEdit) return false;
      // The freshest entry of the analysis (a reading may have landed since the
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
        const outcome = await addWithStatus(supabase, {
          orgId,
          shortlistId: id,
          candidateId: result.candidateId,
          match,
          userId: user.id,
          status,
        });
        await refreshShortlist();
        toast.success(
          t(
            outcome === "already" && status === "to_review"
              ? "briefs.results.alreadyAdded"
              : ADDED_TOASTS[status],
          ),
        );
        return true;
      } catch (error) {
        console.error(error);
        toast.error(t("common.error"));
        return false;
      }
    },
    [briefId, canEdit, orgId, refreshShortlist, shortlistId, t, user],
  );

  const bringBack = useCallback(
    async (candidateId: string): Promise<boolean> => {
      const current = latestRef.current;
      if (!canEdit || !current || current.method !== "triage") return false;
      try {
        await readAnyway({
          data: { ...(await withToken()), orgId, briefId, searchId: current.id, candidateId },
        });
        // A screened row brought back leaves the near profiles: the promotion takes it in next.
        setScreened((previous) => {
          if (!previous || previous.searchId !== current.id) return previous;
          const rows = previous.rows.filter((row) => row.candidateId !== candidateId);
          if (rows.length === previous.rows.length) return previous;
          return { ...previous, rows, total: Math.max(0, previous.total - 1) };
        });
        toast.success(t("briefs.setAside.readAnyway.done"));
        // A run that had ended is queued again for it: the band follows the row.
        void refreshSearches();
        return true;
      } catch (error) {
        console.error(error);
        toast.error(errorMessage(locale, error));
        return false;
      }
    },
    [briefId, canEdit, locale, orgId, refreshSearches, t],
  );

  const stopRequested = latest?.stop_requested === true;

  return {
    latest,
    latestLoading: searches.loading && searches.data === null,
    view,
    opening: opening !== null,
    loadFailed:
      view === null && ((searches.error !== null && searches.data === null) || openFailed !== null),
    retry: () => {
      setOpenFailed(null);
      // The newest row is known: open it again; else look it up again, and the look-up opens it.
      const newest = latestRef.current;
      if (newest) {
        void load(newest.id, false);
        return;
      }
      void refreshSearches();
    },
    triage: triageState,
    detailsLoading,
    starting,
    stopping: stopping || (live && stopRequested),
    running: starting || live,
    band,
    funnel,
    stoppedLine: latest ? stoppedLineOf(latest) : { kind: "unfinished" },
    matches,
    near,
    screened: {
      rows: screenedRows,
      total: screenedShown && screened ? screened.total : 0,
      loading: screenedBusy,
      failed: screenedFailed,
      hasMore: screenedShown && screened !== null && !screened.ended,
      more: moreScreened,
      retry: retryScreened,
    },
    setAside,
    ranking,
    mostMissing,
    candidateOf,
    shortlistId,
    addedIds,
    retained: shortlist.data?.retained ?? 0,
    canRun: canEdit && !starting && !live,
    canResume:
      canEdit &&
      !starting &&
      (band === "stopped" || band === "failed" || (band === "done" && unreadOf(latest?.error) > 0)),
    canStop: canEdit && live && !stopping && !stopRequested,
    run,
    stop,
    add,
    readAnyway: bringBack,
  };
}
