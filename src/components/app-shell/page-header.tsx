/**
 * The top of every app page: an optional eyebrow, the title in the
 * display face, one sentence under it, the actions on the right (under
 * the title on a phone). 32px of air below it.
 */
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  eyebrow?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("mb-8 flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between", className)}>
      <div className="min-w-0 flex-1">
        {eyebrow ? <div className="label-caps mb-2">{eyebrow}</div> : null}
        <h1 className="font-display text-2xl leading-8 text-ink break-words sm:text-3xl sm:leading-9">{title}</h1>
        {description ? <p className="mt-2 max-w-2xl text-[15px] leading-6 text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-3">{actions}</div> : null}
    </header>
  );
}
