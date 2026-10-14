/**
 * The earlier analyses of a brief behind one quiet button: a menu that
 * lists each run with its date, its method (the whole pool, or the
 * closest profiles of an older analysis, or the text alone) and how
 * many profiles matched, the one on screen marked; choosing one opens
 * it in place of the current view. Shown only when there is more than
 * one analysis to choose from.
 */
import { ChevronDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatCount } from "@/lib/candidates/format";
import type { SearchSummary } from "@/lib/briefs/queries";
import { formatDateTime, useI18n } from "@/lib/i18n";

export function PreviousAnalysesMenu({
  searches,
  currentId,
  disabled,
  onOpen,
}: {
  searches: readonly SearchSummary[];
  currentId: string | null;
  disabled: boolean;
  onOpen: (searchId: string) => void;
}) {
  const { t, locale } = useI18n();
  if (searches.length < 2) return null;

  function matchesText(count: number): string {
    if (count === 0) return t("briefs.search.line.present.none");
    if (count === 1) return t("briefs.search.line.present.one");
    return t("briefs.search.line.present.many", { count: formatCount(locale, count) });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          disabled={disabled}
          className="group px-3 text-muted-foreground hover:text-ink data-[state=open]:text-ink"
        >
          {t("briefs.analysis.previous")}
          <ChevronDown
            aria-hidden="true"
            className="transition-transform duration-base ease-out-soft group-data-[state=open]:rotate-180"
          />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-88 max-w-[calc(100vw-2rem)]">
        <DropdownMenuRadioGroup
          value={currentId ?? ""}
          onValueChange={(value) => {
            if (value && value !== currentId) onOpen(value);
          }}
        >
          {searches.map((search) => (
            <DropdownMenuRadioItem key={search.id} value={search.id} className="gap-3">
              <span className="min-w-0 flex-1 truncate">
                {`${formatDateTime(locale, search.created_at)} · ${t(`briefs.analysis.method.${search.method}`)}`}
              </span>
              <span className="shrink-0 text-meta text-muted-foreground tabular-nums">
                {matchesText(search.match_count)}
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
