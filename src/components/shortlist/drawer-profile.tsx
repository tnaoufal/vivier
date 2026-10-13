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
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold leading-6 text-ink">{t("shortlists.drawer.profile")}</h3>
        <Link
          to="/app/candidates/$candidateId"
          params={{ candidateId }}
          className="inline-flex items-center gap-1 text-[13px] font-medium leading-5 text-primary hover:underline"
        >
          {t("shortlists.drawer.openCandidate")}
          <ExternalLink className="size-3.5" aria-hidden="true" />
        </Link>
      </div>
      {loading && !candidate ? (
        <div className="space-y-2" aria-busy="true">
          <Skeleton className="h-3.5 w-full" />
          <Skeleton className="h-3.5 w-5/6" />
        </div>
      ) : (
        <p className="whitespace-pre-line text-[15px] leading-6 text-ink break-words">
          {summary || <span className="text-muted-foreground">{t("shortlists.drawer.summary.none")}</span>}
        </p>
      )}
      {years !== null || availability ? (
        <p className="text-[13px] leading-5 text-muted-foreground">
          {years !== null ? t("shortlists.drawer.experience", { years: yearsLabel(locale, years) }) : null}
          {years !== null && availability ? " · " : null}
          {availability ? t("shortlists.drawer.availability", { value: availability }) : null}
        </p>
      ) : null}
      {skills.length ? (
        <div>
          <h4 className="label-caps">{t("shortlists.drawer.skills")}</h4>
          <ul className="mt-1.5 flex flex-wrap gap-1.5">
            {skills.map((skill) => (
              <li key={skill} className="min-w-0">
                <Pill className="max-w-56">
                  <span className="min-w-0 truncate">{skill}</span>
                </Pill>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {languages ? (
        <div>
          <h4 className="label-caps">{t("shortlists.drawer.languages")}</h4>
          <p className="mt-1 text-[15px] leading-6 text-ink break-words">{languages}</p>
        </div>
      ) : null}
    </section>
  );
}
