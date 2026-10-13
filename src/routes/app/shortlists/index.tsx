/**
 * /app/shortlists: the organisation's shortlists, one per brief, newest
 * change first, each a row with the brief's title and status, three
 * small pills for the counts (to review, retained, dismissed), the
 * people assigned on it and the way in. Live through realtime on
 * shortlists and shortlist_items of the organisation.
 */
import { useEffect } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { ListChecks } from "lucide-react";

import { Avatar } from "@/components/app-shell/avatar";
import { EmptyState } from "@/components/app-shell/empty-state";
import { PageHeader } from "@/components/app-shell/page-header";
import { Pill, type PillTone } from "@/components/app-shell/pill";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { BRIEFS_PATH } from "@/lib/activity/links";
import { requireSupabase } from "@/lib/auth/supabase-client";
import { debounce, subscribeToTable } from "@/lib/data/realtime";
import { useQuery } from "@/lib/data/use-query";
import type { BriefStatus } from "@/lib/db/types";
import { formatRelative, useI18n } from "@/lib/i18n";
import { useCurrentOrg } from "@/lib/org/org-context";
import { listItemSummaries, listShortlists, type ShortlistListRow } from "@/lib/shortlists/queries";
import {
  NO_COUNTS,
  assigneesByShortlist,
  countByShortlist,
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

const MAX_AVATARS = 5;
const SKELETON_ROWS = 3;

function ShortlistsPage() {
  const { t } = useI18n();
  const { org } = useCurrentOrg();

  const list = useQuery<ListData>(`shortlists:${org.id}`, async () => {
    const supabase = await requireSupabase();
    const [rows, summaries] = await Promise.all([listShortlists(supabase, org.id), listItemSummaries(supabase, org.id)]);
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

  const rows = list.data?.rows ?? [];
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
      <PageHeader eyebrow={t("nav.shortlists")} title={t("shortlists.title")} description={`${t("shortlists.subtitle")} ${countText}`} />

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
        <div className="sheet overflow-hidden" aria-busy="true">
          {Array.from({ length: SKELETON_ROWS }, (_, index) => (
            <div key={index} className="sheet-row">
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="h-3 w-1/4" />
              </div>
              <Skeleton className="h-6 w-40 rounded-full" />
            </div>
          ))}
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
      ) : (
        <ol className="sheet divide-y divide-border overflow-hidden">
          {rows.map((row) => (
            <li key={row.id}>
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

/** One row, the whole of it a link to the board. */
function ShortlistLine({ row, counts, assignees }: { row: ShortlistListRow; counts: StatusCounts; assignees: string[] }) {
  const { t, locale } = useI18n();
  const nameOf = useMemberNamer();
  const brief = row.briefs;
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
      aria-label={t("shortlists.open")}
    >
      <div className="min-w-0 flex-1 basis-full lg:basis-auto">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="min-w-0 truncate text-[15px] font-semibold leading-6 text-ink">
            {brief ? brief.title : t("shortlists.noBrief")}
          </span>
          {brief ? (
            <Pill tone={BRIEF_TONES[brief.status]} dot>
              {t(`shortlists.brief.status.${brief.status}`)}
            </Pill>
          ) : null}
        </div>
        <p className="mt-0.5 text-[13px] leading-5 text-muted-foreground">
          {t("shortlists.updated", { when: formatRelative(locale, row.updated_at) })}
        </p>
      </div>
      <ul className="flex flex-wrap items-center gap-1.5" aria-label={countsText}>
        <li>
          <Pill tone="primary" dot>
            {t("shortlists.pill.to_review", { count: counts.to_review })}
          </Pill>
        </li>
        <li>
          <Pill tone="positive" dot>
            {t("shortlists.pill.retained", { count: counts.retained })}
          </Pill>
        </li>
        <li>
          <Pill tone="negative" dot>
            {t("shortlists.pill.dismissed", { count: counts.dismissed })}
          </Pill>
        </li>
      </ul>
      <div className="flex items-center gap-2 lg:w-40 lg:justify-end" title={assignedText} aria-label={assignedText}>
        {assignees.length ? (
          <ul className="flex -space-x-1.5">
            {assignees.slice(0, MAX_AVATARS).map((userId) => (
              <li key={userId}>
                <Avatar name={nameOf(userId)} size="sm" className="ring-2 ring-card" />
              </li>
            ))}
          </ul>
        ) : (
          <span className="text-[13px] leading-5 text-muted-foreground">{assignedText}</span>
        )}
        {assignees.length > MAX_AVATARS ? (
          <span className="text-[13px] leading-5 text-muted-foreground tabular-nums">+{assignees.length - MAX_AVATARS}</span>
        ) : null}
      </div>
    </Link>
  );
}
