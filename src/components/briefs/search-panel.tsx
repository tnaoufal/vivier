/**
 * The analysis of the talent pool for a brief. One button runs the
 * search (the whole pool or the hybrid retrieval, then the deterministic
 * verdicts, stored as a searches row) and, when the deployment has a
 * model, drives three stages on its results, one batch after the other,
 * updating the cards as batches return: the reading of every profile
 * (a few candidates at a time), the second opinion on the retained
 * ones, and the comparative tiering of the retained and borderline ones
 * in groups (then of the A's of every group, when there were several).
 * When the search had to write the understanding of the job itself
 * (the role profile, the criteria), nothing is read before the team
 * has looked at it: one sentence says so, with the button that starts
 * the reading, and the deterministic ranking waits under "not
 * analysed". The loop stops when the person interrupts it or leaves
 * the page; a stored analysis resumes the stages it lacks (results
 * without an assessment, retained ones without a second opinion,
 * retained or borderline ones without a tier). Results sit in groups:
 * to present (the one group open, always shown with its count: while a
 * stage runs and nothing is presented yet it shows the progress, and
 * once every stage ran it reads "0 profil correspond à ce brief" with
 * how many were read and the requirement most often missing), to dig
 * into, set aside and not analysed (collapsed with their counts). A
 * result whose candidate left the pool since the search counts as
 * settled: it is never sent again and does not keep an analysis from
 * being complete.
 * Without a model, or without criteria to check, the panel says so and
 * shows the deterministic ranking alone; when the pool was larger than
 * what one search reads, the line under the results says how many
 * profiles were looked at. Previous analyses reopen from their stored
 * results, assessments included; one run before the brief had its role
 * says so, since its verdicts never judged the métier.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, Search, SearchX } from "lucide-react";

import { EmptyState } from "@/components/app-shell/empty-state";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/lib/auth/auth-context";
import { requireSupabase } from "@/lib/auth/supabase-client";
import { ASSESS_BATCH_MAX, bucketResults, mostMissingRequirement } from "@/lib/briefs/assessment";
import {
  assessCandidates,
  challengeCandidates,
  rankCandidates,
  runSearch,
  type AssessmentBatch,
} from "@/lib/briefs/briefs.functions";
import { kindKey, roleCriterion } from "@/lib/briefs/criteria";
import { rankResults } from "@/lib/briefs/matching";
import { FULL_POOL_MAX, RETRIEVAL_LIMIT } from "@/lib/briefs/prompts";
import {
  addShortlistItem,
  ensureShortlist,
  listSearches,
  readResultCandidates,
  readSearch,
  readShortlistState,
} from "@/lib/briefs/queries";
import {
  batchesOf,
  CHALLENGE_BATCH_MAX,
  finalRankGroup,
  pendingChallenges,
  pendingCount,
  pendingRanks,
  pendingReads,
  type AnalysisStage,
} from "@/lib/briefs/stages";
import { debounce, subscribeToTable } from "@/lib/data/realtime";
import { useQuery } from "@/lib/data/use-query";
import type { BriefCriterion, BriefRow, MatchResult, SearchMethod } from "@/lib/db/types";
import { formatDateTime, useI18n } from "@/lib/i18n";
import { errorMessage, withToken } from "@/lib/platform/call";
import { toast } from "@/lib/toast";

import { AssessmentProgress } from "./assessment-progress";
import type { ModelAvailability } from "./criteria-proposals";
import { ResultCard } from "./result-card";
import { ResultGroup } from "./result-group";

interface SearchView {
  id: string;
  method: SearchMethod;
  createdAt: string;
  results: MatchResult[];
  /** The criteria the verdicts refer to, as they were when the search ran. */
  criteria: BriefCriterion[];
  /** Active candidates in the pool at run time; null for a search stored before that was recorded. */
  poolSize: number | null;
}

