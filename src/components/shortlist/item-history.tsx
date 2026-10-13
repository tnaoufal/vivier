/**
 * What happened to a shortlist item, newest first, as sentences built
 * by the activity area's describer: who added, decided, assigned,
 * commented, with the moment. Nothing is shown that the log does not say.
 */
import { History } from "lucide-react";

import { Skeleton } from "@/components/ui/skeleton";
import { describeActivity, type ActivityNames } from "@/lib/activity/describe";
import type { ActivityRow } from "@/lib/db/types";
import { formatDateTime, formatRelative, useI18n } from "@/lib/i18n";

export function ItemHistory({
  rows,
  names,
  loading,
  error,
}: {
  rows: ActivityRow[];
  names: ActivityNames;
  loading: boolean;
  error: boolean;
}) {
  const { t, locale } = useI18n();
  return (
    <section>
      <h3 className="label-caps mb-2">{t("shortlists.history.title")}</h3>
      {error ? (
        <p className="text-sm text-negative">{t("shortlists.history.error")}</p>
      ) : loading && rows.length === 0 ? (
        <div className="space-y-2" aria-busy="true">
          {[0, 1, 2].map((index) => (
            <Skeleton key={index} className="h-3 w-3/4" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="flex items-center gap-2 rounded-xl border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
          <History className="size-4 shrink-0" aria-hidden="true" />
          {t("shortlists.history.empty")}
        </div>
      ) : (
        <ol className="space-y-2">
          {rows.map((row) => (
            <li key={row.id} className="text-sm text-ink">
              {describeActivity(row, locale, names)}
              <time
                dateTime={row.created_at}
                title={formatDateTime(locale, row.created_at)}
                className="ml-1.5 text-xs text-muted-foreground"
              >
                {formatRelative(locale, row.created_at)}
              </time>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
