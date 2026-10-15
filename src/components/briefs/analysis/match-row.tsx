/**
 * One profile of an analysis as a 64px row: its rank, the photo (when
 * the organisation shows photos) or the initials, the name and the
 * position held today, one line that tells it apart (why it ranks
 * there, or its main reservation for a near profile; from `md`, the
 * drawer says it on a phone), the tier the ranking gave as its letter
 * (or the quiet word "À confirmer" while the second opinion has not
 * seen a match yet), and the way to the shortlist (a check once added).
 * No ring: the figure lives in the drawer. The row is one button that
 * opens the profile's drawer; the shortlist button sits beside it,
 * never inside it. A candidate still being read shows placeholders, an
 * erased one says so. It renders the row's content; the list draws the
 * row itself.
 */
import { Check, ListPlus } from "lucide-react";
import { useState } from "react";

import { Avatar } from "@/components/app-shell/avatar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { tierOf } from "@/lib/briefs/assessment";
import { currentPosition, displayName } from "@/lib/candidates/format";
import { usePhotoUrl } from "@/lib/candidates/use-photo-url";
import type { MatchResult } from "@/lib/db/types";
import { useT } from "@/lib/i18n";
import { useOrg } from "@/lib/org/org-context";
import { cn } from "@/lib/utils";

import { TierPill } from "../tier-pill";

import type { RowCandidate } from "./use-analysis";

export function MatchRow({
  result,
  rank,
  candidate,
  line,
  muted = false,
  unconfirmed = false,
  doubted = false,
  added,
  canAdd,
  onOpen,
  onAdd,
}: {
  result: MatchResult;
  /** The place in its list, from 1. */
  rank: number;
  /** Undefined while it is read, null when the candidate was erased. */
  candidate: RowCandidate;
  /** The one line under the name: the synthesis, a reservation, a count. */
  line: string | null;
  /** A near profile: quieter text, no tier. */
  muted?: boolean | undefined;
  /** A match the second opinion has not seen yet (a run under way or stopped): it may still leave the list. */
  unconfirmed?: boolean | undefined;
  /** A match the second opinion doubted on the seniority, a contradiction or the context: kept for the team to weigh, marked. */
  doubted?: boolean | undefined;
  added: boolean;
  /** True when the person may add to the shortlist. */
  canAdd: boolean;
  onOpen: () => void;
  onAdd: () => Promise<void>;
}) {
  const t = useT();
  const { showPhotos } = useOrg();
  const photoUrl = usePhotoUrl(candidate?.photo_path ?? null, showPhotos && Boolean(candidate));
  const [busy, setBusy] = useState(false);
  const loading = candidate === undefined;
  const name = candidate
    ? displayName(candidate, t("briefs.results.noName"))
    : t("briefs.results.gone");
  const position = candidate ? currentPosition(candidate) : null;
  const tier = muted ? null : tierOf(result);
  const addLabel = added ? t("briefs.match.addedLabel") : t("briefs.results.addToShortlist");

  async function add() {
    if (busy || added) return;
    setBusy(true);
    try {
      await onAdd();
    } finally {
      setBusy(false);
    }
  }

  // The list item around it (match-list.tsx) lays the button and the shortlist action side by side.
  return (
    <>
      <button
        type="button"
        onClick={onOpen}
        className="flex min-h-16 min-w-0 flex-1 cursor-pointer items-center gap-3 py-3 pl-4 pr-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:gap-4 sm:pl-6"
      >
        <span className="w-5 shrink-0 text-right text-meta text-muted-foreground tabular-nums">
          {rank}
        </span>
        <Avatar name={loading ? "" : name} size="sm" photoUrl={photoUrl} decorative />
        <span className="min-w-0 flex-1 md:flex md:items-center md:gap-6">
          {loading ? (
            <span className="block space-y-2 md:w-44 md:shrink-0 xl:w-56">
              <Skeleton className="h-3.5 w-32" />
              <Skeleton className="h-3 w-44 max-w-full" />
            </span>
          ) : (
            <span className="block min-w-0 md:w-44 md:shrink-0 xl:w-56">
              <span
                className={cn(
                  "block truncate text-sm font-medium",
                  candidate ? "text-ink" : "text-muted-foreground",
                )}
              >
                {name}
              </span>
              <span className="block truncate text-sm text-muted-foreground">
                {position
                  ? position.company
                    ? `${position.title} @ ${position.company}`
                    : position.title
                  : t("common.unknown")}
              </span>
            </span>
          )}
          {line ? (
            <span
              className={cn(
                "hidden min-w-0 text-sm md:line-clamp-1 md:flex-1",
                muted ? "text-muted-foreground" : "text-ink",
              )}
            >
              {line}
            </span>
          ) : null}
        </span>
        {unconfirmed ? (
          <span className="shrink-0 text-meta text-muted-foreground">
            {t("briefs.match.unconfirmed")}
          </span>
        ) : (
          <>
            {doubted ? (
              <span className="shrink-0 text-meta font-medium text-ink">
                {t("briefs.match.doubt")}
              </span>
            ) : null}
            {tier ? (
              <span className="shrink-0">
                <TierPill tier={tier} compact />
              </span>
            ) : null}
          </>
        )}
      </button>
      <div className="flex w-12 shrink-0 justify-center pr-2 sm:w-14 sm:pr-4">
        {canAdd && candidate ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={addLabel}
                aria-disabled={added || busy}
                onClick={() => void add()}
                className={cn(added && "cursor-default hover:bg-transparent")}
              >
                {added ? <Check aria-hidden="true" /> : <ListPlus aria-hidden="true" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{added ? t("briefs.match.added") : addLabel}</TooltipContent>
          </Tooltip>
        ) : null}
      </div>
    </>
  );
}
