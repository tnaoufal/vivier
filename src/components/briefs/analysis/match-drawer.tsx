/**
 * One profile of an analysis in a drawer from the right, to decide
 * whether to present it without leaving the list: the header names the
 * person (photo or initials, the position held today, where, the years)
 * with the tier, the decision and the score, the buttons (and the left
 * and right arrow keys) that walk the list, and one row of actions (add
 * to the shortlist, open the profile); then, in this order, why this
 * profile (the reading's summary and the ranking's note, marked as the
 * model's), the reading against the role (the five dimensions with
 * their notes), the strengths and the reservations side by side (the
 * second reading's doubt first), the requirements of the brief with the
 * evidence (the role first; what the CV does not say reads "Non
 * renseigné", never as a lack), the points for the interview, and the
 * triage's verdict, small and muted. A profile no model read shows its
 * requirements alone.
 */
import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import {
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  ListChecks,
  ListPlus,
  MessageSquare,
  TriangleAlert,
  UserRound,
} from "lucide-react";

import { Avatar } from "@/components/app-shell/avatar";
import { InfoTip } from "@/components/app-shell/info-tip";
import { Pill } from "@/components/app-shell/pill";
import { RequirementList, type RequirementRow } from "@/components/app-shell/requirement-list";
import { ScoreRing } from "@/components/app-shell/score-ring";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { requireSupabase } from "@/lib/auth/supabase-client";
import { decisionOf, requirementRows, tierOf } from "@/lib/briefs/assessment";
import { kindKey } from "@/lib/briefs/criteria";
import { candidatePath, shortlistPath } from "@/lib/briefs/paths";
import { currentPosition, displayName, yearsLabel } from "@/lib/candidates/format";
import { usePhotoUrl } from "@/lib/candidates/use-photo-url";
import { useQuery } from "@/lib/data/use-query";
import type { BriefCriterion, MatchResult, RequirementMet, TriageVerdict } from "@/lib/db/types";
import { useI18n, type TranslationKey } from "@/lib/i18n";
import { useOrg } from "@/lib/org/org-context";
import { readDrawerCandidate } from "@/lib/shortlists/queries";
import { cn } from "@/lib/utils";

import { DecisionPill } from "../decision-pill";
import { DimensionMeters } from "../dimension-meters";
import { TierPill } from "../tier-pill";

import type { RowCandidate } from "./use-analysis";

const TRIAGE_KEYS: Record<TriageVerdict, TranslationKey> = {
  yes: "briefs.triage.yes",
  close: "briefs.triage.close",
  unknown: "briefs.triage.unknown",
  no: "briefs.triage.no",
};

const MARKS = {
  positive: "text-positive",
  caution: "text-caution-foreground dark:text-caution",
  neutral: "text-muted-foreground",
} as const;

