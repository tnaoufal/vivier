import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/** What a list shows when it has nothing: one sentence and the one action that fills it. */
export function EmptyState({
  icon,
  title,
  text,
  action,
  className,
}: {
  icon?: ReactNode;
  title: ReactNode;
  text?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("sheet flex flex-col items-center px-6 py-12 text-center", className)}>
      {icon ? (
        <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary [&_svg]:size-6">
          {icon}
        </div>
      ) : null}
      <h2 className="font-display text-lg text-ink">{title}</h2>
      {text ? <p className="mt-1 max-w-md text-sm text-muted-foreground">{text}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
