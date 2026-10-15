/**
 * One block of the candidate sheet: a label-caps title with its count,
 * the confidence hint beside it when the structuring was unsure, an
 * action on the right (a pencil, "Tout voir", the add button), then the
 * content. The plane's block title (the same line as `Section`) with
 * the heading level the sheet chooses: h3 under the sheet's own name
 * on the pool, h2 on the candidate's page where the Workspace header
 * carries the name. `Unknown` is what the CV did not state.
 */
import type { ReactNode } from "react";

import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

import { ConfidenceHint } from "./confidence-pill";

export type BlockHeading = "h2" | "h3";

export function Block({
  title,
  as: Heading = "h3",
  count,
  hint,
  action,
  children,
  className,
}: {
  title: ReactNode;
  as?: BlockHeading | undefined;
  /** Shown after the title when above zero. */
  count?: number | undefined;
  /** The structuring's confidence on the block's field. */
  hint?: number | null | undefined;
  action?: ReactNode;
  children: ReactNode;
  className?: string | undefined;
}) {
  return (
    <section className={cn("min-w-0 space-y-2.5", className)}>
      <div className="flex min-h-8 flex-wrap items-center gap-x-3 gap-y-1">
        <Heading className="label-caps min-w-0">
          {title}
          {typeof count === "number" && count > 0 ? (
            <span className="ml-1.5 tabular-nums">{count}</span>
          ) : null}
        </Heading>
        <ConfidenceHint value={hint} />
        {action ? <div className="ml-auto flex shrink-0 items-center gap-1">{action}</div> : null}
      </div>
      {children}
    </section>
  );
}

/** What the CV did not state, in muted text: never a dash that could read as "none". */
export function Unknown() {
  const t = useT();
  return <p className="text-sm text-muted-foreground">{t("common.unknown")}</p>;
}
