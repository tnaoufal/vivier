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

/** A small rounded label: a status, a verdict, a role. */
export function Pill({ tone = "neutral", children, className, title }: { tone?: PillTone; children: ReactNode; className?: string; title?: string }) {
  return (
    <span
      title={title}
      className={cn("inline-flex h-6 items-center gap-1 rounded-full px-2.5 text-xs font-medium whitespace-nowrap [&_svg]:size-3", TONES[tone], className)}
    >
      {children}
    </span>
  );
}
