/**
 * A small rounded label: a status, a verdict, a role. Tones carry
 * meaning only (positive, caution, negative, neutral, primary). A pill
 * leads with a dot OR one 14px icon, never both, so colour is never the
 * only signal and a label never shows two marks: `icon` wins over `dot`.
 */
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export type PillTone = "neutral" | "positive" | "caution" | "negative" | "primary";

const TONES: Record<PillTone, string> = {
  neutral: "bg-muted text-muted-foreground",
  positive: "bg-positive/12 text-positive",
  caution: "bg-caution/15 text-caution-foreground",
  negative: "bg-negative/12 text-negative",
  primary: "bg-primary/12 text-primary",
};

export function Pill({
  tone = "neutral",
  dot = false,
  icon,
  size = "md",
  children,
  className,
  title,
}: {
  tone?: PillTone;
  /** A leading dot in the tone's colour, for a pill without an icon. */
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
        !hasIcon && dot && "[&_[data-slot=label]_svg]:hidden",
        className,
      )}
    >
      {hasIcon ? (
        <span aria-hidden="true" className="inline-flex shrink-0">
          {icon}
        </span>
      ) : dot ? (
        <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-current" />
      ) : null}
      <span data-slot="label" className="min-w-0 truncate">
        {children}
      </span>
    </span>
  );
}
