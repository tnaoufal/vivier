/**
 * One profile of an analysis in a drawer from the right, to decide
 * whether to present it without leaving the list: the header names the
 * person (photo or initials, the position held today, the years, "Non
 * renseigné" when the CV states none, and where) with the tier, the
 * decision when it is not "matches" (a near profile; every row of the
 * main list matches) and the score as a plain figure, the buttons (and
 * the left and right arrow keys) that walk the list, and one row of
 * actions (add to the shortlist, open the profile); then, in this
 * order, why this profile (the ranking's note
 * first, why it ranks there, then the reading's summary, marked as the
 * model's), the requirements of the brief with the evidence (the role
 * first; what the CV does not say reads "Non renseigné", never as a
 * lack), the strengths and the reservations side by side (the second
 * reading's doubt first), the reading against the role (the five
 * dimensions, how the score is composed behind an info icon), the
 * points for the interview, the triage's verdict, small and muted, and
 * the team's thread on the candidate (the same one as the candidate's
 * page). A profile no model read shows its requirements alone.
 */
import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, ListChecks, ListPlus, UserRound } from "lucide-react";

import { Avatar } from "@/components/app-shell/avatar";
import { InfoTip } from "@/components/app-shell/info-tip";
import { Pill } from "@/components/app-shell/pill";
import { RequirementList, type RequirementRow } from "@/components/app-shell/requirement-list";
import { TeamThread } from "@/components/thread/team-thread";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useAuth } from "@/lib/auth/auth-context";
import { requireSupabase } from "@/lib/auth/supabase-client";
import { decisionOf, requirementRows, tierOf } from "@/lib/briefs/assessment";
import { kindKey } from "@/lib/briefs/criteria";
import { candidatePath } from "@/lib/briefs/paths";
import { readCandidateYears } from "@/lib/briefs/queries";
import { currentPosition, displayName, yearsLabel } from "@/lib/candidates/format";
import { usePhotoUrl } from "@/lib/candidates/use-photo-url";
import { useQuery } from "@/lib/data/use-query";
import type { BriefCriterion, MatchResult, RequirementMet, TriageVerdict } from "@/lib/db/types";
import { useI18n, type TranslationKey } from "@/lib/i18n";
import { useOrg } from "@/lib/org/org-context";
import { useTeamMembers } from "@/lib/shortlists/use-members";
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

