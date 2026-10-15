/**
 * The five dimensions of a reading (the role, the seniority, the
 * context, the trajectory, the achievements) as a grid of Meters (an
 * ink bar on a grey track: the figure is the signal, no colour grades
 * it), each with the model's one-sentence note under its bar, marked
 * when the quote behind it was not found in the CV. A dimension the
 * model left without a note reads "Non renseigné", never as a lack.
 * `compact` tightens the grid for a drawer.
 */
import { Meter } from "@/components/app-shell/meter";
import { DIMENSIONS } from "@/lib/briefs/scoring";
import type { AssessmentDimension, DimensionScore } from "@/lib/db/types";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export function DimensionMeters({
  dimensions,
  compact = false,
  className,
}: {
  dimensions: Record<AssessmentDimension, DimensionScore>;
  /** Tighter gaps, for a drawer. */
  compact?: boolean | undefined;
  className?: string | undefined;
}) {
  const t = useT();
  return (
    <ul
      className={cn(
        "grid sm:grid-cols-2",
        compact ? "gap-x-6 gap-y-3" : "gap-x-8 gap-y-4",
        className,
      )}
    >
      {DIMENSIONS.map((key) => {
        const dimension = dimensions[key];
        const note = typeof dimension.note === "string" ? dimension.note.trim() : "";
        const hint = note
          ? dimension.evidenceUnverified
            ? `${note} · ${t("briefs.results.evidence.unverified")}`
            : note
          : t("common.unknown");
        return (
          <li key={key} className="min-w-0">
            <Meter label={t(`briefs.dimension.${key}`)} value={dimension.score} hint={hint} />
          </li>
        );
      })}
    </ul>
  );
}
