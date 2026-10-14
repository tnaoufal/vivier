/**
 * The read-only plan card: the plan's name, then two meters (seats
 * taken against the limit, CVs processed this month against the
 * quota), each a bar whose tone turns to caution near the limit and
 * negative at it, with one line under it saying what is left. Counters
 * come from the database functions; one that could not be read shows a
 * dash with the reason on hover and as its text for assistive
 * technologies, an empty track and no hint: never a zero. Billing is
 * the owner's, since there is no checkout yet.
 */
import type { ReactNode } from "react";

import { Pill } from "@/components/app-shell/pill";
import { ProgressBar } from "@/components/app-shell/progress-bar";
import { Skeleton } from "@/components/ui/skeleton";
import type { OrganizationRow } from "@/lib/db/types";
import { useT } from "@/lib/i18n";
import { seatsLeft, usageTone } from "@/lib/team/seats";
import { cn } from "@/lib/utils";

/** One meter: a label, "used / limit", the bar and what is left; built only from a count that was read. */
function Usage({
  label,
  used,
  limit,
  loading,
  text,
  hint,
}: {
  label: string;
  used: number | null;
  limit: number;
  loading: boolean;
  /** The "used / limit" sentence for a count that was read, also the bar's label. */
  text: (used: number) => string;
  /** What is left, for a count that was read. */
  hint: (used: number) => ReactNode;
}) {
  const t = useT();
  const unread = !loading && used === null;
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-3">
        <dt className="label-caps">{label}</dt>
        <dd className="text-sm font-medium text-ink tabular-nums" title={unread ? t("settings.plan.unread") : undefined}>
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
            <ProgressBar value={used} max={limit} size="md" tone={usageTone(used, limit)} label={text(used)} />
            <p className="mt-1.5 text-meta text-muted-foreground">{hint(used)}</p>
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
        <h2 id="plan-card-title" className="font-display text-xl text-ink">
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
          text={(used) => t("shell.org.seats", { used, limit: org.seat_limit })}
          hint={(used) => {
            const free = seatsLeft(used, org.seat_limit);
            return free === 0 ? t("members.plan.seats.full") : free === 1 ? t("members.seatsLeft.one") : t("members.seatsLeft.many", { count: free });
          }}
        />
        <Usage
          label={t("settings.plan.cvs")}
          used={cvsProcessed}
          limit={org.cv_quota_month}
          loading={loading}
          text={(used) => t("shell.org.quota", { used, limit: org.cv_quota_month })}
          hint={(used) => {
            const free = seatsLeft(used, org.cv_quota_month);
            return free === 0
              ? t("members.plan.cvs.left.none")
              : free === 1
                ? t("members.plan.cvs.left.one")
                : t("members.plan.cvs.left.many", { count: free });
          }}
        />
      </dl>
      {unread ? <p className="mt-4 text-meta text-caution-foreground dark:text-caution">{t("settings.plan.unread")}</p> : null}
      <p className="mt-6 text-meta text-muted-foreground">{t("settings.plan.billing")}</p>
    </section>
  );
}
