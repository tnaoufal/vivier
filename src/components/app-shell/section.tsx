/**
 * A block of a page or a pane: a label-caps title with an optional
 * count, an optional action on the right, then its content. The one
 * way every page groups what it shows (blocks sit 24px apart in a
 * `gap-6` column), so the rhythm is the same everywhere. `id` lets a
 * link jump to it.
 */
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export function Section({
  title,
  count,
  action,
  children,
  className,
  id,
}: {
  title: ReactNode;
  count?: number | undefined;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string | undefined;
}) {
  return (
    <section id={id} className={cn("space-y-3 scroll-mt-24", className)}>
      <div className="flex min-h-8 flex-wrap items-center justify-between gap-3">
        <h2 className="label-caps min-w-0">
          {title}
          {typeof count === "number" ? <span className="ml-1.5 tabular-nums">{count}</span> : null}
        </h2>
        {action ? <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div> : null}
      </div>
      {children}
    </section>
  );
}
