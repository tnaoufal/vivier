/**
 * A small rounded label: a status, a verdict, a role. Tones carry
 * meaning only, in monochrome: positive is the ink filled with paper
 * text, caution a 1px ink outline, negative a 1px grey 400 outline with
 * grey 500 text, neutral a grey 100 fill; primary (the old accent) draws
 * like caution. A verdict tone always carries a mark: one 14px `icon`,
 * or a 6px dot in the pill's own ink, implied when no icon is given
 * (`dot={false}` for a letter that is its own mark); `icon` wins over
 * `dot`, so a label never shows two marks.
 */
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export type PillTone = "neutral" | "positive" | "caution" | "negative" | "primary";

const TONES: Record<PillTone, string> = {
  neutral: "bg-muted text-muted-foreground",
  positive: "bg-ink text-background",
  caution: "border border-ink bg-transparent text-ink",
  negative: "border border-neutral bg-transparent text-negative",
  primary: "border border-ink bg-transparent text-ink",
};

/** The tones that state a verdict: a mark is implied, so shape never stands alone. */
const MARKED: ReadonlySet<PillTone> = new Set<PillTone>(["positive", "caution", "negative"]);

export function Pill({
  tone = "neutral",
  dot,
  icon,
  size = "md",
  children,
  className,
  title,
}: {
  tone?: PillTone;
  /** A leading dot in the pill's ink; implied for a verdict tone without an icon, `false` to withhold it. */
  dot?: boolean;
  /** One leading 14px icon; when given, the dot is not drawn. */
  icon?: ReactNode;
  /** `sm` (20px) inside a dense row, `md` (24px) elsewhere. */
  size?: "sm" | "md";
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  const hasIcon = icon !== undefined && icon !== null;
  const hasDot = !hasIcon && (dot ?? MARKED.has(tone));
  return (
    <span
      title={title}
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-full font-medium whitespace-nowrap tabular-nums [&_svg]:shrink-0",
        size === "sm"
          ? "h-5 px-2 text-xs leading-4 [&_svg]:size-3"
          : "h-6 px-2.5 text-xs [&_svg]:size-3.5",
        TONES[tone],
        // A pill leads with one mark: next to a dot, an icon left among the children is not drawn.
        hasDot && "[&_[data-slot=label]_svg]:hidden",
        className,
      )}
    >
      {hasIcon ? (
        <span aria-hidden="true" className="inline-flex shrink-0">
          {icon}
        </span>
      ) : hasDot ? (
        <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-current" />
      ) : null}
      <span data-slot="label" className="min-w-0 truncate">
        {children}
      </span>
    </span>
  );
}
