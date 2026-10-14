/**
 * One result of an analysis, built for a recruiter deciding whether to
 * present the person: who (the photo when the organisation shows
 * photos, the name, the position held today, where), the tier of the
 * comparative pass and the decision of the analysis as pills, the fit
 * score as a ring (a dash when no model read the profile), the model's
 * reading, the five dimensions as a compact grid of meters (the notes
 * and the evidence behind a toggle), its strengths and reservations as
 * two short lists with a check and an alert mark, the second opinion's
 * reservation when it doubted, the points for the interview behind a
 * toggle, one row per requirement of the brief with the evidence the
 * verdict rests on (the role first, named as such: "Métier · Business
 * Developer"), and the way to the shortlist. A requirement the CV says
 * nothing about reads "not stated", never as a lack; a quote the model
 * gave that was not found in the CV says so next to it; a set-aside
 * profile says which requirement it does not meet, the métier first
 * (or that the model's reading set it aside, with its score); a profile
 * to dig into names its main reservation; the sentences the filter
 * withheld are counted, so the reading is never taken for complete.
 * Every card stays one click from its page.
 */
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  Check,
  ChevronDown,
  CircleAlert,
  CircleCheck,
  CircleX,
  ExternalLink,
  ListChecks,
  ListPlus,
  MessageSquare,
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
import { currentPosition, displayName } from "@/lib/candidates/format";
import { usePhotoUrl } from "@/lib/candidates/use-photo-url";
import type { BriefCriterion, MatchResult, RequirementMet } from "@/lib/db/types";
import { useT } from "@/lib/i18n";
import { useOrg } from "@/lib/org/org-context";
import { cn } from "@/lib/utils";

import { DecisionPill } from "./decision-pill";
import { DimensionMeters } from "./dimension-meters";
import { TierPill } from "./tier-pill";

const MARK_TONES = {
  positive: "text-positive",
  caution: "text-caution-foreground dark:text-caution",
  neutral: "text-muted-foreground",
} as const;

