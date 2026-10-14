/**
 * The profile tab of the drawer: who this person is, in short. The three
 * facts that place a profile (location, years of experience,
 * availability), each "not stated" when the CV gave nothing (so is a
 * missing summary, skill list or language); the summary the structuring
 * read; eight skills, the ones the brief names first,
 * with the rest counted, never a wall of chips; the languages; and the
 * way to the full profile page. Falls back to the board's columns while
 * the full row loads.
 */
import { Link } from "@tanstack/react-router";
import { UserRound } from "lucide-react";

import { Pill } from "@/components/app-shell/pill";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { languagesLine, topSkills, yearsLabel } from "@/lib/candidates/format";
import { SKILLS_SHOWN } from "@/lib/candidates/skills";
import type { BriefCriterion } from "@/lib/db/types";
import { useI18n } from "@/lib/i18n";
import type { DrawerCandidate, ItemCandidate } from "@/lib/shortlists/queries";
import { relevantFirst } from "@/lib/shortlists/skills";

function Fact({ label, value }: { label: string; value: string }) {
  const { t } = useI18n();
  return (
    <div className="min-w-0">
      <dt className="label-caps">{label}</dt>
      <dd className={value ? "mt-0.5 text-body text-ink break-words" : "mt-0.5 text-body text-muted-foreground"}>
        {value || t("common.unknown")}
      </dd>
    </div>
  );
}

export function DrawerProfile({
  candidate,
  fallback,
  loading,
  criteria,
}: {
  candidate: DrawerCandidate | null;
  fallback: ItemCandidate | null;
  loading: boolean;
  /** The brief's criteria: the skills its skill criteria name come first. */
  criteria: readonly BriefCriterion[];
}) {
  const { t, locale } = useI18n();
  const candidateId = candidate?.id ?? fallback?.id ?? null;
  if (!candidateId) {
    return <p className="text-sm text-muted-foreground">{t("shortlists.item.candidateGone")}</p>;
  }
  const stored = candidate?.skills ?? fallback?.skills ?? [];
  const allSkills = relevantFirst(topSkills(stored, stored.length), criteria);
  const skills = allSkills.slice(0, SKILLS_SHOWN);
  const more = allSkills.length - skills.length;
  const languages = candidate ? languagesLine(candidate.languages) : "";
  const summary = candidate?.summary?.trim() ?? "";
  const location = candidate?.location?.trim() ?? fallback?.location?.trim() ?? "";
  const years = yearsLabel(locale, candidate?.years_experience);
  const availability = candidate?.availability?.trim() ?? "";
  return (
    <div className="space-y-8">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
        <Fact label={t("shortlists.drawer.location")} value={location} />
        <Fact label={t("shortlists.drawer.experience")} value={years} />
        <Fact label={t("shortlists.drawer.availability")} value={availability} />
      </dl>

      <section className="space-y-2">
        <h3 className="text-base font-semibold text-ink">{t("shortlists.drawer.summary")}</h3>
        {loading && !candidate ? (
          <div className="space-y-2" aria-busy="true">
            <Skeleton className="h-3.5 w-full" />
            <Skeleton className="h-3.5 w-5/6" />
            <Skeleton className="h-3.5 w-2/3" />
          </div>
        ) : (
          <p className="whitespace-pre-line text-body text-ink break-words">
            {summary || <span className="text-muted-foreground">{t("common.unknown")}</span>}
          </p>
        )}
      </section>

      <section className="space-y-2">
        <h3 className="text-base font-semibold text-ink">{t("shortlists.drawer.skills")}</h3>
        {skills.length ? (
          <ul className="flex flex-wrap items-center gap-1.5">
            {skills.map((skill) => (
              <li key={skill} className="min-w-0">
                <Pill className="max-w-56">{skill}</Pill>
              </li>
            ))}
            {more > 0 ? (
              <li className="text-meta text-muted-foreground tabular-nums">
                {more === 1 ? t("candidates.skills.more.one") : t("candidates.skills.more", { count: more })}
              </li>
            ) : null}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">{t("common.unknown")}</p>
        )}
      </section>

      <section className="space-y-2">
        <h3 className="text-base font-semibold text-ink">{t("shortlists.drawer.languages")}</h3>
        <p className={languages ? "text-body text-ink break-words" : "text-sm text-muted-foreground"}>
          {languages || t("common.unknown")}
        </p>
      </section>

      <div>
        <Button asChild variant="outline" icon={<UserRound />}>
          <Link to="/app/candidates/$candidateId" params={{ candidateId }}>
            {t("shortlists.drawer.openCandidate")}
          </Link>
        </Button>
      </div>
    </div>
  );
}
