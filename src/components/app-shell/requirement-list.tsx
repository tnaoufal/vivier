/**
 * One row per requirement of a brief: the mark (met, partially met, not
 * met, the CV says nothing), the label, and the evidence in muted text.
 * Colour is never the only signal: each mark is an icon with a text
 * alternative. Used by the search results, the shortlist drawer and the
 * dossier a link opens (`compact` for the dossier's print layout).
 */
import { Check, CircleHelp, Minus, X } from "lucide-react";

import type { RequirementMet } from "@/lib/db/types";
import { cn } from "@/lib/utils";

export interface RequirementRow {
  id: string;
  label: string;
  required: boolean;
  met: RequirementMet;
  evidence: string | null;
}

const MARKS: Record<RequirementMet, { icon: typeof Check; className: string }> = {
  yes: { icon: Check, className: "bg-positive/12 text-positive" },
  partial: { icon: Minus, className: "bg-caution/15 text-caution-foreground dark:text-caution" },
  no: { icon: X, className: "bg-negative/12 text-negative" },
  unknown: { icon: CircleHelp, className: "bg-muted text-muted-foreground" },
};

export function RequirementMark({ met, label, className }: { met: RequirementMet; label: string; className?: string }) {
  const mark = MARKS[met];
  const Icon = mark.icon;
  return (
    <span
      className={cn("inline-flex size-6 shrink-0 items-center justify-center rounded-full [&_svg]:size-3.5", mark.className, className)}
      role="img"
      aria-label={label}
      title={label}
    >
      <Icon aria-hidden="true" />
    </span>
  );
}

export function RequirementList({
  rows,
  markLabel,
  requiredLabel,
  compact = false,
  className,
}: {
  rows: readonly RequirementRow[];
  /** The sentence of a mark ("Satisfait", "Non renseigné"...), for assistive technologies. */
  markLabel: (met: RequirementMet) => string;
  /** The word shown after a required requirement's label. */
  requiredLabel: string;
  compact?: boolean;
  className?: string;
}) {
  if (!rows.length) return null;
  return (
    <ul className={cn("divide-y divide-border", className)}>
      {rows.map((row) => (
        <li key={row.id} className={cn("flex items-start gap-3", compact ? "py-2" : "py-3")}>
          <RequirementMark met={row.met} label={markLabel(row.met)} className="mt-0.5" />
          <div className="min-w-0 flex-1">
            <p className={cn("text-ink", compact ? "text-sm" : "text-[15px] leading-6")}>
              {row.label}
              {row.required ? <span className="ml-2 text-[13px] text-muted-foreground">{requiredLabel}</span> : null}
            </p>
            {row.evidence ? <p className="mt-0.5 text-sm text-muted-foreground">{row.evidence}</p> : null}
          </div>
        </li>
      ))}
    </ul>
  );
}
