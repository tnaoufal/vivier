/**
 * A small rounded label: a status, a verdict, a role. Tones carry
 * meaning only (positive, caution, negative, neutral, primary); `dot`
 * adds a leading dot so colour is never the only signal when the
 * caller has no icon of its own.
 */
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export type PillTone = "neutral" | "positive" | "caution" | "negative" | "primary";

const TONES: Record<PillTone, string> = {
  neutral: "bg-muted text-muted-foreground",
  positive: "bg-positive/12 text-positive",
  caution: "bg-caution/15 text-caution-foreground dark:text-caution",
  negative: "bg-negative/12 text-negative",
  primary: "bg-primary/12 text-primary",
};

export function Pill({
  tone = "neutral",
  dot = false,
  children,
  className,
  title,
}: {
  tone?: PillTone;
  /** A leading dot in the tone's colour, for a pill without an icon. */
  dot?: boolean;
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex h-6 max-w-full items-center gap-1.5 rounded-full px-2.5 text-xs font-medium whitespace-nowrap tabular-nums [&_svg]:size-3.5 [&_svg]:shrink-0",
        TONES[tone],
        className,
      )}
    >
      {dot ? <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-current" /> : null}
      {children}
    </span>
  );
}
