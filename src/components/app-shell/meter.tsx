/**
 * One measured dimension of a profile (the five dimensions of an
 * assessment): the label on the left, the value on the right in tabular
 * digits, a 4px bar under them. A dimension the model could not read is
 * null and reads "Non renseigné" in muted text with an empty bar, never a
 * zero: that bar is decoration (no meter role, so nothing announces an
 * empty meter under the words). `tone` "score" colours the bar like the
 * fit ring (green from 80, amber from 60, red below); "primary" keeps it
 * neutral. `name` is the meter's accessible name when `label` is a node.
 */
import type { ReactNode } from "react";

import { useT } from "@/lib/i18n";
import { cn, ratioPercent } from "@/lib/utils";

import { ringTone } from "./score-ring";

const FILLS = {
  primary: "bg-primary",
  positive: "bg-positive",
  caution: "bg-caution",
  negative: "bg-negative",
} as const;

export function Meter({
  label,
  value,
  max = 100,
  hint,
  tone = "primary",
  name,
  className,
}: {
  label: ReactNode;
  /** 0 to `max`, or null when the dimension was not read. */
  value: number | null;
  max?: number;
  /** The accessible name of the meter; needed when `label` is not a plain string. */
  name?: string | undefined;
  /** One short sentence under the bar: the evidence, or why the value is missing. */
  hint?: ReactNode;
  tone?: "primary" | "score";
  className?: string;
}) {
  const t = useT();
  const percent = value === null ? 0 : ratioPercent(value, max);
  const fill =
    value === null ? FILLS.primary : tone === "score" ? FILLS[ringTone(percent)] : FILLS.primary;
  return (
    <div className={cn("min-w-0", className)}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate text-sm font-medium text-ink">{label}</span>
        {value === null ? (
          <span className="shrink-0 text-meta text-muted-foreground">{t("common.unknown")}</span>
        ) : (
          <span className="shrink-0 text-sm font-medium text-ink tabular-nums">
            {Math.round(value)}
          </span>
        )}
      </div>
      <div
        {...(value === null
          ? { "aria-hidden": true }
          : {
              role: "meter",
              "aria-label": name ?? (typeof label === "string" ? label : undefined),
              "aria-valuemin": 0,
              "aria-valuemax": max,
              "aria-valuenow": Math.round(value),
            })}
        className="mt-2 h-1 w-full overflow-hidden rounded-full bg-muted"
      >
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-slower ease-out-soft",
            fill,
          )}
          style={{ width: `${percent}%` }}
        />
      </div>
      {hint ? <p className="mt-1.5 text-meta text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
