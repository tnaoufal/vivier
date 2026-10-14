/**
 * /app/briefs: the briefs of the organisation as a grid of cards,
 * newest change first, each card what tells a brief apart (the title,
 * its status, the domain of its role profile, how many criteria it
 * holds, what its newest analysis found, when it changed), a status
 * filter with counts, and the way to a new one. The cards rise in once;
 * the newest analyses arrive after the briefs and fill their line. Live
 * through realtime on briefs and searches.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { Briefcase, Plus, X } from "lucide-react";

import { EmptyState } from "@/components/app-shell/empty-state";
import { PageHeader } from "@/components/app-shell/page-header";
import { BriefStatusPill } from "@/components/briefs/brief-status-pill";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Segmented } from "@/components/ui/tabs";
import { requireSupabase } from "@/lib/auth/supabase-client";
import {
  BRIEF_FILTERS,
  briefSubtitle,
  countByFilter,
  filterBriefs,
  type BriefFilter,
} from "@/lib/briefs/presentation";
import { listBriefs, readLatestAnalyses, type LatestAnalysis } from "@/lib/briefs/queries";
import { debounce, subscribeToTable } from "@/lib/data/realtime";
import { useQuery } from "@/lib/data/use-query";
import { formatDate, useI18n } from "@/lib/i18n";
import { useCurrentOrg, useOrg } from "@/lib/org/org-context";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/app/briefs/")({
  component: BriefsPage,
});

const SKELETON_CARDS = 6;

function BriefsPage() {
  const { t, locale } = useI18n();
  const { org } = useCurrentOrg();
  const { can } = useOrg();
  const navigate = useNavigate();
  const canEdit = can("member");
  const [filter, setFilter] = useState<BriefFilter>("all");

  // Every brief of the organisation at once (200 at most): the filter and its counts are read in memory.
  const list = useQuery(`briefs:${org.id}`, async () =>
    listBriefs(await requireSupabase(), org.id, null),
  );
  const rows = useMemo(() => list.data ?? [], [list.data]);
  const shown = useMemo(() => filterBriefs(rows, filter), [rows, filter]);
  const counts = useMemo(() => countByFilter(rows), [rows]);
  const briefIds = useMemo(() => rows.map((row) => row.id), [rows]);
  const analyses = useQuery(
    `briefs-analyses:${org.id}:${briefIds.join(",")}`,
    async () => readLatestAnalyses(await requireSupabase(), org.id, briefIds),
    briefIds.length > 0,
  );

  const refresh = list.refresh;
  const refreshAnalyses = analyses.refresh;
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
  useEffect(
    () =>
      subscribeToTable(
        "searches",
        `org_id=eq.${org.id}`,
        debounce(() => {
          void refreshAnalyses();
        }, 800),
      ),
    [org.id, refreshAnalyses],
  );

  const countText =
    list.loading && !list.data
      ? t("common.loading")
      : rows.length === 0
        ? t("briefs.count.none")
        : rows.length === 1
          ? t("briefs.count.one")
          : t("briefs.count.many", { count: rows.length });

  const newButton = canEdit ? (
    <Button type="button" icon={<Plus />} onClick={() => void navigate({ to: "/app/briefs/new" })}>
      {t("briefs.new")}
    </Button>
  ) : null;

  function criteriaText(count: number): string {
    if (count === 0) return t("briefs.list.criteria.none");
    if (count === 1) return t("briefs.list.criteria.one");
    return t("briefs.list.criteria.many", { count });
  }

  /** What the newest analysis found: the profiles to present once the model read some, else how many it ranked; a placeholder while the analyses load. */
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
    if (analysis.assessed > 0) {
      const count = analysis.present;
      const text =
        count === 0
          ? t("briefs.search.line.present.none")
          : count === 1
            ? t("briefs.search.line.present.one")
            : t("briefs.search.line.present.many", { count });
      return <span className={cn(count > 0 && "font-medium text-ink")}>{text}</span>;
    }
    if (analysis.total === 0) return t("briefs.list.analysis.ranked.none");
    if (analysis.total === 1) return t("briefs.list.analysis.ranked.one");
    return t("briefs.list.analysis.ranked.many", { count: analysis.total });
  }

  const filterLabel = (value: BriefFilter) =>
    value === "all" ? t("common.all") : t(`briefs.status.${value}`);

  return (
    <div>
      <PageHeader
        eyebrow={t("nav.briefs")}
        title={t("briefs.title")}
        description={countText}
        // The empty state below carries the one filled button when there is no brief yet.
        actions={rows.length > 0 || (list.loading && !list.data) ? newButton : null}
      />

      {rows.length > 0 || (list.loading && !list.data) ? (
        <div className="mb-6">
          <Segmented
            value={filter}
            onChange={setFilter}
            aria-label={t("briefs.list.filter")}
            options={BRIEF_FILTERS.map((value) => ({
              value,
              label: filterLabel(value),
              count: list.data ? counts[value] : undefined,
            }))}
          />
        </div>
      ) : null}

      {list.error ? (
        <EmptyState
          title={t("briefs.listError")}
          action={
            <Button type="button" variant="outline" onClick={() => void refresh()}>
              {t("common.retry")}
            </Button>
          }
        />
      ) : list.loading && !list.data ? (
        <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3" aria-busy="true">
          {Array.from({ length: SKELETON_CARDS }, (_, index) => (
            <div key={index} className="sheet space-y-3 p-6">
              <div className="flex items-start justify-between gap-3">
                <Skeleton className="h-5 w-1/2" />
                <Skeleton className="h-5 w-14 rounded-full" />
              </div>
              <Skeleton className="h-3.5 w-2/3" />
              <Skeleton className="mt-6 h-3 w-full" />
            </div>
          ))}
        </div>
      ) : shown.length === 0 ? (
        filter !== "all" ? (
          <EmptyState
            icon={<Briefcase />}
            title={t("briefs.empty.filtered.title")}
            text={t("briefs.empty.filtered.text")}
            action={
              <Button type="button" variant="outline" icon={<X />} onClick={() => setFilter("all")}>
                {t("briefs.filters.clear")}
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={<Briefcase />}
            title={t("briefs.empty.title")}
            text={t("briefs.empty.text")}
            action={newButton}
          />
        )
      ) : (
        <ul className="stagger grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((row) => {
            const subtitle = briefSubtitle(row);
            return (
              <li key={row.id} className="rise-in min-w-0">
                <Link
                  to="/app/briefs/$briefId"
                  params={{ briefId: row.id }}
                  className="sheet sheet-link flex h-full min-w-0 flex-col p-6"
                >
                  <div className="flex items-start justify-between gap-3">
                    <h2 className="line-clamp-2 min-w-0 flex-1 text-base font-semibold text-ink break-words">
                      {row.title}
                    </h2>
                    <BriefStatusPill status={row.status} size="sm" />
                  </div>
                  <p className="mt-1.5 line-clamp-2 text-sm text-muted-foreground break-words">
                    {subtitle || t("briefs.list.noDescription")}
                  </p>
                  <div className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-1 pt-6 text-meta text-muted-foreground tabular-nums">
                    <span>{criteriaText(row.criteria.length)}</span>
                    <span aria-hidden="true">·</span>
                    <span>{analysisText(analyses.data?.get(row.id))}</span>
                    <span aria-hidden="true">·</span>
                    <span>
                      {t("briefs.list.updated", { date: formatDate(locale, row.updated_at) })}
                    </span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
