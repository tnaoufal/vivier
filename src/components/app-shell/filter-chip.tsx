/**
 * A toggle chip in a filter row (a tag, a family of activities, a
 * language): a pill with a 1px grey 300 border at rest, filled with the
 * ink (paper text) when it is on, so the state is a shape and not a hue.
 * 40px high like the field and the tabs it sits beside. One 16px icon
 * at most, a count in tabular digits at full strength (lighter by
 * weight, never by alpha, so it keeps AA contrast on the card). A chip
 * that opens a panel (the pool's "Filtres") passes `expanded` and
 * `controls`: it then says open or closed, not pressed.
 */
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export function FilterChip({
  active,
  onClick,
  children,
  icon,
  count,
  disabled = false,
  expanded,
  controls,
  className,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  icon?: ReactNode;
  count?: number | undefined;
  disabled?: boolean;
  /** Set when the chip shows or hides a panel: aria-expanded replaces aria-pressed. */
  expanded?: boolean | undefined;
  /** The id of the panel an `expanded` chip shows. */
  controls?: string | undefined;
  className?: string;
}) {
  const toggles = expanded !== undefined;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={toggles ? undefined : active}
      aria-expanded={toggles ? expanded : undefined}
      aria-controls={toggles ? controls : undefined}
      className={cn(
        // The ring stands 2px off the chip: on an active chip's ink, an ink ring would not show.
        "press inline-flex h-10 max-w-full shrink-0 cursor-pointer items-center gap-1.5 rounded-full border px-4 text-meta font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
        active
          ? "border-ink bg-ink text-background"
          : "border-input bg-card text-muted-foreground hover:bg-accent hover:text-ink",
        className,
      )}
    >
      {icon ? (
        <span aria-hidden="true" className="inline-flex shrink-0">
          {icon}
        </span>
      ) : null}
      <span className="min-w-0 truncate">{children}</span>
      {typeof count === "number" ? (
        <span
          // On an active chip the count inherits the paper text of the ink fill.
          className={cn("font-normal tabular-nums", !active && "text-muted-foreground")}
        >
          {/* Keeps the label and the count two words in the accessible name ("Remote, 3"). */}
          <span className="sr-only">, </span>
          {count}
        </span>
      ) : null}
    </button>
  );
}
