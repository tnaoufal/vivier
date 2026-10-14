/**
 * One result of an analysis: who, the tier of the comparative pass and
 * the decision of the analysis as pills, the fit score as a ring (empty
 * when no model read the profile), the five dimensions as a row of
 * small meters, one row per requirement of the brief with the evidence
 * the verdict rests on (the role first, named as such: "Métier ·
 * Business Developer"), the model's reading when it answered, its
 * strengths and reservations as two short lists, the points to verify
 * in an interview behind a toggle, the second opinion's reservation
 * under its own heading when it doubted, the tiering's line in muted
 * text, and the way to the shortlist. A requirement the CV says nothing
 * about reads "not stated", never as a lack; a quote the model gave
 * that was not found in the CV says so next to it; a set-aside profile
 * says which requirement it does not meet, the métier first (or that
 * the model's reading set it aside, with its score); a profile to dig
 * into names its main reservation (an adjacent métier, a must-have not
 * stated or met in part, the second opinion's doubt, the first
 * concern); the sentences the filter withheld are counted, so the
 * reading is never taken for complete. Every card stays one click from
 * its page.
 */
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  ChevronDown,
  ExternalLink,
  ListPlus,
  MessageSquare,
  ThumbsUp,
  TriangleAlert,
} from "lucide-react";

import { Avatar } from "@/components/app-shell/avatar";
import { Pill } from "@/components/app-shell/pill";
import { RequirementList, type RequirementRow } from "@/components/app-shell/requirement-list";
import { ScoreRing } from "@/components/app-shell/score-ring";
import { Button } from "@/components/ui/button";
import {
  decisionOf,
  firstMissingRequirement,
  requirementRows,
  tierOf,
} from "@/lib/briefs/assessment";
import { kindKey } from "@/lib/briefs/criteria";
import { candidatePath, shortlistPath } from "@/lib/briefs/paths";
import type { ResultCandidate } from "@/lib/briefs/queries";
import type { BriefCriterion, MatchResult, RequirementMet } from "@/lib/db/types";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

import { DecisionPill } from "./decision-pill";
import { DimensionMeters } from "./dimension-meters";
import { TierPill } from "./tier-pill";

