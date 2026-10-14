/**
 * What a list shows when it has nothing: an icon in a tinted disc, one
 * sentence, the one action that fills it. `compact` is the version
 * inside a card or a drawer (less air, a smaller disc).
 */
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export function EmptyState({
  icon,
  title,
  text,
  action,
  compact = false,
  className,
}: {
  icon?: ReactNode;
  title: ReactNode;
  text?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "sheet fade-in flex flex-col items-center text-center",
        compact ? "px-5 py-10" : "px-6 py-16",
        className,
      )}
    >
      {icon ? (
        <div
          className={cn(
            "mb-5 flex items-center justify-center rounded-full bg-primary/10 text-primary",
            compact ? "size-11 [&_svg]:size-5" : "size-14 [&_svg]:size-6",
          )}
        >
          {icon}
        </div>
      ) : null}
      <h2
        className={cn(
          "max-w-md font-display text-ink break-words",
          compact ? "text-lg" : "text-xl",
        )}
      >
        {title}
      </h2>
      {text ? <p className="mt-2 max-w-md text-body text-muted-foreground">{text}</p> : null}
      {action ? (
        <div className={cn("flex flex-wrap justify-center gap-3", compact ? "mt-5" : "mt-6")}>
          {action}
        </div>
      ) : null}
    </div>
  );
}
