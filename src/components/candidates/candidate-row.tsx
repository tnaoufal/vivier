/**
 * One line of the talent pool: initials, the name (or "no name" when
 * none was read), the headline and location, the first skills, the
 * languages, the last update, and a "to check" pill when the
 * structuring was unsure about any field.
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
  return (
    <li className="border-b border-border last:border-b-0">
      <Link
        to="/app/candidates/$candidateId"
        params={{ candidateId: row.id }}
        className="flex gap-3 px-4 py-3 transition-colors hover:bg-accent/40 focus-visible:bg-accent/40 focus-visible:outline-none"
      >
        <Avatar name={name} size="lg" className="mt-0.5" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="truncate font-medium text-ink">{name}</span>
            {needsReview(row.confidence) ? <Pill tone="caution">{t("candidates.review")}</Pill> : null}
            {row.source === "manual" ? <Pill>{t("candidates.source.manual")}</Pill> : null}
            {row.consent_status === "withdrawn" ? <Pill tone="negative">{t("candidates.consent.withdrawn")}</Pill> : null}
          </div>
          <p className="truncate text-sm text-muted-foreground">{line || t("common.unknown")}</p>
          {skills.length ? (
            <ul className="mt-1.5 flex flex-wrap gap-1">
              {skills.map((skill) => (
                <li key={skill}>
                  <Pill tone="primary">{skill}</Pill>
                </li>
              ))}
            </ul>
          ) : null}
          <p className="mt-1 truncate text-xs text-muted-foreground">
            {languages ? `${languages} · ` : ""}
            {t("candidates.updated", { date: formatDate(locale, row.updated_at) })}
          </p>
        </div>
      </Link>
    </li>
  );
}
