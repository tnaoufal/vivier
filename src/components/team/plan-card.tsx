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
  return (
    <section className="sheet p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-lg text-ink">{t("settings.plan")}</h2>
        <Pill tone="primary">{t(`shell.org.plan.${org.plan}`)}</Pill>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{t("settings.plan.current", { plan: t(`shell.org.plan.${org.plan}`) })}</p>
      <dl className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl bg-muted/60 p-3">
          <dt className="label-caps">{t("nav.members")}</dt>
          <dd className="mt-1 text-sm text-ink">
            {loading ? (
              <Skeleton className="h-4 w-24" />
            ) : seatsUsed === null ? (
              "—"
            ) : (
              t("shell.org.seats", { used: seatsUsed, limit: org.seat_limit })
            )}
          </dd>
        </div>
        <div className="rounded-xl bg-muted/60 p-3">
          <dt className="label-caps">{t("shell.dashboard.processing")}</dt>
          <dd className="mt-1 text-sm text-ink">
            {loading ? (
              <Skeleton className="h-4 w-24" />
            ) : cvsProcessed === null ? (
              "—"
            ) : (
              t("shell.org.quota", { used: cvsProcessed, limit: org.cv_quota_month })
            )}
          </dd>
        </div>
      </dl>
      {unread ? <p className="mt-2 text-xs text-caution">{t("settings.plan.unread")}</p> : null}
      <p className="mt-4 text-sm text-muted-foreground">{t("settings.plan.billing")}</p>
    </section>
  );
}
