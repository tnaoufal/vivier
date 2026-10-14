/**
 * The five dimensions of a screening as a compact grid of Meters, each
 * in the ring's tone (green from 80, amber from 60, red below), with the
 * weight the dimension carries in the composite on hover; expanded, the
 * model's note and the evidence it rests on sit under each bar (marked
 * when the quote was not found in the CV). A dimension the model left
 * without a note reads "not stated", never as a lack.
 */
import { Meter } from "@/components/app-shell/meter";
import { DIMENSION_WEIGHTS, DIMENSIONS } from "@/lib/briefs/scoring";
import type { AssessmentDimension, DimensionScore } from "@/lib/db/types";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export function DimensionMeters({
  dimensions,
  expanded = false,
  className,
}: {
  dimensions: Record<AssessmentDimension, DimensionScore>;
  /** True to show the note and the evidence under each bar. */
  expanded?: boolean;
  className?: string;
}) {
  const { t, locale } = useI18n();
  const percent = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  return (
    <ul className={cn("grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3", className)}>
      {DIMENSIONS.map((key) => {
        const dimension = dimensions[key];
        const label = t(`briefs.dimension.${key}`);
        const weighted = t("briefs.results.dimension.weight", {
          label,
          weight: percent.format(DIMENSION_WEIGHTS[key] * 100),
        });
        const hint = expanded ? (
          <>
            <span className={dimension.note ? "text-ink/85" : undefined}>
              {dimension.note || t("common.unknown")}
            </span>
            {dimension.evidence ? (
              <span className="mt-0.5 block">
                {dimension.evidenceUnverified
                  ? `${dimension.evidence} · ${t("briefs.results.evidence.unverified")}`
                  : dimension.evidence}
              </span>
            ) : null}
          </>
        ) : undefined;
        return (
          <li key={key} className="min-w-0" title={weighted}>
            <Meter label={label} value={dimension.score} tone="score" hint={hint} />
          </li>
        );
      })}
    </ul>
  );
}
