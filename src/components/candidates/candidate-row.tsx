/**
 * One line of the talent pool, the whole of it a link to the profile,
 * built for a recruiter deciding whether to open it: the photo when the
 * organisation shows photos and the CV had one (initials otherwise), the
 * name with its pills, the position held today, where and for how long
 * and when available, the three skills the CV put first, the languages
 * with their level, and the last update on the right from `sm`. Each
 * value the CV does not state is simply absent from the row (the sheet
 * says "not stated"); only the position reads so, since it is the line
 * a recruiter scans. The caller wraps the row in a list item that rises
 * in once.
 */
import { Link } from "@tanstack/react-router";
import { CircleHelp } from "lucide-react";

import { Avatar } from "@/components/app-shell/avatar";
import { Pill } from "@/components/app-shell/pill";
import {
  currentPosition,
  displayName,
  keySkills,
  languagesLine,
  metaLine,
  needsReview,
} from "@/lib/candidates/format";
import type { CandidateListRow } from "@/lib/candidates/queries";
import { usePhotoUrl } from "@/lib/candidates/use-photo-url";
import { formatDate, useI18n } from "@/lib/i18n";

export function CandidateRow({ row, showPhotos }: { row: CandidateListRow; showPhotos: boolean }) {
  const { t, locale } = useI18n();
  const name = displayName(row, t("candidates.noName"));
  const photoUrl = usePhotoUrl(row.photo_path, showPhotos);
  const position = currentPosition(row);
  const meta = metaLine(locale, row);
  const skills = keySkills(row.skills);
  const languages = languagesLine(row.languages);
  const updated = t("candidates.updated", { date: formatDate(locale, row.updated_at) });
  return (
    <Link
      to="/app/candidates/$candidateId"
      params={{ candidateId: row.id }}
      className="sheet-row items-start"
    >
      <Avatar name={name} size="lg" photoUrl={photoUrl} className="mt-0.5" decorative />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="min-w-0 truncate text-body font-semibold text-ink">{name}</span>
          {needsReview(row.confidence) ? (
            // The same mark as the sheet's "to check" hint, so one meaning has one look.
            <Pill tone="caution" icon={<CircleHelp />} size="sm">
              {t("candidates.review")}
            </Pill>
          ) : null}
          {row.source === "manual" ? <Pill size="sm">{t("candidates.source.manual")}</Pill> : null}
          {row.consent_status === "withdrawn" ? (
            <Pill tone="negative" dot size="sm">
              {t("candidates.consent.withdrawn")}
            </Pill>
          ) : null}
        </div>
        <p className="mt-0.5 truncate text-sm text-ink">
          {position ? (
            <>
              {position.title}
              {position.company ? (
                <span className="text-muted-foreground"> {t("candidates.atCompany", { company: position.company })}</span>
              ) : null}
            </>
          ) : (
            <span className="text-muted-foreground">{t("common.unknown")}</span>
          )}
        </p>
        {meta ? <p className="mt-0.5 truncate text-meta text-muted-foreground tabular-nums">{meta}</p> : null}
        {skills.length || languages ? (
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            {skills.length ? (
              <ul className="flex flex-wrap gap-1.5">
                {skills.map((skill) => (
                  <li key={skill} className="min-w-0">
                    <Pill size="sm" className="max-w-48">
                      {skill}
                    </Pill>
                  </li>
                ))}
              </ul>
            ) : null}
            {languages ? (
              <span className="min-w-0 truncate text-meta text-muted-foreground" title={languages}>
                {languages}
              </span>
            ) : null}
          </div>
        ) : null}
        <p className="mt-1.5 text-meta text-muted-foreground sm:hidden">{updated}</p>
      </div>
      <span className="hidden shrink-0 pt-0.5 text-meta text-muted-foreground tabular-nums sm:block">
        {updated}
      </span>
    </Link>
  );
}
