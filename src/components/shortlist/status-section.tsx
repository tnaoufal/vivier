/**
 * One of the three columns of a shortlist board (to review, retained,
 * dismissed): a header that stays at the top while the column scrolls,
 * with a dot in the column's tone, the title and the count, and a
 * button that folds the column; the cards under it rising in one after
 * the other; a sentence when it is empty. The column has no box of its
 * own: the cards are the sheets.
 */
import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

import type { ShortlistItemStatus } from "@/lib/db/types";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const DOTS: Record<ShortlistItemStatus, string> = {
  to_review: "bg-primary",
  retained: "bg-positive",
  dismissed: "bg-negative",
};

export function StatusSection({
  status,
  count,
  children,
}: {
  status: ShortlistItemStatus;
  count: number;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(true);
  const id = `shortlist-section-${status}`;
  return (
    <section className="min-w-0" aria-labelledby={`${id}-title`}>
      <div className="sticky top-16 z-sticky -mx-1 bg-background/85 px-1 py-1 backdrop-blur lg:top-0">
        {/* The heading wraps the button (not the reverse): a button holds phrasing content only. */}
        <h2 id={`${id}-title`} className="font-display text-lg text-ink">
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            aria-controls={id}
            className="press flex min-h-10 w-full cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            title={open ? t("shortlists.section.collapse") : t("shortlists.section.expand")}
          >
            <span aria-hidden="true" className={cn("size-2 shrink-0 rounded-full", DOTS[status])} />
            <span className="min-w-0 truncate">{t(`shortlists.status.${status}`)}</span>
            <span className="font-sans text-base font-normal text-muted-foreground tabular-nums">{count}</span>
            <ChevronDown
              className={cn(
                "ml-auto size-4 shrink-0 text-muted-foreground transition-transform duration-base ease-out-soft",
                open ? "" : "-rotate-90",
              )}
              aria-hidden="true"
            />
          </button>
        </h2>
      </div>
      <div id={id} hidden={!open} className="mt-2">
        {count === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
            {t(`shortlists.section.empty.${status}`)}
          </p>
        ) : (
          <ul className="stagger space-y-6">{children}</ul>
        )}
      </div>
    </section>
  );
}
