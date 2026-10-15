/**
 * The consultant's brief at the top of the list pane, folded: its
 * label, the text clamped to two lines, then "Voir le brief" (the page
 * answers with the full text in a sheet) and, for a member, "Modifier"
 * (the form in a sheet), as quiet links in one row. A brief without a
 * text says so in muted words. The brief is the only source of the
 * analysis: what the model derived from it stays internal.
 */
import { useId } from "react";

import type { BriefRow } from "@/lib/db/types";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const QUIET_LINK =
  "cursor-pointer rounded-sm text-meta font-medium text-ink underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function BriefText({
  brief,
  canEdit,
  onShow,
  onEdit,
  className,
}: {
  brief: Pick<BriefRow, "description">;
  canEdit: boolean;
  /** Opens the full text. */
  onShow: () => void;
  /** Opens the form. */
  onEdit: () => void;
  className?: string | undefined;
}) {
  const t = useT();
  const headingId = useId();
  const text = brief.description.trim();
  return (
    <section aria-labelledby={headingId} className={cn("px-4 pt-4 pb-3", className)}>
      <h2 id={headingId} className="label-caps">
        {t("briefs.part.brief")}
      </h2>
      <p
        className={cn(
          "mt-1.5 line-clamp-2 whitespace-pre-line text-meta break-words",
          text ? "text-ink-soft" : "text-muted-foreground",
        )}
      >
        {text || t("briefs.list.noDescription")}
      </p>
      {text || canEdit ? (
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
          {text ? (
            <button type="button" onClick={onShow} className={QUIET_LINK}>
              {t("briefs.brief.show")}
            </button>
          ) : null}
          {canEdit ? (
            <button type="button" onClick={onEdit} className={QUIET_LINK}>
              {t("common.edit")}
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