/** A section of the drawer: a small heading, an optional aside on its right, the content. */
function DrawerSection({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="min-w-0 space-y-3">
      <div className="flex min-w-0 items-center justify-between gap-3">
        <h3 className="label-caps flex min-w-0 items-center gap-1">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** A short list of facts, each led by one mark in a tone, so the lists read apart without colour alone. */
function FactList({
  items,
  icon: Icon,
  tone,
}: {
  items: readonly string[];
  icon: typeof CircleCheck;
  tone: keyof typeof MARKS;
}) {
  return (
    <ul className="space-y-2">
      {items.map((item, index) => (
        <li key={`${index}:${item}`} className="flex items-start gap-2 text-sm text-ink">
          <Icon aria-hidden="true" className={cn("mt-0.5 size-4 shrink-0", MARKS[tone])} />
          <span className="min-w-0">{item}</span>
        </li>
      ))}
    </ul>
  );
}

function isTyping(target: EventTarget): boolean {
  return (
    target instanceof HTMLElement &&
    target.closest("input, textarea, select, [contenteditable='true']") !== null
  );
}

export function MatchDrawer({
  list,
  index,
  onIndexChange,
  onClose,
  criteria,
  candidateOf,
  orgId,
  added,
  shortlistId,
  canAdd,
  onAdd,
}: {
  /** The list the drawer walks: the matches, or the near profiles. */
  list: readonly MatchResult[];
  /** The profile shown; null closes the drawer. */
  index: number | null;
  onIndexChange: (index: number) => void;
  onClose: () => void;
  /** The criteria of the analysis, in the order the requirement rows follow. */
  criteria: readonly BriefCriterion[];
  candidateOf: (candidateId: string) => RowCandidate;
  orgId: string;
  added: (candidateId: string) => boolean;
  shortlistId: string | null;
  canAdd: boolean;
  onAdd: (result: MatchResult) => Promise<void>;
}) {
  const { t, locale } = useI18n();
  const { showPhotos } = useOrg();
  const current = index === null ? null : (list[index] ?? null);
  // The last profile shown stays rendered while the drawer slides out.
  const lastRef = useRef<MatchResult | null>(null);
  if (current) lastRef.current = current;
  const shown: MatchResult | null = current ?? lastRef.current;
  const open = current !== null;
  const candidate = shown ? candidateOf(shown.candidateId) : undefined;
  const photoUrl = usePhotoUrl(candidate?.photo_path ?? null, showPhotos && Boolean(candidate));
  // The years are not in the rows' read: one small read per profile opened.
  const details = useQuery(
    `match-drawer:${orgId}:${shown?.candidateId ?? ""}`,
    async () =>
      shown ? readDrawerCandidate(await requireSupabase(), orgId, shown.candidateId) : null,
    open && shown !== null && Boolean(candidate),
  );

  const hasPrevious = index !== null && index > 0;
  const hasNext = index !== null && index < list.length - 1;
  function go(step: -1 | 1) {
    if (index === null) return;
    const next = index + step;
    if (next >= 0 && next < list.length) onIndexChange(next);
  }
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    if (isTyping(event.target)) return;
    if (event.key === "ArrowLeft" && hasPrevious) {
      event.preventDefault();
      go(-1);
    } else if (event.key === "ArrowRight" && hasNext) {
      event.preventDefault();
      go(1);
    }
  }

  const name = candidate
    ? displayName(candidate, t("briefs.results.noName"))
    : candidate === null
      ? t("briefs.results.gone")
      : t("common.loading");
  const position = candidate ? currentPosition(candidate) : null;
  const meta = [
    candidate?.location?.trim() ?? "",
    // The read answers for the profile it was made for: walking the list never shows the previous one's years.
    yearsLabel(
      locale,
      details.data && details.data.id === shown?.candidateId ? details.data.years_experience : null,
    ),
  ]
    .filter((part) => part.length > 0)
    .join(" · ");
  const assessment = shown?.assessment ?? null;
  const tier = shown ? tierOf(shown) : null;
  const score = assessment ? Math.round(assessment.score) : null;
  const challenge = assessment?.challenge ?? null;
  const doubt =
    challenge?.verdict === "doubt" && challenge.reason?.trim() ? challenge.reason.trim() : null;
  const strengths = assessment?.strengths ?? [];
  const concerns = [
    ...(doubt ? [t("briefs.drawer.doubt", { reason: doubt })] : []),
    ...(assessment?.concerns ?? []).filter((concern) => concern.trim() !== doubt),
  ];
  const questions = assessment?.questions ?? [];
  const withheld = assessment?.withheld ?? 0;
  const rankNote = assessment?.rankNote?.trim() || null;
  const rows: RequirementRow[] = shown
    ? requirementRows(criteria, shown).map(({ kind, evidenceUnverified, ...row }) => ({
        ...row,
        label: kind === "role" ? `${t(kindKey(kind))} · ${row.label}` : row.label,
        evidence: row.evidence
          ? evidenceUnverified
            ? `${row.evidence} · ${t("briefs.results.evidence.unverified")}`
            : row.evidence
          : row.met === "unknown"
            ? t("common.unknown")
            : null,
      }))
    : [];
  const markLabel = (met: RequirementMet) => t(`briefs.met.${met}`);
  const isAdded = shown ? added(shown.candidateId) : false;

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <SheetContent
        side="right"
        size="lg"
        className="flex flex-col gap-6 overflow-hidden"
        onKeyDown={onKeyDown}
      >
        {shown ? (
          <>
            <SheetHeader className="shrink-0 gap-4">
              <div className="flex items-start gap-4">
                <Avatar name={name} size="lg" photoUrl={photoUrl} decorative />
                <div className="min-w-0 flex-1">
                  <SheetTitle className="truncate">{name}</SheetTitle>
                  <SheetDescription className="truncate text-sm">
                    {position
                      ? position.company
                        ? `${position.title} @ ${position.company}`
                        : position.title
                      : t("common.unknown")}
                  </SheetDescription>
                  {meta ? <p className="truncate text-meta text-muted-foreground">{meta}</p> : null}
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {tier ? <TierPill tier={tier} /> : null}
                    <DecisionPill decision={decisionOf(shown)} />
                    {candidate?.status === "archived" ? (
                      <Pill dot>{t("briefs.results.archived")}</Pill>
                    ) : null}
                  </div>
                </div>
                <ScoreRing
                  score={score}
                  label={
                    score === null
                      ? t("briefs.results.noScore")
                      : t("briefs.results.score", { score })
                  }
                />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                {candidate ? (
                  <div className="flex flex-wrap items-center gap-2">
                    {isAdded && shortlistId ? (
                      <Button asChild variant="outline" icon={<ListChecks />}>
                        <Link to={shortlistPath(shortlistId)}>
                          {t("briefs.results.seeShortlist")}
                        </Link>
                      </Button>
                    ) : canAdd ? (
                      <Button
                        type="button"
                        icon={<ListPlus />}
                        onClick={() => void onAdd(shown)}
                        disabled={isAdded}
                      >
                        {t("briefs.results.addToShortlist")}
                      </Button>
                    ) : null}
                    <Button asChild variant="outline" icon={<UserRound />}>
                      <Link to={candidatePath(candidate.id)}>{t("briefs.drawer.openProfile")}</Link>
                    </Button>
                  </div>
                ) : (
                  <span />
                )}
                {list.length > 1 && index !== null ? (
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={t("briefs.drawer.previous")}
                      onClick={() => go(-1)}
                      disabled={!hasPrevious}
                    >
                      <ChevronLeft aria-hidden="true" />
                    </Button>
                    <span className="min-w-14 text-center text-meta text-muted-foreground tabular-nums">
                      {t("briefs.drawer.position", { index: index + 1, total: list.length })}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={t("briefs.drawer.next")}
                      onClick={() => go(1)}
                      disabled={!hasNext}
                    >
                      <ChevronRight aria-hidden="true" />
                    </Button>
                  </div>
                ) : null}
              </div>
            </SheetHeader>

            <SheetBody key={shown.candidateId} className="fade-in space-y-8 pb-2">
              {assessment ? (
                <DrawerSection
                  title={t("briefs.drawer.why")}
                  aside={
                    <span className="shrink-0 text-meta text-muted-foreground">
                      {t("briefs.results.why")}
                    </span>
                  }
                >
                  <p
                    className={cn(
                      "text-body",
                      assessment.summary.trim() ? "text-ink" : "text-muted-foreground",
                    )}
                  >
                    {assessment.summary.trim() || t("common.unknown")}
                  </p>
                  {rankNote ? (
                    <p className="text-sm text-muted-foreground">
                      {t("briefs.drawer.rankNote", { note: rankNote })}
                    </p>
                  ) : null}
                  {withheld > 0 ? (
                    <p className="text-meta text-muted-foreground">
                      {withheld === 1
                        ? t("briefs.results.withheld.one")
                        : t("briefs.results.withheld.many", { count: withheld })}
                    </p>
                  ) : null}
                </DrawerSection>
              ) : null}

              {assessment?.dimensions ? (
                <DrawerSection
                  title={t("briefs.drawer.reading")}
                  aside={
                    <InfoTip label={t("briefs.drawer.reading")}>
                      {t("briefs.drawer.composite")}
                      {typeof assessment.modelScore === "number"
                        ? ` ${t("briefs.drawer.modelScore", { score: Math.round(assessment.modelScore) })}`
                        : ""}
                    </InfoTip>
                  }
                >
                  <DimensionMeters dimensions={assessment.dimensions} />
                </DrawerSection>
              ) : null}

              {strengths.length || concerns.length ? (
                <div className="grid gap-8 lg:grid-cols-2">
                  {strengths.length ? (
                    <DrawerSection title={t("briefs.results.strengths")}>
                      <FactList items={strengths} icon={CircleCheck} tone="positive" />
                    </DrawerSection>
                  ) : null}
                  {concerns.length ? (
                    <DrawerSection title={t("briefs.results.concerns")}>
                      <FactList items={concerns} icon={TriangleAlert} tone="caution" />
                    </DrawerSection>
                  ) : null}
                </div>
              ) : null}

              {rows.length ? (
                <DrawerSection title={t("briefs.results.requirements")}>
                  <RequirementList
                    rows={rows}
                    markLabel={markLabel}
                    requiredLabel={t("common.required")}
                    compact
                    className="-mt-2"
                  />
                </DrawerSection>
              ) : null}

              {questions.length ? (
                <DrawerSection title={t("briefs.results.questions")}>
                  <FactList items={questions} icon={MessageSquare} tone="neutral" />
                </DrawerSection>
              ) : null}

              {shown.triage ? (
                <DrawerSection title={t("briefs.analysis.step.triage")}>
                  <p className="text-sm text-muted-foreground">
                    <span className="font-medium">{t(TRIAGE_KEYS[shown.triage.verdict])}</span>
                    {shown.triage.reason ? ` · ${shown.triage.reason}` : ""}
                  </p>
                </DrawerSection>
              ) : null}
            </SheetBody>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
