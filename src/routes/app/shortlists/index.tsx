/**
 * /app/shortlists: the organisation's shortlists, one per brief, newest
 * change first. Each row is the link to its board and shows what tells
 * shortlists apart: the brief's title and status, the three counts (to
 * review, retained, dismissed) as small pills, the people assigned on
 * it and when it last moved. A filter on the brief's state appears only
 * once a brief is closed, so it never takes room it does not earn. Live
 * through realtime on shortlists and shortlist_items of the organisation.
 */
import { useEffect, useMemo, useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { ListChecks, X } from "lucide-react";

import { Avatar } from "@/components/app-shell/avatar";
import { EmptyState } from "@/components/app-shell/empty-state";
import { PageHeader } from "@/components/app-shell/page-header";
import { Pill, type PillTone } from "@/components/app-shell/pill";
import { Button } from "@/components/ui/button";
import { SkeletonRows } from "@/components/ui/skeleton";
import { Segmented } from "@/components/ui/tabs";
import { BRIEFS_PATH } from "@/lib/activity/links";
import { requireSupabase } from "@/lib/auth/supabase-client";
import { debounce, subscribeToTable } from "@/lib/data/realtime";
import { useQuery } from "@/lib/data/use-query";
import type { BriefStatus, ShortlistItemStatus } from "@/lib/db/types";
import { formatDateTime, formatRelative, useI18n } from "@/lib/i18n";
import { useCurrentOrg } from "@/lib/org/org-context";
import { listItemSummaries, listShortlists, type ShortlistListRow } from "@/lib/shortlists/queries";
import {
  ITEM_STATUSES,
  NO_COUNTS,
  SHORTLIST_FILTERS,
  assigneesByShortlist,
  countByShortlist,
  filterUseful,
  matchesFilter,
  totalOf,
  type ShortlistFilter,
  type StatusCounts,
} from "@/lib/shortlists/tally";
import { useMemberNamer } from "@/lib/shortlists/use-members";

export const Route = createFileRoute("/app/shortlists/")({
  component: ShortlistsPage,
});

interface ListData {
  rows: ShortlistListRow[];
  counts: Map<string, StatusCounts>;
  assignees: Map<string, string[]>;
}

const BRIEF_TONES: Record<BriefStatus, PillTone> = { draft: "neutral", open: "positive", closed: "neutral" };
const COUNT_TONES: Record<ShortlistItemStatus, PillTone> = {
  to_review: "primary",
  retained: "positive",
  dismissed: "negative",
};

const MAX_AVATARS = 4;

function ShortlistsPage() {
  const { t } = useI18n();
  const { org } = useCurrentOrg();
  const [filter, setFilter] = useState<ShortlistFilter>("all");

  const list = useQuery<ListData>(`shortlists:${org.id}`, async () => {
    const supabase = await requireSupabase();
    const [rows, summaries] = await Promise.all([
      listShortlists(supabase, org.id),
      listItemSummaries(supabase, org.id),
    ]);
    return { rows, counts: countByShortlist(summaries), assignees: assigneesByShortlist(summaries) };
  });

  const refresh = list.refresh;
  useEffect(() => {
    const soon = debounce(() => void refresh(), 400);
    const stops = [
      subscribeToTable("shortlists", `org_id=eq.${org.id}`, soon),
      subscribeToTable("shortlist_items", `org_id=eq.${org.id}`, soon),
    ];
    return () => {
      for (const stop of stops) stop();
    };
  }, [org.id, refresh]);

  const rows = useMemo(() => list.data?.rows ?? [], [list.data]);
  const statuses = useMemo(() => rows.map((row) => row.briefs?.status ?? null), [rows]);
  const showFilter = filterUseful(statuses);
  const shown = useMemo(
    () => (showFilter ? rows.filter((row) => matchesFilter(row.briefs?.status, filter)) : rows),
    [filter, rows, showFilter],
  );
  const countOf = (which: ShortlistFilter) => statuses.filter((status) => matchesFilter(status, which)).length;

  const countText =
    list.loading && !list.data
      ? t("common.loading")
      : rows.length === 0
        ? t("shortlists.count.none")
        : rows.length === 1
          ? t("shortlists.count.one")
          : t("shortlists.count.many", { count: rows.length });

  return (
    <div>
      <PageHeader
        eyebrow={t("nav.shortlists")}
        title={t("shortlists.title")}
        description={`${t("shortlists.subtitle")} ${countText}`}
      />

      {showFilter ? (
        <div className="mb-6">
          <Segmented
            value={filter}
            onChange={setFilter}
            aria-label={t("shortlists.filter.label")}
            options={SHORTLIST_FILTERS.map((which) => ({
              value: which,
              label: t(`shortlists.filter.${which}`),
              count: countOf(which),
            }))}
          />
        </div>
      ) : null}

      {list.error ? (
        <EmptyState
          title={t("shortlists.listError")}
          action={
            <Button type="button" variant="outline" onClick={() => void refresh()}>
              {t("common.retry")}
            </Button>
          }
        />
      ) : list.loading && !list.data ? (
        <div className="sheet overflow-hidden">
          <SkeletonRows rows={3} avatar={false} />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<ListChecks />}
          title={t("shortlists.empty.title")}
          text={t("shortlists.empty.text")}
          action={
            <Button asChild variant="outline">
              <Link to={BRIEFS_PATH}>{t("shortlists.empty.action")}</Link>
            </Button>
          }
        />
      ) : shown.length === 0 ? (
        <EmptyState
          icon={<ListChecks />}
          title={t("shortlists.filtered.empty")}
          action={
            <Button type="button" variant="outline" icon={<X />} onClick={() => setFilter("all")}>
              {t("shortlists.filter.clear")}
            </Button>
          }
        />
      ) : (
        <ol className="sheet stagger divide-y divide-border overflow-hidden">
          {shown.map((row) => (
            <li key={row.id} className="rise-in">
              <ShortlistLine
                row={row}
                counts={list.data?.counts.get(row.id) ?? NO_COUNTS}
                assignees={list.data?.assignees.get(row.id) ?? []}
              />
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** A count as a small pill in its tone; a zero reads neutral so the eye lands on the real numbers. */
function CountPill({ status, count }: { status: ShortlistItemStatus; count: number }) {
  const { t } = useI18n();
  return (
    <Pill tone={count === 0 ? "neutral" : COUNT_TONES[status]} dot size="sm">
      {t(`shortlists.pill.${status}`, { count })}
    </Pill>
  );
}

/** One row, the whole of it a link to the board. */
function ShortlistLine({
  row,
  counts,
  assignees,
}: {
  row: ShortlistListRow;
  counts: StatusCounts;
  assignees: string[];
}) {
  const { t, locale } = useI18n();
  const nameOf = useMemberNamer();
  const brief = row.briefs;
  const total = totalOf(counts);
  const profilesText =
    total === 0
      ? t("shortlists.profiles.none")
      : total === 1
        ? t("shortlists.profiles.one")
        : t("shortlists.profiles.many", { count: total });
  const assignedText =
    assignees.length === 0
      ? t("shortlists.members.none")
      : assignees.length === 1
        ? t("shortlists.members.one")
        : t("shortlists.members.many", { count: assignees.length });
  const countsText = t("shortlists.counts.line", {
    to_review: counts.to_review,
    retained: counts.retained,
    dismissed: counts.dismissed,
  });
  return (
    <Link
      to="/app/shortlists/$shortlistId"
      params={{ shortlistId: row.id }}
      className="sheet-row flex-wrap gap-x-6 gap-y-3 lg:flex-nowrap"
      aria-label={`${t("shortlists.open")} · ${brief ? brief.title : t("shortlists.noBrief")}`}
    >
      <div className="min-w-0 flex-1 basis-full lg:basis-auto">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="min-w-0 truncate text-base font-semibold text-ink">
            {brief ? brief.title : t("shortlists.noBrief")}
          </span>
          {brief ? (
            <Pill tone={BRIEF_TONES[brief.status]} dot size="sm">
              {t(`shortlists.brief.status.${brief.status}`)}
            </Pill>
          ) : null}
        </div>
        <p className="mt-0.5 text-meta text-muted-foreground" title={formatDateTime(locale, row.updated_at)}>
          {t("shortlists.updated", { when: formatRelative(locale, row.updated_at) })} · {profilesText}
        </p>
      </div>
      <ul className="flex flex-wrap items-center gap-1.5" aria-label={countsText}>
        {ITEM_STATUSES.map((status) => (
          <li key={status}>
            <CountPill status={status} count={counts[status]} />
          </li>
        ))}
      </ul>
      <div
        className="flex items-center gap-2 lg:w-32 lg:justify-end"
        title={assignedText}
        aria-label={assignedText}
      >
        {assignees.length ? (
          <ul className="flex -space-x-1.5">
            {assignees.slice(0, MAX_AVATARS).map((userId) => (
              <li key={userId}>
                <Avatar name={nameOf(userId)} size="sm" className="ring-2 ring-card" />
              </li>
            ))}
          </ul>
        ) : (
          <span className="text-meta text-muted-foreground">{t("shortlists.members.none")}</span>
        )}
        {assignees.length > MAX_AVATARS ? (
          <span className="text-meta text-muted-foreground tabular-nums">+{assignees.length - MAX_AVATARS}</span>
        ) : null}
      </div>
    </Link>
  );
}
