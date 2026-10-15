/**
 * The read-only plan card: the plan's name, then two usages (seats
 * taken against the limit, CVs processed this month against the
 * quota), each its label, "used / limit" as the figure and an ink bar
 * under it; one line under the bar only when the limit is reached.
 * Counters come from the database functions; one that could not be
 * read shows a dash with the reason on hover and as its text for
 * assistive technologies, an empty track and no line: never a zero.
 */
import { CircleAlert } from "lucide-react";

import { Pill } from "@/components/app-shell/pill";
import { ProgressBar } from "@/components/app-shell/progress-bar";
import { Skeleton } from "@/components/ui/skeleton";
import type { OrganizationRow } from "@/lib/db/types";
import { useT } from "@/lib/i18n";
import { seatsLeft } from "@/lib/team/seats";
import { cn } from "@/lib/utils";

/** One usage: a label, "used / limit", the bar and, at the limit, one line; built only from a count that was read. */
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
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-3">
        <dt className="label-caps">{label}</dt>
        <dd
          className="text-sm font-medium text-ink tabular-nums"
          title={unread ? t("settings.plan.unread") : undefined}
        >
          {loading ? (
            <Skeleton className="h-4 w-24" />
          ) : used === null ? (
            <>
              <span aria-hidden="true">—</span>
              <span className="sr-only">{t("settings.plan.unread")}</span>
            </>
          ) : (
            text(used)
          )}
        </dd>
      </div>
      <dd className="mt-2">
        {loading ? (
          <Skeleton className="h-1.5 w-full rounded-full" />
        ) : used === null ? (
          <div aria-hidden="true" className="h-1.5 w-full rounded-full bg-muted" />
        ) : (
          <>
            <ProgressBar value={used} max={limit} size="md" label={`${label}, ${text(used)}`} />
            {seatsLeft(used, limit) === 0 ? (
              <p className="mt-1.5 text-meta text-muted-foreground">{full}</p>
            ) : null}
          </>
        )}
      </dd>
    </div>
  );
}

export function PlanCard({
  org,
  seatsUsed,
  cvsProcessed,
  loading,
  className,
}: {
  org: OrganizationRow;
  seatsUsed: number | null;
  cvsProcessed: number | null;
  loading: boolean;
  className?: string;
}) {
  const t = useT();
  const unread = !loading && (seatsUsed === null || cvsProcessed === null);
  const planName = t(`shell.org.plan.${org.plan}`);
  return (
    <section className={cn("sheet p-6", className)} aria-labelledby="plan-card-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="plan-card-title" className="text-base font-semibold text-ink">
          {t("settings.plan")}
        </h2>
        <Pill tone="primary" dot>
          {planName}
        </Pill>
      </div>
      <dl className="mt-6 space-y-6">
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
      </dl>
      {unread ? (
        <p className="mt-4 flex items-start gap-1.5 text-meta text-ink">
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {t("settings.plan.unread")}
        </p>
      ) : null}
    </section>
  );
}
