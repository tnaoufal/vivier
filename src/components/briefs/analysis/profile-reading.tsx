/**
 * The selected profile in the reading pane (in a sheet on a phone): the
 * photo or the initials, the name, one line of what the CV states (the
 * position held today, the years, the place, the availability), then
 * the tier, the score as a figure and "Lecture du modèle" ("Proche" for
 * a near profile; the triage's verdict for a profile it set aside; on
 * the shortlist, or for a match already on it, the decision with who
 * took it and when, and "Lecture du modèle" moves to the model's
 * sentence: said once per sheet); the actions for a member (Retenir,
 * Écarter, or Réexaminer the decision taken, never a first decision on
 * a profile the shortlist already holds; "Lire quand même" for a
 * profile the model did not read in full), the CV read in place and the
 * way to the candidate's page.
 * Then, in two columns from `md`, each under its label: why this
 * profile (the ranking's note, else the reading's summary), the
 * requirements of the brief with their evidence (what the CV does not
 * say reads "Non renseigné", never as a lack), the reading against the
 * role (the five dimensions, how the score is composed behind an info
 * icon), the strengths, the reservations (the second reading's doubt
 * marked as such), the points for the interview, and the triage's
 * verdict and reason in one muted line. A profile no model read shows
 * its requirements alone. Nothing selected: one quiet line.
 */
import { Fragment, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, Check, FileSearch, FileText, RotateCcw, UserRound, X } from "lucide-react";

import { Avatar } from "@/components/app-shell/avatar";
import { InfoTip } from "@/components/app-shell/info-tip";
import { Pill, type PillTone } from "@/components/app-shell/pill";
import { RequirementList, type RequirementRow } from "@/components/app-shell/requirement-list";
import { CvViewer } from "@/components/candidates/cv-viewer";
import { Button } from "@/components/ui/button";
import { requireSupabase } from "@/lib/auth/supabase-client";
import { decisionOf, requirementRows } from "@/lib/briefs/assessment";
import { kindKey } from "@/lib/briefs/criteria";
import { candidatePath } from "@/lib/briefs/paths";
import { requirementTally, screenLine } from "@/lib/briefs/presentation";
import { primaryDocument } from "@/lib/candidates/cv-viewer";
import { displayName, sheetLine } from "@/lib/candidates/format";
import { listCandidateDocuments } from "@/lib/candidates/queries";
import { usePhotoUrl } from "@/lib/candidates/use-photo-url";
import { useQuery } from "@/lib/data/use-query";
import type {
  BriefCriterion,
  DocumentRow,
  MatchResult,
  RequirementMet,
  ShortlistItemStatus,
} from "@/lib/db/types";
import { formatDateTime, useI18n, type TranslationKey } from "@/lib/i18n";
import { useOrg } from "@/lib/org/org-context";
import { decisionTraceOf, type DecisionTrace } from "@/lib/shortlists/decision-line";
import type { ReadingSubject } from "@/lib/shortlists/groups";
import type { BoardItem } from "@/lib/shortlists/queries";
import {
  assessedScore,
  criteriaOf,
  modelReading,
  recruiterReadingOf,
  tierOf,
} from "@/lib/shortlists/requirements";
import { useMemberNamer } from "@/lib/shortlists/use-members";
import { cn } from "@/lib/utils";

import { DecisionPill } from "../decision-pill";
import { DimensionMeters } from "../dimension-meters";
import { TierPill } from "../tier-pill";

import { DECISION_ICONS, DECISION_KEYS, TRIAGE_KEYS } from "./group-rows";
import type { RowCandidate } from "./use-analysis";

/** The trace of a shortlist item as a pill: the decision taken, a profile put back under review, else who added it. */
const TRACE_PILLS: Record<
  DecisionTrace["kind"],
  { tone: PillTone; icon: typeof Check | null; key: TranslationKey }