interface Progress {
  stage: AnalysisStage;
  /** Candidates already sent in this stage (answered or failed) plus, for the reading, those stored before it. */
  done: number;
  total: number;
}

/** The result of one call of a stage: the batch answered, or null when the call failed (the loop stops; a toast said why). */
type StageCall = (ids: string[]) => Promise<AssessmentBatch | null>;

/** A search whose understanding of the job the model wrote and nobody checked yet: the reading waits for the team. */
interface PendingCheck {
  searchId: string;
  /** What the model wrote: the role profile, or the requirements. */
  wrote: "profile" | "criteria";
}

function ResultSkeleton() {
  return (
    <ul className="space-y-6">
      {Array.from({ length: 3 }, (_, index) => (
        <li key={index} className="sheet flex gap-4 p-6">
          <div className="skeleton size-10 rounded-full" />
          <div className="flex-1 space-y-3">
            <div className="skeleton h-4 w-1/3 rounded" />
            <div className="skeleton h-3 w-2/3 rounded" />
            <div className="skeleton h-10 w-full rounded-xl" />
          </div>
          <div className="skeleton size-14 rounded-full" />
        </li>
      ))}
    </ul>
  );
}

export function SearchPanel({
  brief,
  canEdit,
  criteriaDirty,
  modelAvailable,
}: {
  brief: BriefRow;
  canEdit: boolean;
  /** True while the criteria editor holds unsaved rows: a search reads the saved brief. */
  criteriaDirty: boolean;
  /** Null while unknown, then whether a model is set up: the assessment needs one. */
  modelAvailable: ModelAvailability;
}) {
  const { t, locale } = useI18n();
  const { user } = useAuth();
  const [current, setCurrent] = useState<SearchView | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [autoOpened, setAutoOpened] = useState(false);
  const [needsCheck, setNeedsCheck] = useState<PendingCheck | null>(null);
  // The run token: each analysis loop owns one; interrupting, starting
  // another, or leaving the page changes it and the loop stops at its next call.
  const runToken = useRef(0);
  // The analysis shown, readable from callbacks without a stale closure.
  const currentRef = useRef<SearchView | null>(null);
  currentRef.current = current;
  const assessing = useRef(false);
  assessing.current = progress !== null;

  const searches = useQuery(`brief-searches:${brief.id}`, async () =>
    listSearches(await requireSupabase(), brief.org_id, brief.id),
  );
  const shortlist = useQuery(`brief-shortlist:${brief.id}`, async () =>
    readShortlistState(await requireSupabase(), brief.org_id, brief.id),
  );

  const ranked = useMemo(() => (current ? rankResults(current.results) : []), [current]);
  const buckets = useMemo(() => bucketResults(ranked), [ranked]);
  const ids = useMemo(() => ranked.map((result) => result.candidateId), [ranked]);
  // The rows answer for the search they were read for, so a reopened
  // analysis never reads the previous one's candidates as its own.
  const candidates = useQuery(
    `brief-result-candidates:${current?.id ?? ""}`,
    async () => ({
      searchId: current?.id ?? null,
      rows: await readResultCandidates(await requireSupabase(), brief.org_id, ids),
    }),
    ids.length > 0,
  );
  const rows =
    candidates.data !== null && candidates.data.searchId === current?.id
      ? candidates.data.rows
      : null;
  const byId = useMemo(
    () => new Map((rows ?? []).map((candidate) => [candidate.id, candidate] as const)),
    [rows],
  );
  // A result whose candidate left the pool since the search (erased, or
  // archived: the stages read active profiles only) is settled: it is
  // never sent again and does not keep the analysis from being complete.
  // Nothing is settled until the candidates are known.
  const settledIds = useMemo(
    () =>
      new Set(
        rows === null
          ? []
          : ranked
              .filter((result) => byId.get(result.candidateId)?.status !== "active")
              .map((result) => result.candidateId),
      ),
    [byId, ranked, rows],
  );
  const shortlistId = shortlist.data?.shortlistId ?? null;
  const addedIds = useMemo(() => new Set(shortlist.data?.candidateIds ?? []), [shortlist.data]);

  const open = useCallback(
    async (searchId: string) => {
      setOpening(searchId);
      // Another analysis opened: the check waiting on the previous one no longer applies.
      setNeedsCheck((pending) => (pending && pending.searchId === searchId ? pending : null));
      try {
        const row = await readSearch(await requireSupabase(), brief.org_id, searchId);
        if (row) {
          setCurrent({
            id: row.id,
            method: row.method,
            createdAt: row.created_at,
            results: row.results,
            criteria: row.criteria,
            poolSize: typeof row.pool_size === "number" ? row.pool_size : null,
          });
        }
      } catch (error) {
        console.error(error);
        toast.error(t("briefs.search.loadFailed"));
      } finally {
        setOpening(null);
      }
    },
    [brief.org_id, t],
  );

  // The latest analysis opens by itself once the list is known.
  useEffect(() => {
    if (autoOpened || current || searches.loading) return;
    setAutoOpened(true);
    const latest = searches.data?.[0];
    if (latest) void open(latest.id);
  }, [autoOpened, current, open, searches.data, searches.loading]);

  const refreshSearches = searches.refresh;
  const refreshShortlist = shortlist.refresh;
  const refreshCandidates = candidates.refresh;
  useEffect(() => {
    const refreshList = debounce(() => {
      void refreshSearches();
    }, 400);
    // A colleague's batches land in the row shown: reopen it, unless this
    // browser is the one writing (its own merges are already on screen).
    const reopenCurrent = debounce(() => {
      const id = currentRef.current?.id;
      if (id && !assessing.current) void open(id);
    }, 800);
    return subscribeToTable("searches", `brief_id=eq.${brief.id}`, (change) => {
      refreshList();
      if (change.eventType === "UPDATE" && change.new["id"] === currentRef.current?.id)
        reopenCurrent();
    });
  }, [brief.id, open, refreshSearches]);
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

  // Leaving the page ends the loop: nothing is lost, the batches already stored stay.
  useEffect(
    () => () => {
      runToken.current += 1;
    },
    [],
  );

  function stop() {
    runToken.current += 1;
    setProgress(null);
  }

  /**
   * Drives the three stages on `view`, skipping the settled candidates:
   * every result not yet read, ASSESS_BATCH_MAX at a time; then the
   * retained ones without a second opinion, CHALLENGE_BATCH_MAX at a
   * time; then the retained and borderline ones without a tier, in
   * groups. Each stage reads the results as the previous one left them,
   * so a stored analysis resumes from the stages it lacks.
   */
  const analyse = useCallback(
    async (view: SearchView, skip: ReadonlySet<string>) => {
      const token = ++runToken.current;
      setNeedsCheck(null);
      const common = async () => ({
        ...(await withToken()),
        orgId: brief.org_id,
        briefId: brief.id,
        searchId: view.id,
      });
      // The results as the stages leave them, merged into the view as each call returns.
      let results = view.results;
      const merge = (answered: readonly MatchResult[]) => {
        const updated = new Map(answered.map((result) => [result.candidateId, result] as const));
        results = results.map((result) => updated.get(result.candidateId) ?? result);
        setCurrent((previous) =>
          previous && previous.id === view.id
            ? {
                ...previous,
                results: previous.results.map(
                  (result) => updated.get(result.candidateId) ?? result,
                ),
              }
            : previous,
        );
      };
      const guarded =
        (call: (ids: string[]) => Promise<AssessmentBatch>): StageCall =>
        async (batch) => {
          try {
            return await call(batch);
          } catch (error) {
            console.error(error);
            toast.error(errorMessage(locale, error));
            return null;
          }
        };
      const read = guarded(async (candidateIds) =>
        assessCandidates({ data: { ...(await common()), candidateIds } }),
      );
      const challenge = guarded(async (candidateIds) =>
        challengeCandidates({ data: { ...(await common()), candidateIds } }),
      );
      const rank = guarded(async (candidateIds) =>
        rankCandidates({ data: { ...(await common()), candidateIds } }),
      );
      let failures = 0;
      /** Sends the batches of one stage one after the other; false when the loop must stop. */
      const stage = async (
        name: AnalysisStage,
        batches: readonly string[][],
        call: StageCall,
        already = 0,
      ): Promise<boolean> => {
        if (!batches.length) return true;
        const total = already + batches.reduce((sum, batch) => sum + batch.length, 0);
        let done = already;
        setProgress({ stage: name, done, total });
        for (const batch of batches) {
          if (runToken.current !== token) return false;
          const answer = await call(batch);
          if (!answer) return false;
          // What came back is stored whatever happened here since: merge it, then obey the token.
          merge(answer.results);
          if (runToken.current !== token) return false;
          failures += answer.failed.length;
          done += batch.length;
          setProgress({ stage: name, done, total });
        }
        return true;
      };
      try {
        const reads = pendingReads(results, skip);
        if (
          !(await stage(
            "read",
            batchesOf(reads, ASSESS_BATCH_MAX),
            read,
            results.length - reads.length,
          ))
        )
          return;
        if (
          !(await stage(
            "challenge",
            batchesOf(pendingChallenges(results, skip), CHALLENGE_BATCH_MAX),
            challenge,
          ))
        )
          return;
        const groups = pendingRanks(results, skip);
        if (!(await stage("rank", groups, rank))) return;
        // Several groups were tiered apart: the A's of every group are compared once, so their order is one comparison.
        if (groups.length > 1 && !(await stage("final", finalRankGroup(results, skip), rank)))
          return;
        if (failures > 0) {
          toast.error(t("briefs.search.failed", { count: failures }));
          // A candidate archived or erased during the run is among them: read the rows again so it settles.
          void refreshCandidates();
        }
      } finally {
        if (runToken.current === token) setProgress(null);
      }
    },
    [brief.id, brief.org_id, locale, refreshCandidates, t],
  );

  async function run() {
    if (!canEdit || running || criteriaDirty || progress) return;
    setRunning(true);
    try {
      const answer = await runSearch({
        data: { ...(await withToken()), orgId: brief.org_id, briefId: brief.id },
      });
      const view: SearchView = {
        id: answer.searchId,
        method: answer.method,
        createdAt: answer.createdAt,
        results: answer.results,
        criteria: answer.criteria,
        poolSize: answer.poolSize,
      };
      setCurrent(view);
      setAutoOpened(true);
      void refreshSearches();
      if (answer.roleProfileDerived) toast(t("briefs.profile.derived"));
      if (answer.criteriaDerived) toast(t("briefs.search.derived"));
      // No criteria: nothing to check, so no model reads the profiles (the ranked group says so).
      if (modelAvailable === false || !view.results.length || !view.criteria.length) return;
      // The model wrote the job's understanding this search rests on: the team checks it before a profile is read.
      if (answer.needsCheck) {
        setNeedsCheck({
          searchId: view.id,
          wrote: answer.roleProfileDerived ? "profile" : "criteria",
        });
        return;
      }
      void analyse(view, new Set<string>());
    } catch (error) {
      console.error(error);
      toast.error(errorMessage(locale, error));
    } finally {
      setRunning(false);
    }
  }

  async function add(result: MatchResult) {
    if (!user) return;
    // The freshest entry of the analysis (a batch may have landed since the
    // card rendered), with the criteria of the search alongside, so the
    // shortlist reads the verdicts against the brief they were made for.
    const view = currentRef.current;
    const fresh = view?.results.find((entry) => entry.candidateId === result.candidateId) ?? result;
    const match: MatchResult = view ? { ...fresh, criteria: view.criteria } : fresh;
    try {
      const supabase = await requireSupabase();
      const id =
        shortlistId ??
        (await ensureShortlist(supabase, {
          orgId: brief.org_id,
          briefId: brief.id,
          userId: user.id,
        }));
      const outcome = await addShortlistItem(supabase, {
        orgId: brief.org_id,
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
  }

  function countText(count: number): string {
    if (count === 0) return t("briefs.search.count.none");
    if (count === 1) return t("briefs.search.count.one");
    return t("briefs.search.count.many", { count });
  }

  function readText(count: number): string {
    if (count === 0) return t("briefs.search.line.read.none");
    if (count === 1) return t("briefs.search.line.read.one");
    return t("briefs.search.line.read.many", { count });
  }

  function presentText(count: number): string {
    if (count === 0) return t("briefs.search.line.present.none");
    if (count === 1) return t("briefs.search.line.present.one");
    return t("briefs.search.line.present.many", { count });
  }

  function deeperText(count: number): string {
    if (count === 0) return t("briefs.search.line.deeper.none");
    if (count === 1) return t("briefs.search.line.deeper.one");
    return t("briefs.search.line.deeper.many", { count });
  }

  function assessedText(count: number): string {
    if (count === 0) return t("briefs.search.nofit.assessed.none");
    if (count === 1) return t("briefs.search.nofit.assessed.one");
    return t("briefs.search.nofit.assessed.many", { count });
  }

  const textOnly = modelAvailable === false;
  /** No requirement to check: the ranking on the text is all there is, as without a model. */
  const noCriteria = current !== null && current.criteria.length === 0;
  const busy = running || progress !== null;
  const unassessedCount = buckets.unassessed.length;
  /** The unread results the model can still read: a candidate gone from the pool is not one. */
  const unreadCount = pendingReads(ranked, settledIds).length;
  /** What the three stages still have to send: unread profiles, retained ones without a second opinion, untiered ones. */
  const leftCount = pendingCount(ranked, settledIds);
  const assessedCount = ranked.length - unassessedCount;
  /** Every stage ran on what could be sent: nothing left to read, to challenge or to tier, so "to present" can only be what it is. */
  const complete = ranked.length > 0 && leftCount === 0;
  const pendingCheck = current !== null && needsCheck?.searchId === current.id ? needsCheck : null;
  const canResume =
    canEdit &&
    !textOnly &&
    !noCriteria &&
    current !== null &&
    leftCount > 0 &&
    !busy &&
    pendingCheck === null;
  // An analysis stored before the brief had its role (its criteria are the
  // search's, frozen at run time) presents profiles whose métier was never
  // judged: the line says so, and only a new run judges it.
  const roleStale =
    !textOnly &&
    current !== null &&
    roleCriterion(brief.criteria) !== null &&
    roleCriterion(current.criteria) === null;

  const runButton = canEdit ? (
    <Button
      type="button"
      onClick={() => void run()}
      disabled={busy || criteriaDirty}
      className="gap-1.5"
    >
      <Search />
      {running ? t("briefs.search.running") : t("briefs.search.run")}
    </Button>
  ) : null;

  const candidatesPending = ids.length > 0 && rows === null && candidates.error === null;

  function cards(list: readonly MatchResult[], muted = false) {
    if (!current) return null;
    return (
      <ul className="space-y-6">
        {list.map((result) => (
          <li key={result.candidateId}>
            <ResultCard
              result={result}
              criteria={current.criteria}
              candidate={byId.get(result.candidateId) ?? null}
              shortlistId={shortlistId}
              added={addedIds.has(result.candidateId)}
              canEdit={canEdit}
              muted={muted}
              onAdd={() => add(result)}
            />
          </li>
        ))}
      </ul>
    );
  }

  function methodLine(view: SearchView): string {
    const parts: string[] = [];
    if (textOnly) {
      parts.push(t("briefs.search.line.noModel"));
      if (!view.criteria.length) parts.push(t("briefs.search.line.noCriteria"));
    } else if (!view.criteria.length) {
      // No criteria at run time (none written, none derived): no model read the profiles.
      parts.push(t("briefs.search.line.noCriteria.model"));
    } else {
      parts.push(t("briefs.search.line.model"), readText(assessedCount));
      // Once a profile was read, or every stage ran, the line counts what is to present ("0 à présenter" included).
      if (assessedCount > 0 || complete)
        parts.push(presentText(buckets.present.length), deeperText(buckets.deeper.length));
      if (unreadCount > 0 && !progress)
        parts.push(t("briefs.search.line.pending", { count: unreadCount }));
    }
    // A pool larger than what one search reads whole: only the closest profiles were looked at, and the line says so.
    if (view.poolSize !== null && view.poolSize > FULL_POOL_MAX) {
      parts.push(
        t("briefs.search.line.truncated", { total: view.poolSize, read: view.results.length }),
      );
    }
    parts.push(t("briefs.search.ranAt", { date: formatDateTime(locale, view.createdAt) }));
    return parts.join(" · ");
  }

  /** Under "0 profil correspond à ce brief": how many profiles were read, and the requirement most often missing when one is. */
  function zeroText(view: SearchView): string {
    const parts = [assessedText(assessedCount)];
    const missing = mostMissingRequirement(view.criteria, ranked);
    if (missing) {
      const label =
        missing.kind === "role" ? `${t(kindKey(missing.kind))} · ${missing.label}` : missing.label;
      parts.push(t("briefs.search.nofit.missing", { label }));
    }
    return parts.join(" · ");
  }

  /**
   * What "to present" shows when it holds nothing: that the cards land
   * as batches return while a stage runs (the stage and its count are
   * on the progress line above the results, said once), the calm zero
   * once every stage ran, or, between the two, why the list is not
   * final yet. The zero keeps the look of an EmptyState with its
   * headline as a paragraph: the group's own title is the heading.
   */
  function presentEmpty(view: SearchView) {
    if (progress) {
      return (
        <p className="sheet p-6 text-sm text-muted-foreground">
          {t("briefs.section.present.running")}
        </p>
      );
    }
    if (complete) {
      return (
        <div className="sheet flex flex-col items-center px-6 py-16 text-center">
          <div className="mb-5 flex size-14 items-center justify-center rounded-full bg-primary/10 text-primary [&_svg]:size-6">
            <SearchX />
          </div>
          <p className="max-w-md font-display text-xl text-ink break-words">
            {t("briefs.search.nofit.title")}
          </p>
          <p className="mt-2 max-w-md text-[15px] leading-6 text-muted-foreground">
            {zeroText(view)}
          </p>
        </div>
      );
    }
    return (
      <p className="sheet p-6 text-sm text-muted-foreground">
        {t(pendingCheck ? "briefs.section.present.unread" : "briefs.section.present.incomplete")}
      </p>
    );
  }

  function groups(view: SearchView) {
    if (textOnly || !view.criteria.length) {
      return (
        <ResultGroup
          title={t("briefs.section.ranked")}
          help={
            view.criteria.length
              ? t("briefs.section.ranked.help")
              : t("briefs.section.ranked.noCriteria.help")
          }
          count={ranked.length}
        >
          {cards(ranked)}
        </ResultGroup>
      );
    }
    // "To present" is the one group open, and the only one shown when empty: the zero is a result.
    return (
      <>
        <ResultGroup
          title={t("briefs.section.present")}
          help={t("briefs.section.present.help")}
          count={buckets.present.length}
        >
          {buckets.present.length ? cards(buckets.present) : presentEmpty(view)}
        </ResultGroup>
        {buckets.deeper.length ? (
          <ResultGroup
            title={t("briefs.section.deeper")}
            help={t("briefs.section.deeper.help")}
            count={buckets.deeper.length}
            collapsible
            defaultOpen={false}
          >
            {cards(buckets.deeper)}
          </ResultGroup>
        ) : null}
        {buckets.setAside.length ? (
          <ResultGroup
            title={t("briefs.section.noFit")}
            help={t("briefs.section.noFit.help")}
            count={buckets.setAside.length}
            collapsible
            defaultOpen={false}
          >
            {cards(buckets.setAside, true)}
          </ResultGroup>
        ) : null}
        {buckets.unassessed.length ? (
          <ResultGroup
            title={t("briefs.section.unassessed")}
            help={t("briefs.section.unassessed.help")}
            count={buckets.unassessed.length}
            collapsible
            defaultOpen={false}
          >
            {cards(buckets.unassessed)}
          </ResultGroup>
        ) : null}
      </>
    );
  }

  return (
    <section className="space-y-8">
      <div className="sheet space-y-4 p-6">
        <div>
          <h2 className="font-display text-xl text-ink">{t("briefs.part.search")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("briefs.search.help", { max: FULL_POOL_MAX, limit: RETRIEVAL_LIMIT })}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {runButton}
          {canResume && current ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => void analyse(current, settledIds)}
              className="gap-1.5"
            >
              {t("briefs.search.resume")}
            </Button>
          ) : null}
          {canEdit && criteriaDirty ? (
            <span className="text-[13px] text-muted-foreground">
              {t("briefs.search.saveFirst")}
            </span>
          ) : null}
          {!canEdit ? (
            <span className="text-[13px] text-muted-foreground">{t("briefs.search.viewer")}</span>
          ) : null}
        </div>
        {progress ? (
          <AssessmentProgress
            stage={progress.stage}
            done={progress.done}
            total={progress.total}
            onStop={stop}
          />
        ) : null}
        {searches.data?.length ? (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
            <Label htmlFor="brief-previous-search">{t("briefs.search.previous")}</Label>
            <Select
              value={current?.id ?? ""}
              onValueChange={(value) => {
                if (value && value !== current?.id) void open(value);
              }}
              disabled={opening !== null || busy}
            >
              <SelectTrigger id="brief-previous-search" className="sm:w-96">
                <SelectValue placeholder={t("briefs.search.pick")} />
              </SelectTrigger>
              <SelectContent>
                {searches.data.map((search) => (
                  <SelectItem key={search.id} value={search.id}>
                    {`${formatDateTime(locale, search.created_at)} · ${countText(search.result_count)}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
      </div>

      {current ? (
        <>
          <p className="text-sm text-muted-foreground">{methodLine(current)}</p>
          {roleStale ? (
            <p className="text-sm text-muted-foreground">{t("briefs.search.line.roleStale")}</p>
          ) : null}
          {pendingCheck ? (
            <div className="sheet flex flex-col gap-3 p-6 sm:flex-row sm:items-center sm:justify-between">
              <p className="min-w-0 text-[15px] leading-6 text-ink">
                {t(
                  pendingCheck.wrote === "profile"
                    ? "briefs.search.check.profile"
                    : "briefs.search.check.criteria",
                )}
              </p>
              <Button
                type="button"
                variant="outline"
                onClick={() => void analyse(current, settledIds)}
                disabled={!canEdit || busy}
                className="shrink-0 gap-1.5"
              >
                <BookOpen />
                {t("briefs.search.check.read")}
              </Button>
            </div>
          ) : null}
          {ranked.length === 0 ? (
            <EmptyState
              icon={<SearchX />}
              title={t("briefs.search.none.title")}
              text={t("briefs.search.none.text")}
            />
          ) : candidatesPending ? (
            <ResultSkeleton />
          ) : (
            groups(current)
          )}
        </>
      ) : opening || (searches.loading && !searches.data) ? (
        <ResultSkeleton />
      ) : (
        <EmptyState
          icon={<Search />}
          title={t("briefs.search.empty.title")}
          text={t("briefs.search.empty.text")}
          action={runButton}
        />
      )}
    </section>
  );
}
