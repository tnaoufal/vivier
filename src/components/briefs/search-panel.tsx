/**
 * The analysis of the talent pool for a brief. One button runs the
 * search (the whole pool or the hybrid retrieval, then the deterministic
 * verdicts, stored as a searches row) and, when the deployment has a
 * model, drives the expert assessment of every result a few candidates
 * at a time, one batch after the other, updating the cards as batches
 * return; the loop stops when the person interrupts it or leaves the
 * page, and a stored analysis with unassessed results can be resumed.
 * Results sit in groups by decision: matching, to check, set aside
 * (collapsed), not analysed. A result whose candidate left the pool
 * since the search counts as settled: it is never sent again and does
 * not keep an analysis from being complete. Without a model, or without
 * criteria to check, the panel says so and shows the deterministic
 * ranking alone; when the pool was larger than what one search reads,
 * the line under the results says how many profiles were looked at.
 * Previous analyses reopen from their stored results, assessments
 * included.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Search, SearchX } from "lucide-react";

import { EmptyState } from "@/components/app-shell/empty-state";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/lib/auth/auth-context";
import { requireSupabase } from "@/lib/auth/supabase-client";
import { ASSESS_BATCH_MAX, bucketResults, mostMissingRequirement } from "@/lib/briefs/assessment";
import { assessCandidates, runSearch, type AssessmentBatch } from "@/lib/briefs/briefs.functions";
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
  /** Results already looked at in this run (assessed or failed) plus those stored before it. */
  done: number;
  total: number;
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
  // The run token: each assessment loop owns one; interrupting, starting
  // another, or leaving the page changes it and the loop stops at its next batch.
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
    async () => ({ searchId: current?.id ?? null, rows: await readResultCandidates(await requireSupabase(), brief.org_id, ids) }),
    ids.length > 0,
  );
  const rows = candidates.data !== null && candidates.data.searchId === current?.id ? candidates.data.rows : null;
  const byId = useMemo(() => new Map((rows ?? []).map((candidate) => [candidate.id, candidate] as const)), [rows]);
  // A result whose candidate left the pool since the search (erased, or
  // archived: the assessment reads active profiles only) is settled: it is
  // never sent again and does not keep the analysis from being complete.
  // Nothing is settled until the candidates are known.
  const settledIds = useMemo(
    () =>
      new Set(
        rows === null
          ? []
          : ranked.filter((result) => byId.get(result.candidateId)?.status !== "active").map((result) => result.candidateId),
      ),
    [byId, ranked, rows],
  );
  const shortlistId = shortlist.data?.shortlistId ?? null;
  const addedIds = useMemo(() => new Set(shortlist.data?.candidateIds ?? []), [shortlist.data]);

  const open = useCallback(
    async (searchId: string) => {
      setOpening(searchId);
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
      if (change.eventType === "UPDATE" && change.new["id"] === currentRef.current?.id) reopenCurrent();
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
   * Assesses every result of `view` not yet assessed and not in `skip`
   * (the candidates gone from the pool), ASSESS_BATCH_MAX at a time, one
   * batch after the other.
   */
  const assess = useCallback(
    async (view: SearchView, skip: ReadonlySet<string>) => {
      const token = ++runToken.current;
      const pending = view.results
        .filter((result) => !result.assessment && !skip.has(result.candidateId))
        .map((result) => result.candidateId);
      const total = view.results.length;
      let done = total - pending.length;
      let failures = 0;
      setProgress({ done, total });
      try {
        for (let index = 0; index < pending.length; index += ASSESS_BATCH_MAX) {
          if (runToken.current !== token) return;
          const batch = pending.slice(index, index + ASSESS_BATCH_MAX);
          let answer: AssessmentBatch;
          try {
            answer = await assessCandidates({
              data: { ...(await withToken()), orgId: brief.org_id, briefId: brief.id, searchId: view.id, candidateIds: batch },
            });
          } catch (error) {
            console.error(error);
            toast.error(errorMessage(locale, error));
            return;
          }
          // What came back is stored whatever happened here since: merge it, then obey the token.
          const updated = new Map(answer.results.map((result) => [result.candidateId, result] as const));
          setCurrent((previous) =>
            previous && previous.id === view.id
              ? { ...previous, results: previous.results.map((result) => updated.get(result.candidateId) ?? result) }
              : previous,
          );
          if (runToken.current !== token) return;
          failures += answer.failed.length;
          done += batch.length;
          setProgress({ done, total });
        }
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
      const answer = await runSearch({ data: { ...(await withToken()), orgId: brief.org_id, briefId: brief.id } });
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
      if (answer.criteriaDerived) toast(t("briefs.search.derived"));
      // No criteria: nothing to check, so no model reads the profiles (the ranked group says so).
      if (modelAvailable !== false && view.results.length && view.criteria.length) void assess(view, new Set<string>());
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
        shortlistId ?? (await ensureShortlist(supabase, { orgId: brief.org_id, briefId: brief.id, userId: user.id }));
      const outcome = await addShortlistItem(supabase, {
        orgId: brief.org_id,
        shortlistId: id,
        candidateId: result.candidateId,
        match,
        userId: user.id,
      });
      await refreshShortlist();
      toast.success(outcome === "added" ? t("briefs.results.addedToast") : t("briefs.results.alreadyAdded"));
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

  function assessedText(count: number): string {
    if (count === 0) return t("briefs.search.line.assessed.none");
    if (count === 1) return t("briefs.search.line.assessed.one");
    return t("briefs.search.line.assessed.many", { count });
  }

  function fitText(count: number): string {
    if (count === 0) return t("briefs.search.line.fit.none");
    if (count === 1) return t("briefs.search.line.fit.one");
    return t("briefs.search.line.fit.many", { count });
  }

  const textOnly = modelAvailable === false;
  /** No requirement to check: the ranking on the text is all there is, as without a model. */
  const noCriteria = current !== null && current.criteria.length === 0;
  const busy = running || progress !== null;
  const unassessedCount = buckets.unassessed.length;
  /** The unassessed results the model can still read: a candidate gone from the pool is not one. */
  const pendingCount = buckets.unassessed.filter((result) => !settledIds.has(result.candidateId)).length;
  const assessedCount = ranked.length - unassessedCount;
  const complete = ranked.length > 0 && pendingCount === 0;
  const canResume = canEdit && !textOnly && !noCriteria && current !== null && pendingCount > 0 && !busy;

  const runButton = canEdit ? (
    <Button type="button" onClick={() => void run()} disabled={busy || criteriaDirty} className="gap-1.5">
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
      parts.push(t("briefs.search.line.model"), assessedText(assessedCount));
      if (assessedCount > 0) parts.push(fitText(buckets.fit.length));
      if (pendingCount > 0 && !progress) parts.push(t("briefs.search.line.pending", { count: pendingCount }));
    }
    // A pool larger than what one search reads whole: only the closest profiles were looked at, and the line says so.
    if (view.poolSize !== null && view.poolSize > FULL_POOL_MAX) {
      parts.push(t("briefs.search.line.truncated", { total: view.poolSize, read: view.results.length }));
    }
    parts.push(t("briefs.search.ranAt", { date: formatDateTime(locale, view.createdAt) }));
    return parts.join(" · ");
  }

  function noFitText(view: SearchView): string {
    const parts = [t("briefs.search.nofit.text", { count: assessedCount })];
    const missing = mostMissingRequirement(view.criteria, ranked);
    if (missing) parts.push(t("briefs.search.nofit.missing", { label: missing.label }));
    parts.push(t("briefs.search.nofit.hint"));
    return parts.join(" ");
  }

  function groups(view: SearchView) {
    if (textOnly || !view.criteria.length) {
      return (
        <ResultGroup
          title={t("briefs.section.ranked")}
          help={view.criteria.length ? t("briefs.section.ranked.help") : t("briefs.section.ranked.noCriteria.help")}
          count={ranked.length}
        >
          {cards(ranked)}
        </ResultGroup>
      );
    }
    const nothingFits = complete && assessedCount > 0 && buckets.fit.length === 0 && buckets.borderline.length === 0;
    return (
      <>
        {nothingFits ? <EmptyState icon={<SearchX />} title={t("briefs.search.nofit.title")} text={noFitText(view)} /> : null}
        {buckets.fit.length ? (
          <ResultGroup title={t("briefs.section.fit")} help={t("briefs.section.fit.help")} count={buckets.fit.length}>
            {cards(buckets.fit)}
          </ResultGroup>
        ) : null}
        {buckets.borderline.length ? (
          <ResultGroup title={t("briefs.section.borderline")} help={t("briefs.section.borderline.help")} count={buckets.borderline.length}>
            {cards(buckets.borderline)}
          </ResultGroup>
        ) : null}
        {buckets.noFit.length ? (
          <ResultGroup
            title={t("briefs.section.noFit")}
            help={t("briefs.section.noFit.help")}
            count={buckets.noFit.length}
            collapsible
            defaultOpen={false}
          >
            {cards(buckets.noFit, true)}
          </ResultGroup>
        ) : null}
        {buckets.unassessed.length ? (
          <ResultGroup
            title={t("briefs.section.unassessed")}
            help={t("briefs.section.unassessed.help")}
            count={buckets.unassessed.length}
            collapsible
            defaultOpen={buckets.fit.length + buckets.borderline.length === 0}
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
            <Button type="button" variant="outline" onClick={() => void assess(current, settledIds)} className="gap-1.5">
              {t("briefs.search.resume")}
            </Button>
          ) : null}
          {canEdit && criteriaDirty ? <span className="text-[13px] text-muted-foreground">{t("briefs.search.saveFirst")}</span> : null}
          {!canEdit ? <span className="text-[13px] text-muted-foreground">{t("briefs.search.viewer")}</span> : null}
        </div>
        {progress ? <AssessmentProgress done={progress.done} total={progress.total} onStop={stop} /> : null}
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
          {ranked.length === 0 ? (
            <EmptyState icon={<SearchX />} title={t("briefs.search.none.title")} text={t("briefs.search.none.text")} />
          ) : candidatesPending ? (
            <ResultSkeleton />
          ) : (
            groups(current)
          )}
        </>
      ) : opening || (searches.loading && !searches.data) ? (
        <ResultSkeleton />
      ) : (
        <EmptyState icon={<Search />} title={t("briefs.search.empty.title")} text={t("briefs.search.empty.text")} action={runButton} />
      )}
    </section>
  );
}
