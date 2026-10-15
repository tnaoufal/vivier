/**
 * /app/briefs on the plane: one pane of rows, the briefs of the
 * organisation, newest change first, each row what tells a brief
 * apart: the title, its status when it is not simply open, what its
 * newest analysis found ("12 correspondances", "Analyse inachevée",
 * "Aucune analyse"), how many candidates its shortlist retained, the
 * last message of its thread (who, when) and when it changed; the
 * count in the header's meta, a filter (open, closed, all) beside it
 * only once a brief is closed (in the pane's header on a phone, where
 * the meta is hidden), and the one filled button, a new brief. A whole-pool analysis not through yet (profiles
 * its triage has not read, or kept profiles not read in full) says it
 * is unfinished rather than counting what it has not reached. The rows
 * rise in once; the analyses, the shortlists' counts and the threads
 * arrive after the briefs and fill their line. Live through realtime on
 * briefs, searches, shortlist items and comments: a batch of an
 * analysis updates its brief's line from the row the event carries, and
 * the triage's two counts of that search alone, never by reading every
 * analysis again.
 */
import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Briefcase, Plus, RefreshCw, TriangleAlert, X } from "lucide-react";

import { EmptyState } from "@/components/app-shell/empty-state";
import { Row, RowText } from "@/components/app-shell/row";
import { PHONE_ICON, Pane, Workspace } from "@/components/app-shell/workspace";
import { BriefStatusPill } from "@/components/briefs/brief-status-pill";
import { Button } from "@/components/ui/button";
import { SkeletonRows } from "@/components/ui/skeleton";
import { Segmented } from "@/components/ui/tabs";
import { briefPath } from "@/lib/activity/links";
import { requireSupabase } from "@/lib/auth/supabase-client";
import {
  analysisOfRow,
  cardAnalysisOf,
  filterBriefs,
  withAnalysis,
  withTriageProgress,
  type BriefFilter,
  type LatestAnalysis,
} from "@/lib/briefs/presentation";
import {
  listBriefs,
  readLatestAnalyses,
  readRetainedCounts,
  readTriageProgress,
} from "@/lib/briefs/queries";
import { formatCount } from "@/lib/candidates/format";
import { debounce, subscribeToTable } from "@/lib/data/realtime";
import { useQuery } from "@/lib/data/use-query";
import { formatDate, formatRelative, useI18n } from "@/lib/i18n";
import { useCurrentOrg, useOrg } from "@/lib/org/org-context";
import { useMemberNamer } from "@/lib/shortlists/use-members";
import { threadSummaries } from "@/lib/threads/queries";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/app/briefs/")({
  component: BriefsPage,
});

const SKELETON_ROWS = 6;

