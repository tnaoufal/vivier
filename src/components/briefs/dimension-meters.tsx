/**
 * The five dimensions of a reading (the role, the seniority, the
 * context, the trajectory, the achievements) as a compact grid of
 * Meters in the ring's tone (green from 80, amber from 60, red below),
 * each with the model's one-sentence note under its bar, marked when the
 * quote behind it was not found in the CV. A dimension the model left
 * without a note reads "Non renseigné", never as a lack.
 */
import { Meter } from "@/components/app-shell/meter";
import { DIMENSIONS } from "@/lib/briefs/scoring";
import type { AssessmentDimension, DimensionScore } from "@/lib/db/types";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export function DimensionMeters({
  dimensions,
  className,
}: {
  dimensions: Record<AssessmentDimension, DimensionScore>;
  className?: string | undefined;
}) {
  const t = useT();
  return (
    <ul className={cn("grid gap-x-8 gap-y-4 sm:grid-cols-2", className)}>
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
            <Meter
              label={t(`briefs.dimension.${key}`)}
              value={dimension.score}
              tone="score"
              hint={hint}
            />
          </li>
        );
      })}
    </ul>
  );
}
