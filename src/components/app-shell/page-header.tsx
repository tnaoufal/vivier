/**
 * The top of a page outside the plane (the legal pages, the status
 * page, a form of the public frame): an optional eyebrow, the title in
 * the display face (30/36, 24/32 on phones), one sentence under it, an
 * optional row of meta (pills, a date), the actions on the right (under
 * the title on a phone). 32px of air below it. A signed-in page is a
 * `Workspace` and has no PageHeader.
 */
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
  meta,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  eyebrow?: ReactNode;
  /** A row under the title: pills, a date, a count. */
  meta?: ReactNode;
  className?: string;
}) {
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
