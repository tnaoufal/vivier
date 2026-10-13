/**
 * The read-only plan card: the plan's name, seats taken against the
 * limit, CVs processed this month against the quota, and the sentence
 * that billing is the owner's, since there is no checkout yet. Counters
 * come from the database functions; one that could not be read says so.
 */
import { Pill } from "@/components/app-shell/pill";
import { Skeleton } from "@/components/ui/skeleton";
import type { OrganizationRow } from "@/lib/db/types";
import { useT } from "@/lib/i18n";

export function PlanCard({
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
  const planName = t(`shell.org.plan.${org.plan}`);
  return (
    <section className="sheet p-6 sm:p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-xl text-ink">{t("settings.plan")}</h2>
        <Pill tone="primary" dot>
          {planName}
        </Pill>
      </div>
      <p className="mt-1 text-sm leading-5 text-muted-foreground">{t("settings.plan.current", { plan: planName })}</p>
      <dl className="mt-6 grid gap-6 sm:grid-cols-2 sm:divide-x sm:divide-border">
        <div className="min-w-0 sm:pr-6">
          <dt className="label-caps">{t("settings.plan.seats")}</dt>
          <dd className="mt-2 text-ink">
            {loading ? (
              <Skeleton className="h-7 w-32" />
            ) : seatsUsed === null ? (
              <span className="text-2xl font-display tabular-nums">—</span>
            ) : (
              <span className="text-2xl font-display tabular-nums">{t("shell.org.seats", { used: seatsUsed, limit: org.seat_limit })}</span>
            )}
          </dd>
        </div>
        <div className="min-w-0 sm:pl-6">
          <dt className="label-caps">{t("settings.plan.cvs")}</dt>
          <dd className="mt-2 text-ink">
            {loading ? (
              <Skeleton className="h-7 w-32" />
            ) : cvsProcessed === null ? (
              <span className="text-2xl font-display tabular-nums">—</span>
            ) : (
              <span className="text-2xl font-display tabular-nums">{t("shell.org.quota", { used: cvsProcessed, limit: org.cv_quota_month })}</span>
            )}
          </dd>
        </div>
      </dl>
      {unread ? <p className="mt-3 text-[13px] leading-5 text-caution-foreground dark:text-caution">{t("settings.plan.unread")}</p> : null}
      <p className="mt-6 text-sm leading-5 text-muted-foreground">{t("settings.plan.billing")}</p>
    </section>
  );
}
