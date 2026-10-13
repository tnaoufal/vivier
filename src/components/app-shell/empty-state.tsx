/** What a list shows when it has nothing: an icon in a tinted disc, one sentence, the one action that fills it. */
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

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
    <div className={cn("sheet flex flex-col items-center px-6 py-16 text-center", className)}>
      {icon ? (
        <div className="mb-5 flex size-14 items-center justify-center rounded-full bg-primary/10 text-primary [&_svg]:size-6">
          {icon}
        </div>
      ) : null}
      <h2 className="max-w-md font-display text-xl text-ink break-words">{title}</h2>
      {text ? <p className="mt-2 max-w-md text-[15px] leading-6 text-muted-foreground">{text}</p> : null}
      {action ? <div className="mt-6 flex flex-wrap justify-center gap-3">{action}</div> : null}
    </div>
  );
}
