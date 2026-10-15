/**
 * One line of the talent pool, 64px, the whole of it a link to the
 * profile, built for a recruiter deciding whether to open it: the photo
 * when the organisation shows photos and the CV had one (the initials
 * otherwise), the name with the position held today, then one line
 * that reads the seniority first, the place, and the three skills the
 * CV put first; the last update on the right from `sm`. A fact the CV
 * does not state is simply absent from the row (the sheet says "not
 * stated"); an archived profile, listed on demand, carries the one pill
 * that tells it apart. The caller wraps the row in a list item that
 * rises in once.
 */
import { Link } from "@tanstack/react-router";

import { Avatar } from "@/components/app-shell/avatar";
import { Pill } from "@/components/app-shell/pill";
import { currentPosition, displayName, listLine } from "@/lib/candidates/format";
import type { CandidateListRow } from "@/lib/candidates/queries";
import { usePhotoUrl } from "@/lib/candidates/use-photo-url";
import { formatDate, useI18n } from "@/lib/i18n";

export function CandidateRow({ row, showPhotos }: { row: CandidateListRow; showPhotos: boolean }) {
  const { t, locale } = useI18n();
  const name = displayName(row, t("candidates.noName"));
  const photoUrl = usePhotoUrl(row.photo_path, showPhotos);
  const position = currentPosition(row);
  const line = listLine(locale, row);
  const updated = formatDate(locale, row.updated_at);
  return (
    <Link
      to="/app/candidates/$candidateId"
      params={{ candidateId: row.id }}
      className="sheet-row gap-3 py-3"
    >
      <Avatar name={name} size="sm" photoUrl={photoUrl} decorative />
      <div className="min-w-0 flex-1">
        <p className="flex min-w-0 items-center gap-x-2 text-sm leading-5">
          <span className="min-w-0 truncate font-semibold text-ink">{name}</span>
          {position ? (
            <span className="min-w-0 truncate text-ink">
              {position.title}
              {position.company ? (
                <span className="text-muted-foreground">
                  {" "}
                  {t("candidates.atCompany", { company: position.company })}
                </span>
              ) : null}
            </span>
          ) : null}
          {row.status === "archived" ? (
            <Pill size="sm" className="shrink-0">
              {t("candidates.status.archived")}
            </Pill>
          ) : null}
        </p>
        {/* Kept at its height when the CV states none of it, so every row measures the same. */}
        <p className="min-h-5 truncate text-sm leading-5 text-muted-foreground tabular-nums">
          {line}
        </p>
      </div>
      <time
        dateTime={row.updated_at}
        className="hidden shrink-0 text-meta text-muted-foreground tabular-nums sm:block"
      >
        <span className="sr-only">{t("candidates.updated", { date: updated })}</span>
        <span aria-hidden="true">{updated}</span>
      </time>
    </Link>
  );
}
