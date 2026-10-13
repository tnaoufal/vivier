/**
 * The activity feed as a list of sentences: who did what, when, with a
 * link to the brief or the candidate when the row points at one. Shared
 * by the dashboard (last fifteen) and the activity page (paged).
 */
import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Settings } from "lucide-react";

import { Avatar } from "@/components/app-shell/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { describeActivity, type ActivityNames } from "@/lib/activity/describe";
import { briefPath, candidatePath } from "@/lib/activity/links";
import type { ActivityRow } from "@/lib/db/types";
import { formatDateTime, formatRelative, useI18n } from "@/lib/i18n";

export function ActivityList({
  rows,
  names,
  loading,
  emptyState,
}: {
  rows: ActivityRow[];
  names: ActivityNames;
  loading: boolean;
  /** Shown when there is nothing to list (an EmptyState). */
  emptyState: ReactNode;
}) {
  if (loading && rows.length === 0) {
    return (
      <div className="sheet divide-y divide-border" aria-busy="true">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex items-start gap-3 px-4 py-3">
            <Skeleton className="size-6 rounded-full" />
            <div className="flex-1 space-y-2 py-0.5">
              <Skeleton className="h-3 w-3/4" />
              <Skeleton className="h-3 w-20" />
            </div>
          </div>
        ))}
      </div>
    );
  }
  if (rows.length === 0) return <>{emptyState}</>;
  return (
    <ol className="sheet divide-y divide-border">
      {rows.map((row) => (
        <ActivityItem key={row.id} row={row} names={names} />
      ))}
    </ol>
  );
}

function ActivityItem({ row, names }: { row: ActivityRow; names: ActivityNames }) {
  const { locale, t } = useI18n();
  const sentence = describeActivity(row, locale, names);
  const actorName = row.actor_id ? (names.members.get(row.actor_id) ?? null) : null;
  return (
    <li className="flex items-start gap-3 px-4 py-3">
      {actorName ? (
        <Avatar name={actorName} size="sm" className="mt-0.5" />
      ) : (
        <span
          className="mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"
          aria-hidden="true"
        >
          <Settings className="size-3" />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-sm text-ink">{sentence}</p>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <time dateTime={row.created_at} title={formatDateTime(locale, row.created_at)}>
            {formatRelative(locale, row.created_at)}
          </time>
          {row.brief_id ? (
            <Link to={briefPath(row.brief_id)} className="text-primary hover:underline">
              {t("activity.openBrief")}
            </Link>
          ) : null}
          {row.candidate_id ? (
            <Link to={candidatePath(row.candidate_id)} className="text-primary hover:underline">
              {t("activity.openCandidate")}
            </Link>
          ) : null}
        </div>
      </div>
    </li>
  );
}
