/**
 * One line of the talent pool, the whole of it a link to the profile:
 * initials, the name (or "no name" when none was read) with its pills,
 * the headline and location, the first four skills, and on the right
 * from `sm` the languages and the last update in muted 13px (under the
 * skills on a phone). The caller wraps it in the list item.
 */
import { Link } from "@tanstack/react-router";

import { Avatar } from "@/components/app-shell/avatar";
import { Pill } from "@/components/app-shell/pill";
import { displayName, languagesLine, needsReview, topSkills } from "@/lib/candidates/format";
import type { CandidateListRow } from "@/lib/candidates/queries";
import { formatDate, useI18n } from "@/lib/i18n";

export function CandidateRow({ row }: { row: CandidateListRow }) {
  const { t, locale } = useI18n();
  const name = displayName(row, t("candidates.noName"));
  const skills = topSkills(row.skills, 4);
  const languages = languagesLine(row.languages);
  const line = [row.headline, row.location].filter((part) => part && part.trim()).join(" · ");
  const updated = t("candidates.updated", { date: formatDate(locale, row.updated_at) });
  return (
    <Link
      to="/app/candidates/$candidateId"
      params={{ candidateId: row.id }}
      className="sheet-row items-start sm:items-center"
    >
      <Avatar name={name} size="lg" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="min-w-0 truncate text-[15px] font-semibold leading-6 text-ink">{name}</span>
          {needsReview(row.confidence) ? (
            <Pill tone="caution" dot>
              {t("candidates.review")}
            </Pill>
          ) : null}
          {row.source === "manual" ? <Pill>{t("candidates.source.manual")}</Pill> : null}
          {row.consent_status === "withdrawn" ? (
            <Pill tone="negative" dot>
              {t("candidates.consent.withdrawn")}
            </Pill>
          ) : null}
        </div>
        <p className="mt-0.5 truncate text-sm text-muted-foreground">{line || t("common.unknown")}</p>
        {skills.length ? (
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {skills.map((skill) => (
              <li key={skill} className="min-w-0">
                <Pill className="max-w-48">
                  <span className="min-w-0 truncate">{skill}</span>
                </Pill>
              </li>
            ))}
          </ul>
        ) : null}
        <p className="mt-2 truncate text-[13px] leading-5 text-muted-foreground sm:hidden">
          {languages ? `${languages} · ` : ""}
          {updated}
        </p>
      </div>
      <div className="hidden w-44 shrink-0 flex-col items-end text-right text-[13px] leading-5 text-muted-foreground sm:flex">
        {languages ? (
          <span className="max-w-full truncate" title={languages}>
            {languages}
          </span>
        ) : null}
        <span>{updated}</span>
      </div>
    </Link>
  );
}
