/**
 * A vertical timeline, for the experiences of a candidate: a rail with a
 * dot per item, the dates on the left from `sm` (above the content on a
 * phone), the content on the right. The current position has a filled
 * dot. Items rise in one after the other.
 */
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export function Timeline({ children, className }: { children: ReactNode; className?: string }) {
  return <ol className={cn("stagger relative", className)}>{children}</ol>;
}

export function TimelineItem({
  when,
  title,
  subtitle,
  current = false,
  children,
  className,
}: {
  /** The period ("2021 – 2024", "Depuis 2024"), in the meta style. */
  when: ReactNode;
  title: ReactNode;
  /** The organisation, the place. */
  subtitle?: ReactNode;
  /** The position held today: a filled dot. */
  current?: boolean;
  /** The body: a sentence or two, bullet points. */
  children?: ReactNode;
  className?: string;
}) {
  return (
    <li
      className={cn(
        "rise-in relative grid grid-cols-[1.25rem_minmax(0,1fr)] gap-x-3 pb-8 last:pb-0 sm:grid-cols-[7rem_1.25rem_minmax(0,1fr)] sm:gap-x-4",
        // The rail: a hairline from under this dot down to the next one, centred on the 20px dot
        // column (10px in; from `sm`, after the 7rem dates and the 1rem gap: 8rem + 10px).
        "before:absolute before:bottom-0 before:left-2.5 before:top-4.5 before:w-px before:-translate-x-1/2 before:bg-border last:before:hidden sm:before:left-34.5",
        className,
      )}
    >
      <span className="hidden min-w-0 pt-0.5 text-meta text-muted-foreground tabular-nums sm:block">
        {when}
      </span>
      <span className="flex justify-center pt-2">
        <span
          aria-hidden="true"
          className={cn(
            "size-2.5 shrink-0 rounded-full border-2 border-primary",
            current ? "bg-primary ring-4 ring-primary/15" : "bg-card",
          )}
        />
      </span>
      <div className="min-w-0">
        <span className="block text-meta text-muted-foreground tabular-nums sm:hidden">{when}</span>
        <h3 className="text-body font-semibold text-ink break-words">{title}</h3>
        {subtitle ? <p className="text-sm text-muted-foreground break-words">{subtitle}</p> : null}
        {children ? (
          <div className="mt-2 text-sm leading-6 text-ink/85 break-words">{children}</div>
        ) : null}
      </div>
    </li>
  );
}
