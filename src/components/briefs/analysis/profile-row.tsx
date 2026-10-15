/**
 * One profile as a row of the brief page's list pane, on the plane's
 * `Row`: the rank when the group ranks (the matches, the near
 * profiles), the photo (when the organisation shows photos) or the
 * initials, the name and one line (`RowText`), a mark on the right
 * (the tier, a decision pill, "À confirmer") and the row's own controls
 * beside the button, never inside it. The row is one button that
 * selects the profile for the reading pane. A candidate still being
 * read shows placeholders; an erased one says so.
 */
import type { ReactNode } from "react";

import { Avatar } from "@/components/app-shell/avatar";
import { Row, RowText } from "@/components/app-shell/row";
import { displayName } from "@/lib/candidates/format";
import { usePhotoUrl } from "@/lib/candidates/use-photo-url";
import { useT } from "@/lib/i18n";
import { useOrg } from "@/lib/org/org-context";

import type { RowCandidate } from "./use-analysis";

export function ProfileRow({
  candidate,
  line,
  rank,
  selected,
  onSelect,
  muted = false,
  mark,
  trailing,
  className,
  id,
}: {
  /** Undefined while it is read, null when the candidate was erased. */
  candidate: RowCandidate;
  /** The one line under the name: the position, the years, the place; a reason; a decision. */
  line: ReactNode;
  /** The place in a ranked list, from 1. */
  rank?: number | undefined;
  selected: boolean;
  onSelect: () => void;
  muted?: boolean | undefined;
  /** On the right of the text, inside the button: the tier, a pill, a quiet word. */
  mark?: ReactNode;
  /** The row's controls, beside the button. */
  trailing?: ReactNode;
  className?: string | undefined;
  /** The row's id, which the list scrolls into view when the keys move the selection. */
  id?: string | undefined;
}) {
  const t = useT();
  const { showPhotos } = useOrg();
  const photoUrl = usePhotoUrl(candidate?.photo_path ?? null, showPhotos && Boolean(candidate));
  const loading = candidate === undefined;
  const name = candidate
    ? displayName(candidate, t("briefs.results.noName"))
    : candidate === null
      ? t("briefs.results.gone")
      : "";

  return (
    <Row
      id={id}
      as="button"
      height="sm"
      selected={selected}
      muted={muted}
      onClick={onSelect}
      className={className}
      leading={
        <>
          {rank !== undefined ? (
            <span className="w-5 shrink-0 text-right text-meta text-muted-foreground tabular-nums">
              {rank}
            </span>
          ) : null}
          <Avatar name={name} size="md" photoUrl={photoUrl} decorative />
        </>
      }
      trailing={trailing}
    >
      {loading ? (
        <span className="block min-w-0 flex-1 space-y-1.5" aria-hidden="true">
          <span className="skeleton block h-3.5 w-32 max-w-full rounded-sm" />
          <span className="skeleton block h-3 w-44 max-w-full rounded-sm" />
        </span>
      ) : (
        <RowText
          title={candidate ? name : <span className="text-muted-foreground">{name}</span>}
          line={line}
        />
      )}
      {mark ? <span className="flex shrink-0 items-center gap-1.5">{mark}</span> : null}
    </Row>
  );
}
