/**
 * The reading tab of the drawer: why the model places this profile
 * (the assessment's summary, else the search's sentences, marked as the
 * model's by a pill beside the heading), its detailed reading when the
 * assessment carries one (the five dimensions as meters, the rank note,
 * the strengths, the reservations, the interview questions), then one
 * row per requirement of the brief through the shared RequirementList
 * (from the assessment when there is one, else from the deterministic
 * verdicts). The score is a figure in the drawer's header: no ring
 * here, no second scale. An item added without a match says so instead
 * of showing a score of zero.
 */
import { CircleDashed, Sparkles } from "lucide-react";

import { EmptyState } from "@/components/app-shell/empty-state";
import { Pill } from "@/components/app-shell/pill";
import { RequirementList } from "@/components/app-shell/requirement-list";
import type { BriefCriterion, MatchResult, RequirementMet } from "@/lib/db/types";
import { useI18n } from "@/lib/i18n";
import { modelReading, requirementRowsOf } from "@/lib/shortlists/requirements";

import { RecruiterReading } from "./recruiter-reading";

/** A section title, with the "model's reading" pill when what follows is the model's. */
function Heading({ title, byModel = false }: { title: string; byModel?: boolean }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <h3 className="label-caps">{title}</h3>
      {byModel ? (
        <Pill size="sm" tone="caution" icon={<Sparkles />}>
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
      <EmptyState compact inset icon={<CircleDashed />} title={t("shortlists.drawer.match.none")} />
    );
  }
  const rows = requirementRowsOf(criteria, match, t("shortlists.drawer.criterion.unknown"));
  const reading = modelReading(match);
  const markLabel = (met: RequirementMet) => t(`shortlists.met.${met}`);
  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <Heading title={t("shortlists.drawer.why")} byModel />
        <p className="whitespace-pre-line text-body text-ink break-words">
          {reading ?? <span className="text-muted-foreground">{t("common.unknown")}</span>}
        </p>
      </section>

      <RecruiterReading match={match} />

      <section className="space-y-3">
        <Heading title={t("shortlists.drawer.match")} />
        {rows.length ? (
          <RequirementList
            rows={rows}
            markLabel={markLabel}
            requiredLabel={t("shortlists.drawer.required")}
            stagger
          />
        ) : (
          <p className="text-sm text-muted-foreground">{t("shortlists.drawer.match.empty")}</p>
        )}
      </section>
    </div>
  );
}
