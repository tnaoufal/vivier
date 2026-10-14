/**
 * The decision tab of the drawer: the fit as the model reads it (the
 * ring, the decision, the deterministic score as a muted second
 * reading, the model's sentences), then its detailed reading when the
 * assessment carries one (the five dimensions as meters, the rank note,
 * the strengths, the reservations, the interview questions), then one
 * row per requirement of the brief through the shared RequirementList
 * (from the assessment when there is one, else from the deterministic
 * verdicts). An item added without a match says so instead of showing
 * a score of zero; the fit is marked as the model's reading by a pill
 * next to its heading, never a paragraph.
 */
import { CircleDashed, Sparkles } from "lucide-react";

import { EmptyState } from "@/components/app-shell/empty-state";
import { Pill } from "@/components/app-shell/pill";
import { RequirementList } from "@/components/app-shell/requirement-list";
import { ScoreRing } from "@/components/app-shell/score-ring";
import type { BriefCriterion, MatchResult, RequirementMet } from "@/lib/db/types";
import { useI18n } from "@/lib/i18n";
import { assessedScore, modelReading, requirementRowsOf } from "@/lib/shortlists/requirements";

import { ScoreLine } from "./item-bits";
import { RecruiterReading } from "./recruiter-reading";

/** A section title, with the "model's reading" pill when what follows is the model's. */
function Heading({ title, byModel = false }: { title: string; byModel?: boolean }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <h3 className="text-base font-semibold text-ink">{title}</h3>
      {byModel ? (
        <Pill size="sm" tone="primary" icon={<Sparkles />}>
          {t("shortlists.drawer.assessment")}
        </Pill>
      ) : null}
    </div>
  );
}

export function VerdictList({
  match,
  criteria,
}: {
  match: MatchResult | null;
  criteria: readonly BriefCriterion[];
}) {
  const { t } = useI18n();
  if (!match) {
    return (
      <section className="space-y-3">
        <Heading title={t("shortlists.drawer.fit")} />
        <EmptyState compact inset icon={<CircleDashed />} title={t("shortlists.drawer.match.none")} />
      </section>
    );
  }
  const rows = requirementRowsOf(criteria, match, t("shortlists.drawer.criterion.unknown"));
  const score = assessedScore(match);
  const scoreLabel = score === null ? t("shortlists.item.noAssessment") : t("shortlists.item.fitScore", { score });
  const reading = modelReading(match);
  const markLabel = (met: RequirementMet) => t(`shortlists.met.${met}`);
  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <Heading title={t("shortlists.drawer.fit")} byModel />
        <div className="flex items-center gap-4">
          <ScoreRing score={score} label={scoreLabel} size="lg" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex flex-wrap items-center gap-1.5">
              {match.blocked ? (
                <Pill tone="negative" dot>
                  {t("shortlists.item.blocked")}
                </Pill>
              ) : null}
              {score === null ? (
                <Pill tone="neutral" icon={<CircleDashed />}>
                  {t("shortlists.item.noAssessment")}
                </Pill>
              ) : null}
            </div>
            <ScoreLine match={match} className="block" />
          </div>
        </div>
        <p className="whitespace-pre-line text-body text-ink">
          {reading ?? <span className="text-muted-foreground">{t("shortlists.drawer.match.noWhy")}</span>}
        </p>
      </section>

      <RecruiterReading match={match} />

      <section className="space-y-3">
        <Heading title={t("shortlists.drawer.match")} />
        {rows.length ? (
          <RequirementList rows={rows} markLabel={markLabel} requiredLabel={t("shortlists.drawer.required")} stagger />
        ) : (
          <p className="text-sm text-muted-foreground">{t("shortlists.drawer.match.empty")}</p>
        )}
      </section>
    </div>
  );
}
