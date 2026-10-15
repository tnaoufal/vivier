/**
 * The rows of the profiles an analysis did not read in full: the ones
 * the triage set aside (in their drawer) and the near ones the
 * screening scored but the promotion did not take (under the near
 * toggle of the matches tab). One compact row each: the photo (when the
 * organisation shows photos) or the initials, the name and the position
 * held today, one line that says why it stands there (the triage's
 * reason, the screening's score and reason, a missing must-have); the
 * row leads to the profile, and beside it, when a person may, the way
 * to have it read in full anyway ("Lire quand même": the model
 * proposed, a person decides). A page rises in once, one row after the
 * other; "Voir plus" is the quiet button under a list read page by
 * page. A candidate still being read shows placeholders; an erased one
 * says so and leads nowhere.
 */
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { FileSearch } from "lucide-react";

import { Avatar } from "@/components/app-shell/avatar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { candidatePath } from "@/lib/briefs/paths";
import { SET_ASIDE_PAGE } from "@/lib/briefs/presentation";
import { currentPosition, displayName } from "@/lib/candidates/format";
import { usePhotoUrl } from "@/lib/candidates/use-photo-url";
import { useT } from "@/lib/i18n";
import { staggerVars } from "@/lib/motion";
import { useOrg } from "@/lib/org/org-context";
import { cn } from "@/lib/utils";

import type { RowCandidate } from "./use-analysis";

/** One row as a list draws it: who, the line that says why, and the way to read it in full when a person may. */
export interface ShownRow {
  candidateId: string;
  line: string;
  onReadAnyway?: (() => Promise<void>) | undefined;
}

/** The rows of a list; each page rises in once, one row after the other. */
export function AsideRows({
  rows,
  candidateOf,
  muted = false,
  onOpen,
}: {
  rows: readonly ShownRow[];
  candidateOf: (candidateId: string) => RowCandidate;
  /** Quieter text (the near profiles under their toggle). */
  muted?: boolean | undefined;
  /** Called when a row leads to a profile (a drawer closes itself). */
  onOpen?: (() => void) | undefined;
}) {
  return (
    <ul className="-mx-2 divide-y divide-border">
      {rows.map((row, index) => (
        <li
          key={row.candidateId}
          className="rise-in min-w-0"
          style={staggerVars(index % SET_ASIDE_PAGE)}
        >
          <AsideRow
            candidate={candidateOf(row.candidateId)}
            line={row.line}
            muted={muted}
            onOpen={onOpen}
            onReadAnyway={row.onReadAnyway}
          />
        </li>
      ))}
    </ul>
  );
}

/** "Voir plus": a quiet button under its list, held while the next page is read. */
export function MoreButton({
  busy = false,
  onClick,
}: {
  busy?: boolean | undefined;
  onClick: () => void;
}) {
  const t = useT();
  return (
    <Button
      type="button"
      variant="ghost"
      onClick={onClick}
      disabled={busy}
      aria-busy={busy || undefined}
      className="-ml-3 px-3 text-muted-foreground hover:text-ink"
    >
      {t("briefs.setAside.more")}
    </Button>
  );
}

export function AsideRow({
  candidate,
  line,
  muted = false,
  onOpen,
  onReadAnyway,
}: {
  /** Undefined while it is read, null when the candidate was erased. */
  candidate: RowCandidate;
  line: string;
  muted?: boolean | undefined;
  onOpen?: (() => void) | undefined;
  onReadAnyway?: (() => Promise<void>) | undefined;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const { showPhotos } = useOrg();
  const photoUrl = usePhotoUrl(candidate?.photo_path ?? null, showPhotos && Boolean(candidate));
  const loading = candidate === undefined;
  const name = candidate
    ? displayName(candidate, t("briefs.results.noName"))
    : t("briefs.results.gone");
  const position = candidate ? currentPosition(candidate) : null;

  const content = (
    <>
      <Avatar name={loading ? "" : name} size="md" photoUrl={photoUrl} decorative />
      <span className="min-w-0 flex-1 md:flex md:items-center md:gap-6">
        {loading ? (
          <span className="block space-y-2 md:w-48 md:shrink-0">
            <Skeleton className="h-3.5 w-32" />
            <Skeleton className="h-3 w-40 max-w-full" />
          </span>
        ) : (
          <span className="block min-w-0 md:w-48 md:shrink-0">
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
        <span
          className={cn(
            "mt-0.5 line-clamp-2 min-w-0 text-sm md:mt-0 md:flex-1",
            muted ? "text-muted-foreground" : "text-ink",
          )}
        >
          {line}
        </span>
      </span>
    </>
  );

  const row = "flex min-w-0 items-center gap-3 px-2 py-3 sm:gap-4";
  if (!candidate) return <div className={row}>{content}</div>;
  const link = (
    <Link
      to={candidatePath(candidate.id)}
      onClick={onOpen}
      className={cn(
        row,
        "min-w-0 flex-1 rounded-sm transition-colors duration-fast ease-out-soft hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
      )}
    >
      {content}
    </Link>
  );
  if (!onReadAnyway) return link;
  const label = t("briefs.setAside.readAnyway");
  async function readAnyway() {
    if (busy || !onReadAnyway) return;
    setBusy(true);
    try {
      await onReadAnyway();
    } finally {
      setBusy(false);
    }
  }
  // The button sits beside the link, never inside it.
  return (
    <div className="flex min-w-0 items-center gap-1">
      {link}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={label}
            disabled={busy}
            aria-busy={busy || undefined}
            onClick={() => void readAnyway()}
            className="shrink-0 text-muted-foreground hover:text-ink"
          >
            <FileSearch aria-hidden="true" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </div>
  );
}
