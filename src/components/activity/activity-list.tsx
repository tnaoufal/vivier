/**
 * The activity feed as a list of sentences: who did what, when, with a
 * link to the brief or the candidate when the row points at one. Shared
 * by the dashboard (last fifteen) and the activity page (paged). Each
 * row is a `sheet-row`; the list wraps them in a sheet.
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
      <div className="sheet overflow-hidden" aria-busy="true">
        {[0, 1, 2].map((index) => (
          <div key={index} className="sheet-row items-start">
            <Skeleton className="size-7 rounded-full" />
            <div className="flex-1 space-y-2 py-1">
              <Skeleton className="h-3.5 w-3/4" />
              <Skeleton className="h-3 w-24" />
            </div>
          </div>
        ))}
      </div>
    );
  }
  if (rows.length === 0) return <>{emptyState}</>;
  return (
    <ol className="sheet overflow-hidden">
      {rows.map((row) => (
        <li key={row.id} className="sheet-row items-start">
          <ActivityItem row={row} names={names} />
        </li>
      ))}
    </ol>
  );
}

/** The inside of one row: the actor's disc, the sentence, the moment and the links. */
function ActivityItem({ row, names }: { row: ActivityRow; names: ActivityNames }) {
  const { locale, t } = useI18n();
  const sentence = describeActivity(row, locale, names);
  const actorName = row.actor_id ? (names.members.get(row.actor_id) ?? null) : null;
  return (
    <>
      {actorName ? (
        <Avatar name={actorName} size="sm" className="mt-0.5" />
      ) : (
        <span
          className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"
          aria-hidden="true"
        >
          <Settings className="size-3.5" />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-[15px] leading-6 text-ink break-words">{sentence}</p>
        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] leading-5 text-muted-foreground">
          <time dateTime={row.created_at} title={formatDateTime(locale, row.created_at)}>
            {formatRelative(locale, row.created_at)}
          </time>
          {row.brief_id ? (
            <Link to={briefPath(row.brief_id)} className="font-medium text-primary hover:underline">
              {t("activity.openBrief")}
            </Link>
          ) : null}
          {row.candidate_id ? (
            <Link to={candidatePath(row.candidate_id)} className="font-medium text-primary hover:underline">
              {t("activity.openCandidate")}
            </Link>
          ) : null}
        </div>
      </div>
    </>
  );
}
