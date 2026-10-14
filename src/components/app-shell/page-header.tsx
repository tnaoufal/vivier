/**
 * The top of every app page: an optional eyebrow, the title in the
 * display face (30/36, 24/32 on phones), one sentence under it, an
 * optional row of meta (pills, a date), the actions on the right (under
 * the title on a phone). 32px of air below it. `sticky` is the slim
 * variant of a long page: it stays under the top edge with a blur, the
 * title at 20/28 and the description folded away.
 */
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
  meta,
  sticky = false,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  eyebrow?: ReactNode;
  /** A row under the title: pills, a date, a count. */
  meta?: ReactNode;
  /** The slim variant that stays at the top of a long page. */
  sticky?: boolean;
  className?: string;
}) {
  if (sticky) {
    return (
      <header
        className={cn(
          "sticky top-16 z-sticky -mx-4 mb-6 flex items-center justify-between gap-4 border-b border-border bg-background/85 px-4 py-3 backdrop-blur sm:-mx-8 sm:px-8 lg:top-0 lg:-mx-10 lg:px-10",
          className,
        )}
      >
        <div className="min-w-0 flex-1">
          {eyebrow ? <div className="label-caps truncate">{eyebrow}</div> : null}
          <h1 className="truncate font-display text-xl text-ink">{title}</h1>
          {meta ? <div className="mt-1 flex flex-wrap items-center gap-2">{meta}</div> : null}
        </div>
        {actions ? (
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">{actions}</div>
        ) : null}
      </header>
    );
  }
  return (
    <header
      className={cn(
        "mb-8 flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between",
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        {eyebrow ? <div className="label-caps mb-2">{eyebrow}</div> : null}
        <h1 className="font-display text-2xl text-ink break-words sm:text-3xl">{title}</h1>
        {description ? (
          <p className="mt-2 max-w-2xl text-body text-muted-foreground">{description}</p>
        ) : null}
        {meta ? <div className="mt-3 flex flex-wrap items-center gap-2">{meta}</div> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-3">{actions}</div> : null}
    </header>
  );
}
