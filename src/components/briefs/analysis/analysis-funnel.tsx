/**
 * How the profiles shown were chosen, as four figures in the order the
 * analysis narrows the pool: the profiles analysed (the triage read
 * them), the ones the triage kept, the ones read in full, the ones that
 * match. A row on a phone, four columns from `sm`; one line under them
 * says the method once, and an optional line follows (the requirement
 * most often missing, in the zero state).
 */
import type { ReactNode } from "react";

import { formatCount } from "@/lib/candidates/format";
import type { Funnel } from "@/lib/briefs/presentation";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export function AnalysisFunnel({
  funnel,
  id,
  footer,
  className,
}: {
  funnel: Funnel;
  /** The id the toggle that shows the funnel controls. */
  id?: string | undefined;
  /** A line under the method's (the requirement most often missing). */
  footer?: ReactNode;
  className?: string | undefined;
}) {
  const { t, locale } = useI18n();
  const figures = [
    { key: "analysed", value: funnel.analysed, label: t("briefs.funnel.analysed") },
    { key: "kept", value: funnel.kept, label: t("briefs.funnel.kept") },
    { key: "assessed", value: funnel.assessed, label: t("briefs.funnel.assessed") },
    { key: "matches", value: funnel.matches, label: t("briefs.funnel.matches") },
  ];
  return (
    <div id={id} className={cn("fade-in space-y-4", className)}>
      <ol className="stagger grid gap-3 sm:grid-cols-4 sm:gap-6">
        {figures.map((figure) => (
          <li
            key={figure.key}
            className="rise-in flex min-w-0 items-baseline gap-3 sm:flex-col sm:gap-1"
          >
            <span className="stat-number text-ink">{formatCount(locale, figure.value)}</span>
            <span className="label-caps min-w-0">{figure.label}</span>
          </li>
        ))}
      </ol>
      <p className="max-w-3xl text-sm text-muted-foreground">{t("briefs.funnel.method")}</p>
      {footer}
    </div>
  );
}
