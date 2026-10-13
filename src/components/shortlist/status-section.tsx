/**
 * One of the three columns of a shortlist board (to review, retained,
 * dismissed): a header with the count that folds the section on a
 * phone, the cards under it, a sentence when it is empty.
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
    <section className="sheet min-w-0 overflow-hidden" aria-labelledby={`${id}-title`}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={id}
        className="flex w-full items-center gap-2 px-4 py-3 text-left hover:bg-accent/40"
        title={open ? t("shortlists.section.collapse") : t("shortlists.section.expand")}
      >
        <h2 id={`${id}-title`} className="font-display text-base text-ink">
          {t(`shortlists.status.${status}`)}
        </h2>
        <Pill tone={TONES[status]}>{count}</Pill>
        <ChevronDown
          className={cn("ml-auto size-4 text-muted-foreground transition-transform", open ? "" : "-rotate-90")}
          aria-hidden="true"
        />
      </button>
      <div id={id} hidden={!open} className="border-t border-border p-3">
        {count === 0 ? (
          <p className="px-1 py-4 text-center text-sm text-muted-foreground">{t(`shortlists.section.empty.${status}`)}</p>
        ) : (
          <ul className="space-y-3">{children}</ul>
        )}
      </div>
    </section>
  );
}
