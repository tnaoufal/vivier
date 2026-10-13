/**
 * The candidate behind a shortlist item, in short: the summary the
 * structuring read (or that none was), the first skills, the languages,
 * the experience and availability when read, and the way to the full
 * profile page. Falls back to the board's columns while the full row loads.
 */
import { Link } from "@tanstack/react-router";
import { ExternalLink } from "lucide-react";

import { Pill } from "@/components/app-shell/pill";
import { Skeleton } from "@/components/ui/skeleton";
import { languagesLine, topSkills, yearsLabel } from "@/lib/candidates/format";
import { useI18n } from "@/lib/i18n";
import type { DrawerCandidate, ItemCandidate } from "@/lib/shortlists/queries";

export function DrawerProfile({
  candidate,
  fallback,
  loading,
}: {
  candidate: DrawerCandidate | null;
  fallback: ItemCandidate | null;
  loading: boolean;
}) {
  const { t, locale } = useI18n();
  const candidateId = candidate?.id ?? fallback?.id ?? null;
  if (!candidateId) {
    return <p className="text-sm text-muted-foreground">{t("shortlists.item.candidateGone")}</p>;
  }
  const skills = topSkills(candidate?.skills ?? fallback?.skills ?? [], 8);
  const languages = candidate ? languagesLine(candidate.languages) : "";
  const summary = candidate?.summary?.trim() ?? "";
  const years = candidate?.years_experience ?? null;
  const availability = candidate?.availability?.trim() ?? "";
  return (
    <section>
      <div className="flex items-center justify-between gap-2">
        <h3 className="label-caps">{t("shortlists.drawer.profile")}</h3>
        <Link
          to="/app/candidates/$candidateId"
          params={{ candidateId }}
          className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
        >
          {t("shortlists.drawer.openCandidate")}
          <ExternalLink className="size-3" aria-hidden="true" />
        </Link>
      </div>
      {loading && !candidate ? (
        <div className="mt-2 space-y-2" aria-busy="true">
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-5/6" />
        </div>
      ) : (
        <p className="mt-2 whitespace-pre-line text-sm text-ink">
          {summary || <span className="text-muted-foreground">{t("shortlists.drawer.summary.none")}</span>}
        </p>
      )}
      {years !== null || availability ? (
        <p className="mt-2 text-xs text-muted-foreground">
          {years !== null ? t("shortlists.drawer.experience", { years: yearsLabel(locale, years) }) : null}
          {years !== null && availability ? " · " : null}
          {availability ? t("shortlists.drawer.availability", { value: availability }) : null}
        </p>
      ) : null}
      {skills.length ? (
        <div className="mt-3">
          <h4 className="text-xs font-medium text-ink">{t("shortlists.drawer.skills")}</h4>
          <ul className="mt-1 flex flex-wrap gap-1">
            {skills.map((skill) => (
              <li key={skill}>
                <Pill tone="primary">{skill}</Pill>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {languages ? (
        <p className="mt-3 text-xs text-muted-foreground">
          <span className="font-medium text-ink">{t("shortlists.drawer.languages")}</span> · {languages}
        </p>
      ) : null}
    </section>
  );
}