function BriefsPage() {
  const { t, locale } = useI18n();
  const { org } = useCurrentOrg();
  const { can } = useOrg();
  const navigate = useNavigate();
  const nameOf = useMemberNamer();
  const canEdit = can("member");
  const [filter, setFilter] = useState<BriefFilter>("open");

  // Every brief of the organisation at once (200 at most): the filter is read in memory.
  const list = useQuery(`briefs:${org.id}`, async () =>
    listBriefs(await requireSupabase(), org.id, null),
  );
  const rows = useMemo(() => list.data ?? [], [list.data]);
  // The filter exists once a brief is closed; before, every brief shows.
  const filterable = rows.some((row) => row.status === "closed");
  const shown = useMemo(
    () => filterBriefs(rows, filterable ? filter : "all"),
    [filter, filterable, rows],
  );
  const briefIds = useMemo(() => rows.map((row) => row.id), [rows]);
  const idsKey = briefIds.join(",");
  const analyses = useQuery(
    `briefs-analyses:${org.id}:${idsKey}`,
    async () => readLatestAnalyses(await requireSupabase(), org.id, briefIds),
    briefIds.length > 0,
  );
  const retained = useQuery(
    `briefs-retained:${org.id}:${idsKey}`,
    async () => readRetainedCounts(await requireSupabase(), org.id, briefIds),
    briefIds.length > 0,
  );
  const threads = useQuery(
    `briefs-threads:${org.id}:${idsKey}`,
    async () => threadSummaries(await requireSupabase(), org.id, briefIds),
    briefIds.length > 0,
  );
  // The analyses as read, then kept current by the realtime rows themselves; a new read replaces them.
  const [latest, setLatest] = useState<ReadonlyMap<string, LatestAnalysis> | null>(null);
  useEffect(() => {
    setLatest(analyses.data);
  }, [analyses.data]);
  const shownAnalyses = latest ?? analyses.data;

  const refresh = list.refresh;
  const refreshAnalyses = analyses.refresh;
  const refreshRetained = retained.refresh;
  const refreshThreads = threads.refresh;
  useEffect(
    () =>
      subscribeToTable(
        "briefs",
        `org_id=eq.${org.id}`,
        debounce(() => {
          void refresh();
        }, 400),
      ),
    [org.id, refresh],
  );
  useEffect(() => {
    const readAgain = debounce(() => {
      void refreshAnalyses();
    }, 800);
    // Where a whole-pool search's triage stands travels in no row: read
    // again for that search alone (two counts) once its batches settle.
    const progress = new Map<string, () => void>();
    const readProgress = (briefId: string, searchId: string) => {
      let read = progress.get(searchId);
      if (!read) {
        read = debounce(() => {
          void (async () => {
            try {
              const counts = await readTriageProgress(await requireSupabase(), org.id, searchId);
              setLatest((current) =>
                current ? withTriageProgress(current, briefId, searchId, counts) : current,
              );
            } catch (error) {
              console.error(error);
            }
          })();
        }, 1500);
        progress.set(searchId, read);
      }
      read();
    };
    // A search written or patched (an analysis stores its results batch after batch) updates its brief's line from the row itself; a deleted one, or a row realtime could not carry whole, reads the analyses again.
    return subscribeToTable("searches", `org_id=eq.${org.id}`, (change) => {
      const changed = change.eventType === "DELETE" ? null : analysisOfRow(change.new);
      if (!changed) {
        readAgain();
        return;
      }
      setLatest((current) =>
        current ? withAnalysis(current, changed.briefId, changed.analysis) : current,
      );
      if (changed.analysis.method === "triage")
        readProgress(changed.briefId, changed.analysis.searchId);
    });
  }, [org.id, refreshAnalyses]);
  // A decision on a shortlist, a message in a thread: the row's line follows.
  useEffect(() => {
    const stopItems = subscribeToTable(
      "shortlist_items",
      `org_id=eq.${org.id}`,
      debounce(() => {
        void refreshRetained();
      }, 800),
    );
    const stopComments = subscribeToTable(
      "comments",
      `org_id=eq.${org.id}`,
      debounce(() => {
        void refreshThreads();
      }, 800),
    );
    return () => {
      stopItems();
      stopComments();
    };
  }, [org.id, refreshRetained, refreshThreads]);

  // No count without a brief: the empty state already says there is none.
  const countText =
    list.loading && !list.data
      ? t("common.loading")
      : rows.length === 0
        ? null
        : rows.length === 1
          ? t("briefs.count.one")
          : t("briefs.count.many", { count: formatCount(locale, rows.length) });

  /** The new brief: in the header it shrinks to its icon on a phone, in the empty state it keeps its word. */
  const newButton = (inHeader: boolean) =>
    canEdit ? (
      <Button
        type="button"
        icon={<Plus />}
        onClick={() => void navigate({ to: "/app/briefs/new" })}
        aria-label={inHeader ? t("briefs.new") : undefined}
        className={inHeader ? PHONE_ICON : undefined}
      >
        <span className={inHeader ? "max-sm:sr-only" : undefined}>{t("briefs.new")}</span>
      </Button>
    ) : null;

  /** The filter, once a brief is closed: in the header's meta from `sm`, in the pane's header below. */
  const filterControl = (
    <Segmented
      size="sm"
      value={filter}
      onChange={setFilter}
      aria-label={t("briefs.list.filter")}
      options={[
        { value: "open", label: t("briefs.filter.open") },
        { value: "closed", label: t("briefs.filter.closed") },
        { value: "all", label: t("common.all") },
      ]}
    />
  );

  /** What the newest analysis found: its matches once read through, "unfinished" before, how many it ranked without a model; a placeholder while the analyses load. */
  function analysisText(analysis: LatestAnalysis | undefined): ReactNode {
    if (!analysis) {
      if (analyses.loading && !analyses.data)
        return (
          <span
            aria-hidden="true"
            className="skeleton inline-block h-3 w-24 rounded-sm align-middle"
          />
        );
      return t("briefs.list.analysis.none");
    }
    const card = cardAnalysisOf(analysis);
    if (card.kind === "unfinished") return t("briefs.analysis.left.none");
    if (card.kind === "matches") {
      const count = card.count;
      const text =
        count === 0
          ? t("briefs.search.line.present.none")
          : count === 1
            ? t("briefs.search.line.present.one")
            : t("briefs.search.line.present.many", { count: formatCount(locale, count) });
      return <span className={cn(count > 0 && "font-medium text-ink")}>{text}</span>;
    }
    if (card.count === 0) return t("briefs.analysis.ranked.none");
    if (card.count === 1) return t("briefs.analysis.ranked.one");
    return t("briefs.analysis.ranked.many", { count: formatCount(locale, card.count) });
  }

  const loading = list.loading && !list.data;

  return (
    <Workspace
      title={t("briefs.title")}
      meta={
        <>
          {countText ? <span className="font-medium tabular-nums">{countText}</span> : null}
          {filterable ? filterControl : null}
        </>
      }
      // The empty state below carries the one filled button when there is no brief yet.
      actions={rows.length > 0 || loading ? newButton(true) : null}
    >
      <Pane
        label={t("briefs.title")}
        width="fill"
        header={filterable ? <div className="px-4 py-2 sm:hidden">{filterControl}</div> : undefined}
      >
        {list.error ? (
          <EmptyState
            quiet
            icon={<TriangleAlert />}
            title={t("briefs.listError")}
            action={
              <Button
                type="button"
                variant="outline"
                icon={<RefreshCw />}
                onClick={() => void refresh()}
              >
                {t("common.retry")}
              </Button>
            }
          />
        ) : loading ? (
          <SkeletonRows rows={SKELETON_ROWS} avatar={false} />
        ) : shown.length === 0 ? (
          filterable ? (
            <EmptyState
              quiet
              icon={<Briefcase />}
              title={t("briefs.empty.filtered.title")}
              action={
                <Button
                  type="button"
                  variant="outline"
                  icon={<X />}
                  onClick={() => setFilter("all")}
                >
                  {t("briefs.filters.clear")}
                </Button>
              }
            />
          ) : (
            <EmptyState
              quiet
              icon={<Briefcase />}
              title={t("briefs.empty.title")}
              action={newButton(false)}
            />
          )
        ) : (
          <ol className="stagger">
            {shown.map((row) => {
              const retainedCount = retained.data?.get(row.id) ?? 0;
              const thread = threads.data?.get(row.id);
              return (
                <Fragment key={row.id}>
                  <Row as="link" to={briefPath(row.id)} height="lg" className="rise-in">
                    <RowText
                      title={
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="truncate">{row.title}</span>
                          {/* Open is the rule: only another state sets a row apart. */}
                          {row.status !== "open" ? (
                            <BriefStatusPill status={row.status} size="sm" />
                          ) : null}
                        </span>
                      }
                      line={
                        <>
                          {analysisText(shownAnalyses?.get(row.id))}
                          {retainedCount > 0 ? (
                            <>
                              <span aria-hidden="true"> · </span>
                              {retainedCount === 1
                                ? t("briefs.list.retained.one")
                                : t("briefs.list.retained.many", {
                                    count: formatCount(locale, retainedCount),
                                  })}
                            </>
                          ) : null}
                          {thread ? (
                            <>
                              <span aria-hidden="true"> · </span>
                              {nameOf(thread.lastAuthorId)}
                              <span aria-hidden="true"> · </span>
                              <time dateTime={thread.lastAt}>
                                {formatRelative(locale, thread.lastAt)}
                              </time>
                            </>
                          ) : null}
                        </>
                      }
                    />
                    <time
                      dateTime={row.updated_at}
                      className="hidden shrink-0 text-meta text-muted-foreground tabular-nums sm:block"
                    >
                      {formatDate(locale, row.updated_at)}
                    </time>
                  </Row>
                </Fragment>
              );
            })}
          </ol>
        )}
      </Pane>
    </Workspace>
  );
}