> = {
  retained: { tone: "positive", icon: Check, key: "shortlists.trace.retained" },
  dismissed: { tone: "negative", icon: X, key: "shortlists.trace.dismissed" },
  reviewed: { tone: "caution", icon: RotateCcw, key: "shortlists.trace.reviewed" },
  added: { tone: "neutral", icon: null, key: "shortlists.item.addedBy" },
};

/** The decisions the pane offers on a shortlist item: the one taken becomes "Réexaminer"; retaining is the filled one. */
function itemDecisions(
  status: ShortlistItemStatus,
): { status: ShortlistItemStatus; variant: "primary" | "outline" }[] {
  if (status === "retained")
    return [
      { status: "to_review", variant: "outline" },
      { status: "dismissed", variant: "outline" },
    ];
  if (status === "dismissed")
    return [
      { status: "retained", variant: "primary" },
      { status: "to_review", variant: "outline" },
    ];
  return [
    { status: "retained", variant: "primary" },
    { status: "dismissed", variant: "outline" },
  ];
}

/** A block of the reading: its label (with whose reading it is, when said there), an optional aside on the right, the content; `wide` spans both columns. */
function Block({
  title,
  mark,
  aside,
  wide = false,
  children,
}: {
  title: string;
  /** Said after the title, on its line: "Lecture du modèle". */
  mark?: string | undefined;
  aside?: ReactNode;
  wide?: boolean | undefined;
  children: ReactNode;
}) {
  return (
    <section className={cn("min-w-0 space-y-2", wide && "md:col-span-2")}>
      <div className="flex min-w-0 items-center justify-between gap-3">
        <h3 className="label-caps min-w-0">
          {title}
          {mark ? <span className="font-normal"> · {mark}</span> : null}
        </h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** A short list of facts as plain bullets. */
function Points({ items }: { items: readonly string[] }) {
  return (
    <ul className="list-disc space-y-1 pl-5 text-sm text-ink">
      {items.map((item, index) => (
        <li key={`${index}:${item}`} className="break-words">
          {item}
        </li>
      ))}
    </ul>
  );
}

export function ProfileReading({
  subject,
  candidate,
  criteria,
  orgId,
  canEdit,
  provisional,
  canReadAnyway,
  busy,
  shortlistItem,
  added = false,
  onDecide,
  onReadAnyway,
  onBack,
}: {
  /** The row selected; null when none is. */
  subject: ReadingSubject | null;
  /** Undefined while it is read, null when the candidate was erased. */
  candidate: RowCandidate;
  /** The criteria of the analysis (a shortlist item carries its own). */
  criteria: readonly BriefCriterion[];
  orgId: string;
  canEdit: boolean;
  /** The analysis is not through: a match the second reading has not seen is marked. */
  provisional: boolean;
  canReadAnyway: boolean;
  /** True while a write on this profile is under way. */
  busy: boolean;
  /** A result the shortlist already holds: its item, whose decision (who, when) and own decisions stand in place of a first one. */
  shortlistItem?: BoardItem | null | undefined;
  /** A result on the shortlist whose item is not read yet: said, and no decision offered until it is. */
  added?: boolean | undefined;
  /** A decision on the profile: on the shortlist straight away for a result, on its item otherwise. */
  onDecide: (status: ShortlistItemStatus) => Promise<unknown>;
  onReadAnyway: (candidateId: string) => Promise<unknown>;
  /** Below `lg`, the way back to the list. */
  onBack?: (() => void) | undefined;
}) {
  const { t, locale } = useI18n();
  const { showPhotos } = useOrg();
  const nameOf = useMemberNamer();
  const photoUrl = usePhotoUrl(candidate?.photo_path ?? null, showPhotos && Boolean(candidate));
  // The CV the person may open: the documents of the profile, read once it is selected.
  const candidateId = candidate?.id ?? null;
  const documents = useQuery(
    `profile-documents:${orgId}:${candidateId ?? ""}`,
    async () =>
      candidateId ? listCandidateDocuments(await requireSupabase(), orgId, candidateId) : [],
    candidateId !== null,
  );
  // A read under way names no CV: rows another profile left behind never answer for this one.
  const cv = documents.data && !documents.loading ? primaryDocument(documents.data) : null;
  // The viewer keeps its document while it slides out, so the frame does not blank mid-motion.
  const [viewer, setViewer] = useState<{ open: boolean; document: DocumentRow | null }>({
    open: false,
    document: null,
  });

  if (!subject) {
    return (
      <p className="flex flex-1 items-center justify-center px-6 py-16 text-sm text-muted-foreground">
        {t("briefs.reading.none")}
      </p>
    );
  }

  const match: MatchResult | null =
    subject.kind === "result"
      ? subject.result
      : subject.kind === "item"
        ? subject.item.match
        : null;
  const assessment = match?.assessment ?? null;
  const tier = tierOf(match);
  const score = assessedScore(match);
  const reading = recruiterReadingOf(match);
  const summary = modelReading(match);
  const why = reading?.rankNote ?? summary;
  const withheld = assessment?.withheld ?? 0;
  const decision = match ? decisionOf(match) : null;
  const unconfirmed =
    subject.kind === "result" && provisional && decision === "fit" && !match?.assessment?.challenge;
  /** "62 / 100": a score with its scale, as every score on the sheet. */
  const outOf100 = (value: number) => t("shortlists.item.score", { score: value });
  const screen = match
    ? screenLine(match.screen, (value) => t("briefs.screen.score", { score: value }))
    : null;
  const tally = match && !assessment ? requirementTally(match) : null;

  const name = candidate
    ? displayName(candidate, t("briefs.results.noName"))
    : candidate === null
      ? t("briefs.results.gone")
      : t("common.loading");
  // Only what the CV states: the position held today and where, the years, the place, the availability.
  const facts = candidate
    ? [
        sheetLine(locale, candidate, (company) => t("candidates.atCompany", { company })),
        candidate.availability?.trim(),
      ]
        .filter((part): part is string => typeof part === "string" && part.length > 0)
        .join(" · ")
    : "";

  const markLabel = (met: RequirementMet) => t(`briefs.met.${met}`);
  const rows: RequirementRow[] = match
    ? requirementRows(criteriaOf(criteria, match), match).map(
        ({ kind, evidenceUnverified, ...row }) => ({
          ...row,
          label: kind === "role" ? `${t(kindKey(kind))} · ${row.label}` : row.label,
          evidence: row.evidence
            ? evidenceUnverified
              ? `${row.evidence} · ${t("briefs.results.evidence.unverified")}`
              : row.evidence
            : row.met === "unknown"
              ? t("common.unknown")
              : null,
        }),
      )
    : [];

  // The shortlist's item: the subject's own, or the one of a result the shortlist already holds.
  const item = subject.kind === "item" ? subject.item : (shortlistItem ?? null);
  /** What stands beside the score: the decision on the shortlist (who, when), else what the model said of the profile. */
  let status: ReactNode = null;
  if (item) {
    const trace = decisionTraceOf(item);
    const look = TRACE_PILLS[trace.kind];
    const Icon = look.icon;
    status = (
      <Pill
        tone={look.tone}
        dot={false}
        icon={Icon ? <Icon /> : undefined}
        title={formatDateTime(locale, trace.at)}
      >
        {t(look.key, { name: nameOf(trace.by), when: formatDateTime(locale, trace.at) })}
      </Pill>
    );
  } else if (subject.kind === "triage") {
    status = (
      <Pill tone="negative" icon={<X />}>
        {t(TRIAGE_KEYS[subject.verdict])}
      </Pill>
    );
  } else if (subject.kind === "screened") {
    status = (
      <span className="text-meta text-muted-foreground tabular-nums">
        {screenLine({ score: subject.score, reason: subject.reason }, outOf100)}
      </span>
    );
  } else if (added) {
    status = (
      <Pill dot={false} icon={<Check />}>
        {t("briefs.match.addedLabel")}
      </Pill>
    );
  } else if (unconfirmed) {
    status = (
      <span className="text-meta text-muted-foreground">{t("briefs.match.unconfirmed")}</span>
    );
  } else if (decision === "borderline") {
    status = <Pill tone="caution">{t("briefs.profile.near")}</Pill>;
  } else if (decision === "no_fit" || decision === "unassessed") {
    status = <DecisionPill decision={decision} />;
  }
  // The reading is the model's, said once per sheet: beside the figure, or on the model's sentence when a decision stands beside the figure.
  const modelSpoke = assessment !== null || Boolean(why) || subject.kind === "screened";
  const markOnWhy = item !== null && Boolean(why);
  const byModel = modelSpoke && !markOnWhy;

  const decisions =
    item !== null
      ? itemDecisions(item.status)
      : subject.kind === "result" && !added
        ? [
            {
              status: "retained" as const,
              variant: decision === "no_fit" ? ("outline" as const) : ("primary" as const),
            },
            { status: "dismissed" as const, variant: "outline" as const },
          ]
        : [];
  const readAnyway = canReadAnyway && (subject.kind === "triage" || subject.kind === "screened");

  return (
    <div className="flex min-h-full flex-col">
      <header className="shrink-0 border-b border-line p-4 sm:p-6 max-lg:pr-14">
        <div className="flex items-start gap-4">
          {onBack ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              icon={<ArrowLeft />}
              onClick={onBack}
              aria-label={t("common.back")}
              className="-ml-2 shrink-0 lg:hidden"
            />
          ) : null}
          <Avatar
            name={candidate ? name : ""}
            size="xl"
            variant="profile"
            photoUrl={photoUrl}
            decorative
            className="size-16 text-base"
          />
          <div className="min-w-0 flex-1">
            <h2
              className={cn(
                "truncate text-xl leading-[1.625rem] font-semibold",
                candidate ? "text-ink" : "text-muted-foreground",
              )}
            >
              {name}
            </h2>
            <p className="mt-0.5 truncate text-sm text-muted-foreground">
              {facts || (candidate ? t("common.unknown") : "")}
            </p>
            <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1.5">
              {tier ? <TierPill tier={tier} /> : null}
              {score !== null ? (
                <span
                  className="text-sm font-semibold text-ink tabular-nums"
                  title={t("shortlists.item.fitScore", { score })}
                >
                  {t("shortlists.item.score", { score })}
                </span>
              ) : null}
              {status}
              {byModel ? (
                <span className="text-meta text-muted-foreground">{t("briefs.results.why")}</span>
              ) : null}
              {candidate?.status === "archived" ? (
                <Pill size="sm">{t("briefs.results.archived")}</Pill>
              ) : null}
            </div>
          </div>
        </div>
        {candidate ? (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {canEdit && readAnyway ? (
              <Button
                type="button"
                variant="primary"
                icon={<FileSearch />}
                disabled={busy}
                aria-busy={busy || undefined}
                onClick={() => void onReadAnyway(subject.candidateId)}
              >
                {t("briefs.setAside.readAnyway")}
              </Button>
            ) : null}
            {canEdit
              ? decisions.map((entry) => {
                  const Icon = DECISION_ICONS[entry.status];
                  return (
                    <Fragment key={entry.status}>
                      <Button
                        type="button"
                        variant={entry.variant}
                        icon={<Icon />}
                        disabled={busy}
                        aria-busy={busy || undefined}
                        onClick={() => void onDecide(entry.status)}
                      >
                        {t(DECISION_KEYS[entry.status])}
                      </Button>
                    </Fragment>
                  );
                })
              : null}
            {documents.data === null || documents.loading || cv !== null ? (
              <Button
                type="button"
                variant="outline"
                icon={<FileText />}
                disabled={cv === null}
                onClick={() => setViewer({ open: true, document: cv })}
              >
                {t("briefs.profile.cv")}
              </Button>
            ) : null}
            <Button asChild variant="ghost" icon={<UserRound />}>
              <Link to={candidatePath(candidate.id)}>{t("briefs.drawer.openProfile")}</Link>
            </Button>
          </div>
        ) : null}
      </header>

      <div
        key={subject.candidateId}
        className="fade-in grid gap-6 gap-x-8 p-4 sm:p-6 md:grid-cols-2"
      >
        {why ? (
          <Block
            wide
            title={t("briefs.drawer.why")}
            mark={markOnWhy ? t("briefs.results.why") : undefined}
          >
            <p className="text-sm leading-[1.3125rem] text-ink break-words">{why}</p>
            {withheld > 0 ? (
              <p className="text-meta text-muted-foreground">
                {withheld === 1
                  ? t("briefs.results.withheld.one")
                  : t("briefs.results.withheld.many", { count: withheld })}
              </p>
            ) : null}
          </Block>
        ) : null}

        {rows.length ? (
          <Block title={t("briefs.results.requirements")}>
            <RequirementList
              rows={rows}
              markLabel={markLabel}
              requiredLabel={t("common.required")}
              compact
              className="-mt-1"
            />
            {tally && tally.total > 0 ? (
              <p className="text-meta text-muted-foreground tabular-nums">
                {tally.total === 1
                  ? t("briefs.match.tally.one", { met: tally.met })
                  : t("briefs.match.tally", { met: tally.met, total: tally.total })}
              </p>
            ) : null}
          </Block>
        ) : subject.kind === "item" && !match ? (
          <Block title={t("briefs.results.requirements")}>
            <p className="text-sm text-muted-foreground">{t("shortlists.item.noMatch")}</p>
          </Block>
        ) : null}

        {assessment?.dimensions ? (
          <Block
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
          </Block>
        ) : null}

        {reading && reading.strengths.length ? (
          <Block title={t("briefs.results.strengths")}>
            <Points items={reading.strengths} />
          </Block>
        ) : null}

        {reading && reading.concerns.length ? (
          <Block title={t("briefs.results.concerns")}>
            <ul className="list-disc space-y-1 pl-5 text-sm text-ink">
              {reading.concerns.map((point, index) => (
                <li key={`${index}:${point.text}`} className="break-words">
                  {/* The second reading's doubt reads apart from the first pass's reservations. */}
                  {point.challenge ? (
                    <Pill tone="caution" dot={false} size="sm" className="mr-1.5 align-text-bottom">
                      {t("shortlists.reading.challenge")}
                    </Pill>
                  ) : null}
                  {point.text}
                </li>
              ))}
            </ul>
          </Block>
        ) : null}

        {reading && reading.questions.length ? (
          <Block wide title={t("briefs.results.questions")}>
            <Points items={reading.questions} />
          </Block>
        ) : null}

        {/* What the funnel decided before the full reading: the triage's verdict and reason, the screening's score. */}
        {match?.triage || (screen && subject.kind !== "screened") ? (
          <p className="text-meta text-muted-foreground md:col-span-2">
            {match?.triage ? (
              <>
                <span className="font-medium">{t(TRIAGE_KEYS[match.triage.verdict])}</span>
                {match.triage.reason ? ` · ${match.triage.reason}` : ""}
              </>
            ) : null}
            {match?.triage && screen ? " · " : ""}
            {screen && subject.kind !== "screened" ? (
              <span className="tabular-nums">{screen}</span>
            ) : null}
          </p>
        ) : null}
        {subject.kind === "triage" && subject.reason ? (
          <p className="text-meta text-muted-foreground md:col-span-2">{subject.reason}</p>
        ) : null}
      </div>

      <CvViewer
        open={viewer.open}
        onOpenChange={(open) => setViewer((state) => ({ ...state, open }))}
        document={viewer.document}
        candidateName={name}
      />
    </div>
  );
}
