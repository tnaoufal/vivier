/**
 * The consultant's brief on its page, folded: one sheet with the text
 * clamped to three lines, "Voir le brief" to unfold it and "Replier"
 * to fold it back (shown only when three lines do not hold it, which
 * is measured, not guessed: a phone clips what a desk shows), and
 * "Modifier" for a member, which the page answers with its drawer. A
 * brief without a text says so in muted words. The brief is the only
 * source of the analysis: what the model derived from it stays
 * internal.
 */
import { useId, useLayoutEffect, useRef, useState } from "react";
import { Pencil } from "lucide-react";

import { QuietButton } from "@/components/briefs/analysis/quiet-button";
import { Button } from "@/components/ui/button";
import type { BriefRow } from "@/lib/db/types";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export function BriefText({
  brief,
  canEdit,
  onEdit,
}: {
  brief: Pick<BriefRow, "description">;
  canEdit: boolean;
  onEdit: () => void;
}) {
  const t = useT();
  const headingId = useId();
  const textId = useId();
  const [open, setOpen] = useState(false);
  const [clipped, setClipped] = useState(false);
  const textRef = useRef<HTMLParagraphElement>(null);
  const text = brief.description.trim();

  // Whether three lines hold the whole text, measured on the folded
  // paragraph and again when its width changes; unfolded, the toggle
  // stays so the text can be folded back.
  useLayoutEffect(() => {
    const element = textRef.current;
    if (!element || open) return undefined;
    const measure = () => setClipped(element.scrollHeight > element.clientHeight + 1);
    measure();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [open, text]);

  const toggle = clipped || open;
  return (
    <section aria-labelledby={headingId} className="sheet space-y-3 p-6">
      <h2 id={headingId} className="sr-only">
        {t("briefs.part.brief")}
      </h2>
      <p
        ref={textRef}
        id={textId}
        className={cn(
          "whitespace-pre-line text-body break-words",
          text ? "text-ink" : "text-muted-foreground",
          !open && "line-clamp-3",
        )}
      >
        {text || t("briefs.list.noDescription")}
      </p>
      {toggle || canEdit ? (
        <div className="-mb-2 -ml-3 flex flex-wrap items-center gap-1">
          {toggle ? (
            <QuietButton
              label={open ? t("briefs.brief.fold") : t("briefs.brief.show")}
              expanded={open}
              controls={textId}
              onClick={() => setOpen((value) => !value)}
            />
          ) : null}
          {canEdit ? (
            <Button
              type="button"
              variant="ghost"
              icon={<Pencil />}
              onClick={onEdit}
              className="px-3 text-muted-foreground hover:text-ink"
            >
              {t("common.edit")}
            </Button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