/** A short list of facts with a leading icon, so the two lists read apart without colour alone. */
function FactList({
  title,
  items,
  icon,
  className,
}: {
  title: string;
  items: readonly string[];
  icon: typeof ThumbsUp;
  className?: string;
}) {
  const Icon = icon;
  if (!items.length) return null;
  return (
    <div className={cn("min-w-0", className)}>
      <span className="label-caps">{title}</span>
      <ul className="mt-1 space-y-1.5">
        {items.map((item) => (
          <li key={item} className="flex items-start gap-2 text-sm leading-5 text-ink">
            <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0">{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

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
  const [detail, setDetail] = useState(false);
  const [questionsOpen, setQuestionsOpen] = useState(false);
  const name = candidate
    ? candidate.full_name?.trim() || t("briefs.results.noName")
    : t("briefs.results.gone");
  const line = candidate
    ? [candidate.headline, candidate.location].filter((part) => part && part.trim()).join(" · ")
    : "";
  const assessment = result.assessment ?? null;
  const decision = decisionOf(result);
  const tier = tierOf(result);
  const ordered = requirementRows(criteria, result);
  // The role row reads as such: the shared list shows the label it is given; a quote not found in the CV says so after it.
  const rows: RequirementRow[] = ordered.map(({ kind, evidenceUnverified, ...row }) => ({
    ...row,
    label: kind === "role" ? `${t(kindKey(kind))} · ${row.label}` : row.label,
    evidence:
      evidenceUnverified && row.evidence
        ? `${row.evidence} · ${t("briefs.results.evidence.unverified")}`
        : row.evidence,
  }));
  const reason = decision === "no_fit" ? firstMissingRequirement(criteria, result) : null;
  const score = assessment ? assessment.score : null;
  const challenge = assessment?.challenge ?? null;
  const doubt = challenge?.verdict === "doubt" && challenge.reason ? challenge : null;
  const rankNote = assessment?.rankNote ?? null;
  /** The main reservation of a profile to dig into, in the order the rules weigh them; null when the reading named none. */
  function checkLine(): string | null {
    if (decision !== "borderline" || !assessment) return null;
    const roleRow = ordered.find((row) => row.kind === "role");
    if (roleRow?.met === "partial")
      return t("briefs.results.check.role", { evidence: roleRow.evidence ?? roleRow.label });
    if (roleRow?.met === "unknown")
      return t("briefs.results.check.required", {
        label: `${t(kindKey("role"))} · ${roleRow.label}`,
      });
    const notStated = ordered.find(
      (row) => row.required && row.kind !== "role" && row.met === "unknown",
    );
    if (notStated) return t("briefs.results.check.required", { label: notStated.label });
    const inPart = ordered.find(
      (row) => row.required && row.kind !== "role" && row.met === "partial",
    );
    if (inPart) return t("briefs.results.check.partial", { label: inPart.label });
    if (doubt?.reason) return t("briefs.results.check.challenge", { reason: doubt.reason });
    // A fit the tiering sent back to the team: its line says what to check.
    if (rankNote) return null;
    const concern = assessment.concerns?.[0];
    return concern ? t("briefs.results.check.concern", { concern }) : null;
  }
  // A set-aside profile always says why: the métier when it is another one, else the required requirement at "no", else the model's own reading and its score. A profile to dig into names its main reservation.
  const reasonLine =
    decision === "no_fit" && score !== null
      ? reason
        ? t(reason.kind === "role" ? "briefs.results.reason.role" : "briefs.results.reason", {
            label: reason.label,
          })
        : t("briefs.results.reason.model", { score })
      : checkLine();
  const scoreLabel =
    score === null
      ? t("briefs.results.noScore")
      : typeof assessment?.modelScore === "number"
        ? `${t("briefs.results.score", { score })} · ${t("briefs.results.modelScore", { score: assessment.modelScore })}`
        : t("briefs.results.score", { score });
  const markLabel = (met: RequirementMet) => t(`briefs.met.${met}`);
  // The second opinion's reason is shown under its own heading, not twice.
  const concerns = (assessment?.concerns ?? []).filter((concern) => concern !== doubt?.reason);
  const strengths = assessment?.strengths ?? [];
  const questions = assessment?.questions ?? [];
  const withheld = assessment?.withheld ?? 0;

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
    <article
      className={cn(
        "sheet space-y-6 p-6 transition-opacity duration-150",
        muted && "opacity-75 hover:opacity-100",
      )}
    >
      <div className="flex items-start gap-4">
        <Avatar name={name} size="lg" className="mt-0.5" />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {candidate ? (
              <Link
                to={candidatePath(candidate.id)}
                className="min-w-0 truncate text-base font-semibold text-ink hover:underline"
              >
                {name}
              </Link>
            ) : (
              <span className="min-w-0 truncate text-base font-semibold text-muted-foreground">
                {name}
              </span>
            )}
            {tier ? <TierPill tier={tier} /> : null}
            <DecisionPill decision={decision} />
            {candidate?.status === "archived" ? <Pill>{t("briefs.results.archived")}</Pill> : null}
          </div>
          <p className="truncate text-sm text-muted-foreground">
            {line || (candidate ? t("common.unknown") : t("briefs.results.goneText"))}
          </p>
          {reasonLine ? (
            <p
              className={cn(
                "text-sm",
                decision === "no_fit"
                  ? "text-negative"
                  : "text-caution-foreground dark:text-caution",
              )}
            >
              {reasonLine}
            </p>
          ) : null}
          {rankNote ? (
            <p className="text-sm text-muted-foreground">
              {t("briefs.results.rankNote", { note: rankNote })}
            </p>
          ) : null}
        </div>
        <ScoreRing score={score} label={scoreLabel} />
      </div>

      {assessment?.dimensions ? (
        <div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="label-caps">{t("briefs.results.dimensions")}</span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setDetail((value) => !value)}
              aria-expanded={detail}
              className="gap-1.5"
            >
              <ChevronDown
                className={cn("transition-transform duration-150", detail && "rotate-180")}
              />
              {detail ? t("briefs.results.dimensions.hide") : t("briefs.results.dimensions.show")}
            </Button>
          </div>
          <DimensionMeters dimensions={assessment.dimensions} expanded={detail} className="mt-1" />
        </div>
      ) : null}

      {rows.length ? (
        <div>
          <span className="label-caps">{t("briefs.results.requirements")}</span>
          <RequirementList
            rows={rows}
            markLabel={markLabel}
            requiredLabel={t("common.required")}
            className="mt-1"
          />
        </div>
      ) : null}

      {assessment?.summary ? (
        <div>
          <span className="label-caps">{t("briefs.results.why")}</span>
          <p className="mt-1 text-[15px] leading-6 text-ink">{assessment.summary}</p>
        </div>
      ) : null}

      {strengths.length || concerns.length ? (
        <div className="grid gap-6 sm:grid-cols-2">
          <FactList title={t("briefs.results.strengths")} items={strengths} icon={ThumbsUp} />
          <FactList title={t("briefs.results.concerns")} items={concerns} icon={TriangleAlert} />
        </div>
      ) : null}

      {doubt ? (
        <div>
          <span className="label-caps">{t("briefs.results.challenge")}</span>
          <p className="mt-1 flex items-start gap-2 text-[15px] leading-6 text-ink">
            <TriangleAlert
              aria-hidden="true"
              className="mt-1 size-4 shrink-0 text-caution-foreground dark:text-caution"
            />
            <span className="min-w-0">{doubt.reason}</span>
          </p>
          {doubt.evidence ? (
            <p className="mt-0.5 pl-6 text-sm text-muted-foreground">{doubt.evidence}</p>
          ) : null}
        </div>
      ) : challenge?.verdict === "confirmed" ? (
        <p className="text-sm text-muted-foreground">{t("briefs.results.challenge.confirmed")}</p>
      ) : null}

      {questions.length ? (
        <div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setQuestionsOpen((value) => !value)}
            aria-expanded={questionsOpen}
            className="-ml-4 gap-1.5"
          >
            <ChevronDown
              className={cn("transition-transform duration-150", questionsOpen && "rotate-180")}
            />
            {questionsOpen
              ? t("briefs.results.questions.hide")
              : t("briefs.results.questions.show")}
          </Button>
          {questionsOpen ? (
            <FactList
              title={t("briefs.results.questions")}
              items={questions}
              icon={MessageSquare}
              className="mt-2"
            />
          ) : null}
        </div>
      ) : null}

      {withheld > 0 ? (
        <p className="text-[13px] leading-5 text-muted-foreground">
          {t("briefs.results.withheld", { count: withheld })}
        </p>
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
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void add()}
            disabled={busy}
            className="gap-1.5"
          >
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
