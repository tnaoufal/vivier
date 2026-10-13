/**
 * A toggle chip in a filter row (a tag, a family of activities, a
 * language): a pill with a hairline, tinted with the accent when it is
 * on. Never the filled primary, which a page keeps for its one main
 * action.
 */
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export function FilterChip({
  active,
  onClick,
  children,
  disabled = false,
  className,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={cn(
        "inline-flex h-10 max-w-full shrink-0 cursor-pointer items-center gap-1.5 rounded-full border px-3.5 text-[13px] font-medium transition-colors duration-150 ease-out-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
        active
          ? "border-primary/40 bg-primary/10 text-primary"
          : "border-input bg-card text-muted-foreground hover:bg-accent hover:text-ink",
        className,
      )}
    >
      <span className="min-w-0 truncate">{children}</span>
    </button>
  );
}
