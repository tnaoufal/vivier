/**
 * The match of a shortlist item against its brief, as the drawer shows
 * it: the fit ring (the model's score, a dash when no model assessed the
 * profile) with the analysis's decision, the deterministic score as a
 * muted second reading, one row per requirement through the shared
 * RequirementList (from the assessment when there is one, else from the
 * deterministic verdicts), and the model's sentences introduced as the
 * model's. An item added without a match says so instead of showing a
 * score of zero.
 */
import { Pill } from "@/components/app-shell/pill";
import { RequirementList } from "@/components/app-shell/requirement-list";
import { ScoreRing } from "@/components/app-shell/score-ring";
import { DecisionPill } from "@/components/briefs/decision-pill";
import type { BriefCriterion, MatchResult, RequirementMet } from "@/lib/db/types";
import { useI18n } from "@/lib/i18n";
import { assessedScore, modelReading, requirementRowsOf } from "@/lib/shortlists/requirements";
import { coveragePercent, scorePercent } from "@/lib/shortlists/tally";

export function VerdictList({ match, criteria }: { match: MatchResult | null; criteria: BriefCriterion[] }) {
  const { t } = useI18n();
  const heading = <h3 className="text-base font-semibold leading-6 text-ink">{t("shortlists.drawer.match")}</h3>;
  if (!match) {
    return (
      <section className="space-y-3">
        {heading}
        <p className="text-sm text-muted-foreground">{t("shortlists.drawer.match.none")}</p>
      </section>
    );
  }
  const rows = requirementRowsOf(criteria, match, t("shortlists.drawer.criterion.unknown"));
  const score = assessedScore(match);
  const scoreLabel = score === null ? t("shortlists.item.noAssessment") : t("shortlists.item.fitScore", { score });
  const textScore = scorePercent(match);
  const coverage = coveragePercent(match);
  const reading = modelReading(match);
  const markLabel = (met: RequirementMet) => t(`shortlists.met.${met}`);
  return (
    <section className="space-y-4">
      {heading}
      <div className="flex items-center gap-4">
        <ScoreRing score={score} label={scoreLabel} size="lg" />
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            {match.assessment ? <DecisionPill decision={match.assessment.decision} /> : <Pill>{t("shortlists.item.noAssessment")}</Pill>}
            {match.blocked ? (
              <Pill tone="negative" dot>
                {t("shortlists.item.blocked")}
              </Pill>
            ) : null}
          </div>
          <p className="text-[13px] leading-5 text-muted-foreground tabular-nums">
            {textScore === null ? t("shortlists.item.noScore") : t("shortlists.item.score", { score: textScore })}
            {coverage !== null ? ` · ${t("shortlists.item.coverage", { coverage })}` : ""}
          </p>
        </div>
      </div>
      {rows.length ? (
        <RequirementList
          rows={rows}
          markLabel={markLabel}
          requiredLabel={t("shortlists.drawer.required")}
          className="rounded-2xl border border-border px-4"
        />
      ) : (
        <p className="text-sm text-muted-foreground">{t("shortlists.drawer.match.empty")}</p>
      )}
      <div>
        <h4 className="label-caps">{t("shortlists.drawer.assessment")}</h4>
        <p className="mt-1 whitespace-pre-line text-[15px] leading-6 text-ink">
          {reading ?? <span className="text-muted-foreground">{t("shortlists.drawer.match.noWhy")}</span>}
        </p>
      </div>
    </section>
  );
}
