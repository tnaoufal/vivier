/**
 * The four steps of a running analysis in a row: the triage of the
 * pool, the full reading, the second reading, the ranking. A step done
 * shows a check, the current one is ringed in the accent and named
 * "current step" for assistive technologies, the ones to come stay
 * muted. On a phone only the current step keeps its name on screen;
 * every name stays readable by a screen reader.
 */
import { Check } from "lucide-react";

import { BAND_STEPS, stepOf } from "@/lib/briefs/presentation";
import type { AnalysisStep } from "@/lib/briefs/stages";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export function AnalysisStepper({
  step,
  className,
}: {
  step: AnalysisStep;
  className?: string | undefined;
}) {
  const t = useT();
  const current = stepOf(step);
  const last = BAND_STEPS.length - 1;
  return (
    <ol
      aria-label={t("briefs.analysis.steps")}
      className={cn("flex items-center gap-2", className)}
    >
      {BAND_STEPS.map((name, index) => {
        const done = index < current;
        const active = index === current;
        return (
          <li
            key={name}
            aria-current={active ? "step" : undefined}
            className={cn("flex min-w-0 items-center gap-2", index < last && "flex-1")}
          >
            <span
              aria-hidden="true"
              className={cn(
                "flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums transition-colors duration-base ease-out-soft",
                done && "bg-primary text-primary-foreground",
                active && "bg-primary/12 text-primary ring-2 ring-primary",
                !done && !active && "bg-muted text-muted-foreground",
              )}
            >
              {done ? <Check className="size-3.5" /> : index + 1}
            </span>
            <span
              className={cn(
                "min-w-0 truncate text-sm",
                active ? "font-medium text-ink" : "sr-only text-muted-foreground sm:not-sr-only",
              )}
            >
              {t(`briefs.analysis.step.${name}`)}
              {done || active ? (
                <span className="sr-only">
                  {` (${t(done ? "briefs.analysis.step.done" : "briefs.analysis.step.current")})`}
                </span>
              ) : null}
            </span>
            {index < last ? (
              <span
                aria-hidden="true"
                className={cn(
                  "h-px min-w-3 flex-1 transition-colors duration-base ease-out-soft",
                  done ? "bg-primary" : "bg-border",
                )}
              />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
