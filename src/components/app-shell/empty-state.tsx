/**
 * What a list shows when it has nothing: an icon in a grey disc, a
 * title of a few words, the one action that fills it. `compact` is the
 * version inside a card or a drawer (less air, a smaller disc, and the
 * title a paragraph: the card's or the drawer's own title is the
 * heading). `inset` is for a place that already draws the card (a
 * `sheet p-6`): no sheet of its own, so never a card inside a card.
 * `quiet` is the version inside a pane of the plane: no sheet, no disc,
 * the icon alone, the title, the action.
 */
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export function EmptyState({
  icon,
  title,
  text,
  action,
  compact = false,
  inset = false,
  quiet = false,
  className,
}: {
  icon?: ReactNode;
  title: ReactNode;
  text?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
  /** Inside a sheet that already draws the card: no sheet of its own. */
  inset?: boolean;
  /** Inside a pane: no sheet, no disc. */
  quiet?: boolean | undefined;
  className?: string;
}) {
  if (quiet) {
    return (
      <div className={cn("fade-in flex flex-col items-center px-4 py-10 text-center", className)}>
        {icon ? (
          <div className="mb-3 text-muted-foreground [&_svg]:size-5" aria-hidden="true">
            {icon}
          </div>
        ) : null}
        <p className="max-w-md text-sm font-medium text-ink break-words">{title}</p>
        {text ? <p className="mt-1 max-w-md text-meta text-muted-foreground">{text}</p> : null}
        {action ? <div className="mt-4 flex flex-wrap justify-center gap-3">{action}</div> : null}
      </div>
    );
  }
  const Title = compact ? "p" : "h2";
  return (
    <div
      className={cn(
        !inset && "sheet",
        "fade-in flex flex-col items-center text-center",
        compact ? (inset ? "px-4 py-6" : "px-5 py-10") : "px-6 py-16",
        className,
      )}
    >
      {icon ? (
        <div
          className={cn(
            "mb-5 flex items-center justify-center rounded-full bg-muted text-ink",
            compact ? "size-11 [&_svg]:size-5" : "size-14 [&_svg]:size-6",
          )}
        >
          {icon}
        </div>
      ) : null}
      <Title
        className={cn(
          "max-w-md font-display text-ink break-words",
          compact ? "text-lg" : "text-xl",
        )}
      >
        {title}
      </Title>
      {text ? <p className="mt-2 max-w-md text-body text-muted-foreground">{text}</p> : null}
      {action ? (
        <div className={cn("flex flex-wrap justify-center gap-3", compact ? "mt-5" : "mt-6")}>
          {action}
        </div>
      ) : null}
    </div>
  );
}