/** A short list of facts as plain bullets: the heading names the list, as in the shortlist's drawer. */
function FactList({ items }: { items: readonly string[] }) {
  return (
    <ul className="list-disc space-y-1.5 pl-5 text-sm text-ink">
      {items.map((item, index) => (
        <li key={`${index}:${item}`} className="break-words">
          {item}
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
  canAdd,
  onAdd,
  onShowShortlist,
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
  canAdd: boolean;
  onAdd: (result: MatchResult) => Promise<void>;
  /** Shows the brief's shortlist (its tab), for a profile already on it. */
  onShowShortlist: () => void;
}) {
  const { t, locale } = useI18n();
  const { showPhotos, can } = useOrg();
  const { user } = useAuth();
  const members = useTeamMembers();
  const current = index === null ? null : (list[index] ?? null);
  // The last profile shown stays rendered while the drawer slides out.
  const lastRef = useRef<MatchResult | null>(null);
  if (current) lastRef.current = current;
  const shown: MatchResult | null = current ?? lastRef.current;
  const open = current !== null;
  const candidate = shown ? candidateOf(shown.candidateId) : undefined;
  const photoUrl = usePhotoUrl(candidate?.photo_path ?? null, showPhotos && Boolean(candidate));
  // The years are not in the rows' read: one small read per profile opened.
  const years = useQuery(
    `match-drawer-years:${orgId}:${shown?.candidateId ?? ""}`,
    async () =>
      shown ? readCandidateYears(await requireSupabase(), orgId, shown.candidateId) : null,
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
  // Seniority first, then where. The read answers for the profile it was
  // made for, so walking the list never shows the previous one's years;
  // years the CV does not state read "Non renseigné" once it answered,
  // never while it is in flight.
  const yearsRead = years.data && years.data.id === shown?.candidateId ? years.data : null;
  const meta = [
    yearsRead ? yearsLabel(locale, yearsRead.years_experience) || t("common.unknown") : "",
    candidate?.location?.trim() ?? "",
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
  // One insert per click: the button only knows it was added once the shortlist is read again.
  const [adding, setAdding] = useState(false);
  async function addShown(result: MatchResult) {
    if (adding) return;
    setAdding(true);
    try {
      await onAdd(result);
    } finally {
      setAdding(false);
    }
  }

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
                    {decisionOf(shown) !== "fit" ? (
                      <DecisionPill decision={decisionOf(shown)} />
                    ) : null}
                    {candidate?.status === "archived" ? (
                      <Pill dot>{t("briefs.results.archived")}</Pill>
                    ) : null}
                  </div>
                </div>
                {/* The score as a figure: the number is the signal, nothing grades it. */}
                {score !== null ? (
                  <p className="shrink-0 text-right">
                    <span className="sr-only">{t("briefs.results.score", { score })}</span>
                    <span aria-hidden="true" className="tabular-nums">
                      <span className="font-display text-2xl text-ink">{score}</span>
                      <span className="text-meta text-muted-foreground"> / 100</span>
                    </span>
                  </p>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                {candidate ? (
                  <div className="flex flex-wrap items-center gap-2">
                    {isAdded ? (
                      <Button
                        type="button"
                        variant="outline"
                        icon={<ListChecks />}
                        onClick={onShowShortlist}
                      >
                        {t("briefs.results.seeShortlist")}
                      </Button>
                    ) : canAdd ? (
                      <Button
                        type="button"
                        icon={<ListPlus />}
                        onClick={() => void addShown(shown)}
                        disabled={adding}
                        aria-busy={adding || undefined}
                      >
                        {t("briefs.results.addToShortlist")}
                      </Button>
                    ) : null}
                    <Button asChild variant="link" icon={<UserRound />}>
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
                  {/* Why it ranks there first: the note that sets it apart from the others. */}
                  {rankNote ? <p className="text-body text-ink">{rankNote}</p> : null}
                  <p
                    className={cn(
                      rankNote ? "text-sm" : "text-body",
                      assessment.summary.trim() ? "text-ink" : "text-muted-foreground",
                    )}
                  >
                    {assessment.summary.trim() || t("common.unknown")}
                  </p>
                  {withheld > 0 ? (
                    <p className="text-meta text-muted-foreground">
                      {withheld === 1
                        ? t("briefs.results.withheld.one")
                        : t("briefs.results.withheld.many", { count: withheld })}
                    </p>
                  ) : null}
                </DrawerSection>
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

              {strengths.length || concerns.length ? (
                <div className="grid gap-8 lg:grid-cols-2">
                  {strengths.length ? (
                    <DrawerSection title={t("briefs.results.strengths")}>
                      <FactList items={strengths} />
                    </DrawerSection>
                  ) : null}
                  {concerns.length ? (
                    <DrawerSection title={t("briefs.results.concerns")}>
                      <FactList items={concerns} />
                    </DrawerSection>
                  ) : null}
                </div>
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
                  <DimensionMeters dimensions={assessment.dimensions} compact />
                </DrawerSection>
              ) : null}

              {questions.length ? (
                <DrawerSection title={t("briefs.results.questions")}>
                  <FactList items={questions} />
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

              {/* The team's thread on the person, the same one as the candidate's page. */}
              {candidate ? (
                <DrawerSection title={t("thread.title")}>
                  <TeamThread
                    target={{ candidateId: candidate.id }}
                    canPost={can("member")}
                    members={members}
                    currentUserId={user?.id ?? null}
                    compact
                    hideHeader
                  />
                </DrawerSection>
              ) : null}
            </SheetBody>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
