/**
 * A section of a page: a title on the left with an optional count, an
 * optional action on the right, then its content. The one way every
 * page groups what it shows, so the rhythm is the same everywhere. `id`
 * lets a sticky header or a link jump to it.
 */
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export function Section({
  title,
  count,
  description,
  action,
  children,
  className,
  id,
}: {
  title: ReactNode;
  count?: number | undefined;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string | undefined;
}) {
  return (
    <section id={id} className={cn("space-y-4 scroll-mt-24", className)}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-display text-xl text-ink">
            {title}
            {typeof count === "number" ? (
              <span className="ml-2 font-sans text-base font-normal text-muted-foreground tabular-nums">
                {count}
              </span>
            ) : null}
          </h2>
          {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {action ? <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div> : null}
      </div>
      {children}
    </section>
  );
}
