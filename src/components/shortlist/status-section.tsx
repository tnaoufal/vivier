/**
 * One of the three columns of a shortlist board (to review, retained,
 * dismissed): a header with the count as a pill that folds the column,
 * the cards under it with air between them, a sentence when it is
 * empty. The column has no box of its own: the cards are the sheets.
 */
import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

import { Pill, type PillTone } from "@/components/app-shell/pill";
import type { ShortlistItemStatus } from "@/lib/db/types";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const TONES: Record<ShortlistItemStatus, PillTone> = {
  to_review: "primary",
  retained: "positive",
  dismissed: "negative",
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
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={id}
        className="flex w-full cursor-pointer items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors duration-150 ease-out-soft hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        title={open ? t("shortlists.section.collapse") : t("shortlists.section.expand")}
      >
        <h2 id={`${id}-title`} className="min-w-0 truncate font-display text-xl text-ink">
          {t(`shortlists.status.${status}`)}
        </h2>
        <Pill tone={TONES[status]} dot>
          {count}
        </Pill>
        <ChevronDown
          className={cn("ml-auto size-4 shrink-0 text-muted-foreground transition-transform duration-150", open ? "" : "-rotate-90")}
          aria-hidden="true"
        />
      </button>
      <div id={id} hidden={!open} className="mt-3">
        {count === 0 ? (
          <p className="rounded-2xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
            {t(`shortlists.section.empty.${status}`)}
          </p>
        ) : (
          <ul className="space-y-4">{children}</ul>
        )}
      </div>
    </section>
  );
}