/** A short list of facts, each led by one mark in a tone, so the lists read apart without colour alone. */
function FactList({
  title,
  items,
  icon,
  tone,
  className,
}: {
  title: string | null;
  items: readonly string[];
  icon: typeof Check;
  tone: keyof typeof MARK_TONES;
  className?: string;
}) {
  const Icon = icon;
  if (!items.length) return null;
  return (
    <div className={cn("min-w-0", className)}>
      {title ? <span className="label-caps">{title}</span> : null}
      <ul className={cn("space-y-1.5", title && "mt-1.5")}>
        {items.map((item) => (
          <li key={item} className="flex items-start gap-2 text-sm text-ink">
            <Icon aria-hidden="true" className={cn("mt-0.5 size-4 shrink-0", MARK_TONES[tone])} />
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
  const { showPhotos } = useOrg();
  const photoUrl = usePhotoUrl(candidate?.photo_path ?? null, showPhotos && candidate !== null);
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState(false);
  const [questionsOpen, setQuestionsOpen] = useState(false);
  const name = candidate
    ? displayName(candidate, t("briefs.results.noName"))
    : t("briefs.results.gone");
  const position = candidate ? currentPosition(candidate) : null;
  const location = candidate?.location?.trim() || null;
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
  const ReasonIcon = decision === "no_fit" ? CircleX : CircleAlert;
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
        "sheet space-y-5 p-6 transition-opacity duration-base ease-out-soft",
        muted && "opacity-75 focus-within:opacity-100 hover:opacity-100",
      )}
    >
      <div className="flex items-start gap-4">
        <Avatar name={name} size="lg" photoUrl={photoUrl} className="mt-0.5" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            {candidate ? (
              <Link
                to={candidatePath(candidate.id)}
                className="min-w-0 truncate text-base font-semibold text-ink hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
            {candidate?.status === "archived" ? (
              <Pill dot>{t("briefs.results.archived")}</Pill>
            ) : null}
          </div>
          <p className="mt-0.5 truncate text-sm text-ink/85">
            {candidate ? (
              position ? (
                <>
                  {position.title}
                  {position.company ? (
                    <span className="text-muted-foreground"> @ {position.company}</span>
                  ) : null}
                  {location ? <span className="text-muted-foreground"> · {location}</span> : null}
                </>
              ) : (
                <span className="text-muted-foreground">{location ?? t("common.unknown")}</span>
              )
            ) : (
              <span className="text-muted-foreground">{t("briefs.results.goneText")}</span>
            )}
          </p>
          {reasonLine ? (
            <p
              className={cn(
                "mt-2 flex items-start gap-1.5 text-sm",
                decision === "no_fit" ? "text-negative" : MARK_TONES.caution,
              )}
            >
              <ReasonIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              <span className="min-w-0">{reasonLine}</span>
            </p>
          ) : null}
          {rankNote ? (
            <p className="mt-1 text-meta text-muted-foreground">
              {t("briefs.results.rankNote", { note: rankNote })}
            </p>
          ) : null}
        </div>
        <ScoreRing score={score} label={scoreLabel} />
      </div>

      {assessment?.summary ? (
        <div className="border-l-2 border-primary/40 pl-4">
          <span className="label-caps">{t("briefs.results.why")}</span>
          <p className="mt-1 text-body text-ink">{assessment.summary}</p>
        </div>
      ) : null}

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
              icon={
                <ChevronDown
                  className={cn(
                    "transition-transform duration-base ease-out-soft",
                    detail && "rotate-180",
                  )}
                />
              }
            >
              {detail ? t("briefs.results.dimensions.hide") : t("briefs.results.dimensions.show")}
            </Button>
          </div>
          <DimensionMeters dimensions={assessment.dimensions} expanded={detail} className="mt-2" />
        </div>
      ) : null}

      {strengths.length || concerns.length ? (
        <div className="grid gap-5 sm:grid-cols-2">
          <FactList
            title={t("briefs.results.strengths")}
            items={strengths}
            icon={CircleCheck}
            tone="positive"
          />
          <FactList
            title={t("briefs.results.concerns")}
            items={concerns}
            icon={TriangleAlert}
            tone="caution"
          />
        </div>
      ) : null}

      {doubt ? (
        <div>
          <span className="label-caps">{t("briefs.results.challenge")}</span>
          <p className="mt-1 flex items-start gap-2 text-body text-ink">
            <TriangleAlert
              aria-hidden="true"
              className={cn("mt-1 size-4 shrink-0", MARK_TONES.caution)}
            />
            <span className="min-w-0">{doubt.reason}</span>
          </p>
          {doubt.evidence ? (
            <p className="mt-0.5 pl-6 text-sm text-muted-foreground">{doubt.evidence}</p>
          ) : null}
        </div>
      ) : challenge?.verdict === "confirmed" ? (
        <p className="flex items-center gap-2 text-meta text-muted-foreground">
          <CircleCheck aria-hidden="true" className="size-4 shrink-0" />
          {t("briefs.results.challenge.confirmed")}
        </p>
      ) : null}

      {questions.length ? (
        <div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setQuestionsOpen((value) => !value)}
            aria-expanded={questionsOpen}
            className="-ml-3.5"
            icon={
              <ChevronDown
                className={cn(
                  "transition-transform duration-base ease-out-soft",
                  questionsOpen && "rotate-180",
                )}
              />
            }
          >
            {t("briefs.results.questions")}
            <span className="text-muted-foreground tabular-nums">{questions.length}</span>
          </Button>
          {questionsOpen ? (
            <FactList
              title={null}
              items={questions}
              icon={MessageSquare}
              tone="neutral"
              className="fade-in mt-1 pl-1"
            />
          ) : null}
        </div>
      ) : null}

      {rows.length ? (
        <div>
          <span className="label-caps">{t("briefs.results.requirements")}</span>
          <RequirementList
            rows={rows}
            markLabel={markLabel}
            requiredLabel={t("common.required")}
            compact
            className="mt-1"
          />
        </div>
      ) : null}

      {withheld > 0 ? (
        <p className="text-meta text-muted-foreground">
          {t("briefs.results.withheld", { count: withheld })}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {added && shortlistId ? (
          <Button asChild variant="outline" size="sm" icon={<ListChecks />}>
            <Link to={shortlistPath(shortlistId)}>{t("briefs.results.seeShortlist")}</Link>
          </Button>
        ) : canEdit && candidate ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            icon={<ListPlus />}
            onClick={() => void add()}
            disabled={busy}
          >
            {t("briefs.results.addToShortlist")}
          </Button>
        ) : null}
        {candidate ? (
          <Button asChild variant="ghost" size="sm" icon={<ExternalLink />}>
            <Link to={candidatePath(candidate.id)}>{t("briefs.results.openCandidate")}</Link>
          </Button>
        ) : null}
      </div>
    </article>
  );
}
