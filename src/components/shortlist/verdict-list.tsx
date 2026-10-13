/**
 * The explained match of a shortlist item, criterion by criterion: the
 * label from the brief, the verdict as a pill, the evidence the verdict
 * rests on (or that nothing in the profile says so), and the model's
 * sentences when a model answered. An item added without a match says
 * so instead of showing a score of zero.
 */
import { Pill } from "@/components/app-shell/pill";
import type { BriefCriterion, MatchResult } from "@/lib/db/types";
import { useI18n } from "@/lib/i18n";

import { ScoreLine, VERDICT_PILL_TONES, VerdictCounts } from "./item-bits";

export function VerdictList({ match, criteria }: { match: MatchResult | null; criteria: BriefCriterion[] }) {
  const { t } = useI18n();
  if (!match) {
    return (
      <section>
        <h3 className="label-caps mb-2">{t("shortlists.drawer.match")}</h3>
        <p className="text-sm text-muted-foreground">{t("shortlists.drawer.match.none")}</p>
      </section>
    );
  }
  const verdicts = Array.isArray(match.verdicts) ? match.verdicts : [];
  const why = typeof match.why === "string" ? match.why.trim() : "";
  return (
    <section>
      <h3 className="label-caps mb-2">{t("shortlists.drawer.match")}</h3>
      <div className="space-y-1">
        <ScoreLine match={match} />
        <VerdictCounts match={match} />
      </div>
      {verdicts.length ? (
        <ul className="mt-3 divide-y divide-border rounded-xl border border-border">
          {verdicts.map((result, index) => {
            const criterion = criteria.find((entry) => entry.id === result.criterionId);
            const verdict = result.verdict in VERDICT_PILL_TONES ? result.verdict : "not_stated";
            const evidence = typeof result.evidence === "string" ? result.evidence.trim() : "";
            return (
              <li key={`${result.criterionId}-${index}`} className="px-3 py-2">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-sm font-medium text-ink">
                    {criterion?.label ?? t("shortlists.drawer.criterion.unknown")}
                  </span>
                  {criterion?.required ? <Pill>{t("shortlists.drawer.required")}</Pill> : null}
                  <Pill tone={VERDICT_PILL_TONES[verdict]} className="ml-auto">
                    {t(`shortlists.verdict.${verdict}`)}
                  </Pill>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {evidence || t("shortlists.drawer.evidence.none")}
                </p>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">{t("shortlists.drawer.match.empty")}</p>
      )}
      <div className="mt-3">
        <h4 className="text-xs font-medium text-ink">{t("shortlists.drawer.match.why")}</h4>
        <p className="mt-0.5 whitespace-pre-line text-sm text-muted-foreground">
          {why || t("shortlists.drawer.match.noWhy")}
        </p>
      </div>
    </section>
  );
}
