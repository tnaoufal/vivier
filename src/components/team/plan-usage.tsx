/**
 * The plan's two usages, read-only: seats taken against the limit and
 * CVs processed this month against the quota, each its label, "used /
 * limit" as the figure and an ink bar under it; one line under a bar
 * only once nothing is left. Counters come from the database
 * functions; one that could not be read shows a dash with the reason
 * as its text for assistive technologies, an empty track and no line:
 * never a zero. A block of a pane, no card: the page gives it its title.
 */
import { CircleAlert } from "lucide-react";

import { ProgressBar } from "@/components/app-shell/progress-bar";
import { Skeleton } from "@/components/ui/skeleton";
import type { OrganizationRow } from "@/lib/db/types";
import { useT } from "@/lib/i18n";
import { seatsLeft } from "@/lib/team/seats";

/** One usage: the label and "used / limit" on one line, the bar under, one line at the limit; built only from a count that was read. */
function Usage({
  label,
  used,
  limit,
  loading,
  full,
}: {
  label: string;
  used: number | null;
  limit: number;
  loading: boolean;
  /** The line under the bar once nothing is left. */
  full: string;
}) {
  const t = useT();
  const unread = !loading && used === null;
  // The label beside it says what is counted: the value is the figure alone.
  const text = (count: number) => t("shell.org.usage", { used: count, limit });
  return (
    <li className="min-w-0">
      <p className="flex items-baseline justify-between gap-3 text-meta">
        <span className="text-ink">{label}</span>
        <span
          className="font-medium text-ink tabular-nums"
          title={unread ? t("settings.plan.unread") : undefined}
        >
          {loading ? (
            <Skeleton className="h-3.5 w-16" />
          ) : used === null ? (
            <>
              <span aria-hidden="true">—</span>
              <span className="sr-only">{t("settings.plan.unread")}</span>
            </>
          ) : (
            text(used)
          )}
        </span>
      </p>
      <div className="mt-2">
        {loading ? (
          <Skeleton className="h-1 w-full rounded-full" />
        ) : used === null ? (
          <div aria-hidden="true" className="h-1 w-full rounded-full bg-track" />
        ) : (
          <>
            <ProgressBar value={used} max={limit} size="sm" label={`${label}, ${text(used)}`} />
            {seatsLeft(used, limit) === 0 ? (
              <p className="mt-1.5 text-meta text-muted-foreground">{full}</p>
            ) : null}
          </>
        )}
      </div>
    </li>
  );
}

export function PlanUsage({
  org,
  seatsUsed,
  cvsProcessed,
  loading,
}: {
  org: OrganizationRow;
  seatsUsed: number | null;
  cvsProcessed: number | null;
  loading: boolean;
}) {
  const t = useT();
  const unread = !loading && (seatsUsed === null || cvsProcessed === null);
  return (
    <div>
      <ul className="space-y-5">
        <Usage
          label={t("settings.plan.seats")}
          used={seatsUsed}
          limit={org.seat_limit}
          loading={loading}
          full={t("members.plan.seats.full")}
        />
        <Usage
          label={t("settings.plan.cvs")}
          used={cvsProcessed}
          limit={org.cv_quota_month}
          loading={loading}
          full={t("members.plan.cvs.left.none")}
        />
      </ul>
      {unread ? (
        <p className="mt-4 flex items-start gap-1.5 text-meta text-ink">
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {t("settings.plan.unread")}
        </p>
      ) : null}
    </div>
  );
}
