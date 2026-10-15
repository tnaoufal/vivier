/**
 * The activity feed as a timeline of rows divided by lines, edge to
 * edge in its pane (no card: the plane has none): rows grouped by day
 * (today, yesterday, then dated) under a label-caps heading with a line
 * under it, each with the actor's avatar on a rail, the sentence with
 * the actor's name set heavier, the moment (relative, the exact time on
 * hover) and a link to the brief or the candidate the row points at. A
 * row without an actor (the service read a document) shows its family's
 * icon instead of a face. Days are h3 under a section's h2, h2 directly
 * under the page's h1 (the activity page), so headings never skip a
 * level. Rows rise in once, one after the other; a refresh keeps the
 * rows that are there.
 */
import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";

import { Avatar } from "@/components/app-shell/avatar";
import { SkeletonRows } from "@/components/ui/skeleton";
import { describeActivity, type ActivityNames } from "@/lib/activity/describe";
import { groupByDay, splitActor, type DayLabel } from "@/lib/activity/grouping";
import { briefPath, candidatePath } from "@/lib/activity/links";
import type { ActivityRow } from "@/lib/db/types";
import { formatDate, formatDateTime, formatRelative, useI18n, type Locale } from "@/lib/i18n";
import { cn } from "@/lib/utils";

import { familyIcon } from "./family-icon";

function dayTitle(
  label: DayLabel,
  locale: Locale,
  t: (key: "activity.group.today" | "activity.group.yesterday") => string,
): string {
  if (label.kind === "today") return t("activity.group.today");
  if (label.kind === "yesterday") return t("activity.group.yesterday");
  return formatDate(locale, `${label.iso}T12:00:00`);
}

export function ActivityList({
  rows,
  names,
  loading,
  emptyState,
  grouped = true,
  headingLevel = 3,
  className,
}: {
  rows: ActivityRow[];
  names: ActivityNames;
  loading: boolean;
  /** Shown when there is nothing to list (an EmptyState). */
  emptyState: ReactNode;
  /** Day headings between the rows; off for a short list that fits one glance. */
  grouped?: boolean;
  /** The level of the day headings: 2 directly under a page title, 3 inside a section. */
  headingLevel?: 2 | 3;
  className?: string;
}) {
  const { locale, t } = useI18n();
  const DayHeading = headingLevel === 2 ? "h2" : "h3";
  if (loading && rows.length === 0) {
    return (
      <div className={className}>
        <SkeletonRows rows={4} avatarSize="sm" />
      </div>
    );
  }
  if (rows.length === 0) return <>{emptyState}</>;
  const groups = grouped ? groupByDay(rows) : [{ key: "all", label: null, rows }];
  return (
    <div className={className}>
      {groups.map((group) => (
        <section key={group.key} className="border-t border-line first:border-t-0">
          {group.label ? (
            <DayHeading className="label-caps border-b border-line px-4 py-2 sm:px-6">
              {dayTitle(group.label, locale, t)}
            </DayHeading>
          ) : null}
          <ol className="stagger">
            {group.rows.map((row) => (
              <li
                key={row.id}
                className={cn(
                  "sheet-row rise-in relative items-start",
                  // The rail: a hairline above the disc (not on the first row) and below it (not on the last), through the padding, so the rows read as one timeline.
                  "before:absolute before:left-7.5 before:top-0 before:h-4.5 before:w-px before:bg-border first:before:hidden sm:before:left-9.5",
                  "after:absolute after:bottom-0 after:left-7.5 after:top-11.5 after:w-px after:bg-border last:after:hidden sm:after:left-9.5",
                )}
              >
                <ActivityItem row={row} names={names} />
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}

/** The inside of one row: the actor's disc on the rail, the sentence, the moment and the links. */
function ActivityItem({ row, names }: { row: ActivityRow; names: ActivityNames }) {
  const { locale, t } = useI18n();
  const sentence = describeActivity(row, locale, names);
  const actorName = row.actor_id ? (names.members.get(row.actor_id) ?? null) : null;
  const [actor, rest] = splitActor(sentence, actorName);
  return (
    <>
      {actorName ? (
        <Avatar name={actorName} size="sm" className="relative mt-0.5" decorative />
      ) : (
        <span
          className="relative mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground [&_svg]:size-3.5"
          aria-hidden="true"
        >
          {familyIcon(row.kind)}
        </span>
      )}
      <div className="min-w-0 flex-1 pb-1">
        <p className="text-sm leading-5 text-ink break-words">
          {actor ? <span className="font-semibold">{actor}</span> : null}
          {rest}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-meta text-muted-foreground">
          <time dateTime={row.created_at} title={formatDateTime(locale, row.created_at)}>
            {formatRelative(locale, row.created_at)}
          </time>
          {row.brief_id ? (
            <Link
              to={briefPath(row.brief_id)}
              className="rounded-sm font-medium text-ink underline underline-offset-4 hover:decoration-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t("activity.openBrief")}
            </Link>
          ) : null}
          {row.candidate_id ? (
            <Link
              to={candidatePath(row.candidate_id)}
              className="rounded-sm font-medium text-ink underline underline-offset-4 hover:decoration-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t("activity.openCandidate")}
            </Link>
          ) : null}
        </div>
      </div>
    </>
  );
}
