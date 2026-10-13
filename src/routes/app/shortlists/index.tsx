/**
 * /app/shortlists: the organisation's shortlists, one per brief, newest
 * change first, each with its counts (to review, retained, dismissed),
 * the people assigned on it and the way in. Live through realtime on
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
      <PageHeader title={t("shortlists.title")} description={`${t("shortlists.subtitle")} ${countText}`} />

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
        <div className="sheet divide-y divide-border" aria-busy="true">
          {[0, 1, 2].map((index) => (
            <div key={index} className="space-y-2 px-4 py-3">
              <div className="skeleton h-4 w-1/3 rounded" />
              <div className="skeleton h-3 w-2/3 rounded" />
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
        <ul className="sheet overflow-hidden">
          {rows.map((row) => (
            <ShortlistLine
              key={row.id}
              row={row}
              counts={list.data?.counts.get(row.id) ?? NO_COUNTS}
              assignees={list.data?.assignees.get(row.id) ?? []}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

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
  return (
    <li className="border-b border-border last:border-b-0">
      <Link
        to="/app/shortlists/$shortlistId"
        params={{ shortlistId: row.id }}
        className="flex flex-col gap-2 px-4 py-3 transition-colors hover:bg-accent/40 focus-visible:bg-accent/40 focus-visible:outline-none sm:flex-row sm:items-center sm:gap-4"
        aria-label={t("shortlists.open")}
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="truncate font-medium text-ink">{brief ? brief.title : t("shortlists.noBrief")}</span>
            {brief ? <Pill tone={BRIEF_TONES[brief.status]}>{t(`shortlists.brief.status.${brief.status}`)}</Pill> : null}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t("shortlists.counts.line", {
              to_review: counts.to_review,
              retained: counts.retained,
              dismissed: counts.dismissed,
            })}
            {" · "}
            {t("shortlists.updated", { when: formatRelative(locale, row.updated_at) })}
          </p>
        </div>
        <div className="flex items-center gap-1.5" title={assignedText} aria-label={assignedText}>
          {assignees.slice(0, MAX_AVATARS).map((userId) => (
            <Avatar key={userId} name={nameOf(userId)} size="sm" />
          ))}
          {assignees.length > MAX_AVATARS ? (
            <span className="text-xs text-muted-foreground">+{assignees.length - MAX_AVATARS}</span>
          ) : null}
          {assignees.length === 0 ? <span className="text-xs text-muted-foreground">{assignedText}</span> : null}
        </div>
      </Link>
    </li>
  );
}
