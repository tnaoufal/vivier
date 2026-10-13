/**
 * One result of an analysis: who, the decision of the analysis as a
 * pill, the fit score as a ring (empty when no model read the profile),
 * one row per requirement of the brief with the evidence the verdict
 * rests on, the model's reading when it answered, and the way to the
 * shortlist. A requirement the CV says nothing about reads "not
 * stated", never as a lack; a set-aside profile says which required
 * requirement it does not meet (or that the model's reading set it
 * aside, with its score) and stays one click from its page.
 */
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { ExternalLink, ListPlus } from "lucide-react";

import { Avatar } from "@/components/app-shell/avatar";
import { Pill } from "@/components/app-shell/pill";
import { RequirementList } from "@/components/app-shell/requirement-list";
import { ScoreRing } from "@/components/app-shell/score-ring";
import { Button } from "@/components/ui/button";
import { decisionOf, firstMissingRequirement, requirementRows } from "@/lib/briefs/assessment";
import { candidatePath, shortlistPath } from "@/lib/briefs/paths";
import type { ResultCandidate } from "@/lib/briefs/queries";
import type { BriefCriterion, MatchResult, RequirementMet } from "@/lib/db/types";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

import { DecisionPill } from "./decision-pill";

export function ResultCard({
  result,
  criteria,
  candidate,
  shortlistId,
  added,
  canEdit,
  muted = false,
  onAdd,
}: {
  result: MatchResult;
  /** The criteria of the search, in the order the requirement rows follow. */
  criteria: BriefCriterion[];
  /** Null when the candidate was erased since the search. */
  candidate: ResultCandidate | null;
  shortlistId: string | null;
  added: boolean;
  canEdit: boolean;
  /** True for a profile the analysis set aside: shown quieter, still complete. */
  muted?: boolean;
  onAdd: () => Promise<void>;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const name = candidate ? candidate.full_name?.trim() || t("briefs.results.noName") : t("briefs.results.gone");
  const line = candidate ? [candidate.headline, candidate.location].filter((part) => part && part.trim()).join(" · ") : "";
  const assessment = result.assessment ?? null;
  const decision = decisionOf(result);
  const rows = requirementRows(criteria, result);
  const reason = decision === "no_fit" ? firstMissingRequirement(criteria, result) : null;
  const score = assessment ? assessment.score : null;
  // A set-aside profile always says why: the required requirement at "no", else the model's own reading and its score.
  const reasonLine =
    decision !== "no_fit" || score === null
      ? null
      : reason
        ? t("briefs.results.reason", { label: reason.label })
        : t("briefs.results.reason.model", { score });
  const scoreLabel = score === null ? t("briefs.results.noScore") : t("briefs.results.score", { score });
  const markLabel = (met: RequirementMet) => t(`briefs.met.${met}`);

  async function add() {
    if (busy) return;
    setBusy(true);
    try {
      await onAdd();
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className={cn("sheet space-y-6 p-6 transition-opacity duration-150", muted && "opacity-75 hover:opacity-100")}>
      <div className="flex items-start gap-4">
        <Avatar name={name} size="lg" className="mt-0.5" />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {candidate ? (
              <Link to={candidatePath(candidate.id)} className="min-w-0 truncate text-base font-semibold text-ink hover:underline">
                {name}
              </Link>
            ) : (
              <span className="min-w-0 truncate text-base font-semibold text-muted-foreground">{name}</span>
            )}
            <DecisionPill decision={decision} />
            {candidate?.status === "archived" ? <Pill>{t("briefs.results.archived")}</Pill> : null}
          </div>
          <p className="truncate text-sm text-muted-foreground">{line || (candidate ? t("common.unknown") : t("briefs.results.goneText"))}</p>
          {reasonLine ? <p className="text-sm text-negative">{reasonLine}</p> : null}
        </div>
        <ScoreRing score={score} label={scoreLabel} />
      </div>

      {rows.length ? (
        <div>
          <span className="label-caps">{t("briefs.results.requirements")}</span>
          <RequirementList rows={rows} markLabel={markLabel} requiredLabel={t("common.required")} className="mt-1" />
        </div>
      ) : null}

      {assessment?.summary ? (
        <div>
          <span className="label-caps">{t("briefs.results.why")}</span>
          <p className="mt-1 text-[15px] leading-6 text-ink">{assessment.summary}</p>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {added && shortlistId ? (
          <Button asChild variant="outline" size="sm">
            <Link to={shortlistPath(shortlistId)} className="gap-1.5">
              <ListPlus />
              {t("briefs.results.seeShortlist")}
            </Link>
          </Button>
        ) : canEdit && candidate ? (
          <Button type="button" variant="outline" size="sm" onClick={() => void add()} disabled={busy} className="gap-1.5">
            <ListPlus />
            {t("briefs.results.addToShortlist")}
          </Button>
        ) : null}
        {candidate ? (
          <Button asChild variant="ghost" size="sm">
            <Link to={candidatePath(candidate.id)} className="gap-1.5">
              <ExternalLink />
              {t("briefs.results.openCandidate")}
            </Link>
          </Button>
        ) : null}
      </div>
    </article>
  );
}
