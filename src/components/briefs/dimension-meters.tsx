/**
 * The five dimensions of a screening as a compact row of small meters:
 * the label with the weight it carries in the composite, the number and
 * a 4px bar in the ring's tone (green from 80, amber from 60, red
 * below), the model's note on hover; expanded, one line per dimension
 * with the note and the evidence it rests on (marked when the quote was
 * not found in the CV). A dimension the model left without a note reads
 * "not stated", never as a lack.
 */
import { ringTone } from "@/components/app-shell/score-ring";
import { DIMENSION_WEIGHTS, DIMENSIONS } from "@/lib/briefs/scoring";
import type { AssessmentDimension, DimensionScore } from "@/lib/db/types";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const BARS = { positive: "bg-positive", caution: "bg-caution", negative: "bg-negative" } as const;

export function DimensionMeters({
  dimensions,
  expanded = false,
  className,
}: {
  dimensions: Record<AssessmentDimension, DimensionScore>;
  /** True to show the note and the evidence under the meters. */
  expanded?: boolean;
  className?: string;
}) {
  const { t, locale } = useI18n();
  const percent = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  return (
    <div className={cn("space-y-3", className)}>
      <ul className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-5">
        {DIMENSIONS.map((key) => {
          const dimension = dimensions[key];
          const label = t(`briefs.dimension.${key}`);
          const sentence = t("briefs.results.dimension.score", { label, score: dimension.score });
          const weighted = t("briefs.results.dimension.weight", {
            label,
            weight: percent.format(DIMENSION_WEIGHTS[key] * 100),
          });
          return (
            <li key={key} className="min-w-0" title={dimension.note || sentence}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-[13px] font-medium text-muted-foreground">
                  {weighted}
                </span>
                <span className="text-sm font-semibold text-ink tabular-nums">
                  {dimension.score}
                </span>
              </div>
              <div
                role="meter"
                aria-label={sentence}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={dimension.score}
                className="mt-1 h-1 w-full overflow-hidden rounded-full bg-muted"
              >
                <div
                  className={cn("h-full rounded-full", BARS[ringTone(dimension.score)])}
                  style={{ width: `${dimension.score}%` }}
                />
              </div>
            </li>
          );
        })}
      </ul>
      {expanded ? (
        <ul className="divide-y divide-border">
          {DIMENSIONS.map((key) => {
            const dimension = dimensions[key];
            return (
              <li key={key} className="py-2">
                <p className="text-sm leading-5 text-ink">
                  <span className="font-medium">{t(`briefs.dimension.${key}`)}</span>
                  <span className="text-muted-foreground tabular-nums"> · {dimension.score}</span>
                  {dimension.note ? (
                    ` · ${dimension.note}`
                  ) : (
                    <span className="text-muted-foreground"> · {t("common.unknown")}</span>
                  )}
                </p>
                {dimension.evidence ? (
                  <p className="mt-0.5 text-[13px] leading-5 text-muted-foreground">
                    {dimension.evidenceUnverified
                      ? `${dimension.evidence} · ${t("briefs.results.evidence.unverified")}`
                      : dimension.evidence}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
