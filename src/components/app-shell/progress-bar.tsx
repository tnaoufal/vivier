/**
 * A thin bar for work in progress (an import, an analysis): 4px (`sm`)
 * under a number, 6px (`md`) on its own line; an ink fill on a grey 200
 * track. The width eases to its value; while `active`, a grey sheen
 * crosses the fill so a stalled bar and a running one look different.
 * `value` null is an indeterminate bar (the work runs, its size
 * unknown). `tone` is kept for the call sites and changes nothing: the
 * label and the figures say how the work goes. Always labelled for
 * assistive technologies.
 */
import { clamp, cn, ratioPercent } from "@/lib/utils";

export type ProgressTone = "primary" | "positive" | "caution" | "negative";

export function ProgressBar({
  value,
  max = 100,
  size = "sm",
  active = false,
  label,
  className,
}: {
  /** The progress, from 0 to `max`; null when the work runs but its size is unknown. */
  value: number | null;
  max?: number;
  size?: "sm" | "md";
  /** True while the work runs: the fill carries a sheen. */
  active?: boolean;
  /** Accepted for the call sites; the fill is the ink either way. */
  tone?: ProgressTone;
  /** The sentence for assistive technologies ("12 of 40 read"). */
  label: string;
  className?: string;
}) {
  const percent = value === null ? 0 : ratioPercent(value, max);
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      {...(value === null ? { "aria-busy": true } : { "aria-valuenow": clamp(value, 0, max) })}
      className={cn(
        "w-full overflow-hidden rounded-full bg-track",
        size === "md" ? "h-1.5" : "h-1",
        className,
      )}
    >
      {value === null ? (
        <div className="h-full w-1/3 rounded-full bg-ink animate-indeterminate" />
      ) : (
        <div
          className={cn(
            "h-full rounded-full bg-ink transition-[width] duration-slower ease-out-soft",
            active && "shine",
          )}
          style={{ width: `${percent}%` }}
        />
      )}
    </div>
  );
}
