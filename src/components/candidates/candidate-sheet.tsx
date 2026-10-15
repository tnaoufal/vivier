/**
 * The sheet of a profile, on the pool's detail pane and on the
 * candidate's page. The head: the photo in greyscale (the initials
 * otherwise, square-rounded), the name, "Directrice juridique chez
 * Label'Vie · 19 ans · Casablanca", then "Français C2 · Anglais C1 ·
 * Disponible sous 1 mois" (only what the CV states), the small pills
 * that set the profile apart (archived, typed by hand, consent
 * withdrawn), a hint where the structuring was unsure, explained once
 * behind the info icon, and the actions (candidate-actions.tsx). Then
 * the blocks under label-caps titles, two columns once the sheet is
 * wide enough (its own width, not the viewport's: with the thread open
 * the pool's detail pane is narrow): the summary on three lines, the
 * career as a rail of positions, the education in one line each, the
 * contact details and the links; beside them the skills (eight chips
 * and "+ N", edited in place by a member), the documents, the five
 * nearest profiles, the team's tags and the consent folded to one line.
 * "Non renseigné" in muted text for what the CV did not state, never a
 * dash. `compact` is the page's variant: the Workspace header carries
 * the name, the position line and the actions, so the head keeps only
 * the photo, the facts and the pills. The sheet reads nothing itself
 * but the retention date and the neighbours: the caller hands it the
 * profile (use-candidate.ts) and hears of every write.
 */
import { Fragment, useCallback, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  Check,
  ExternalLink,
  Link2,
  Mail,
  Pencil,
  Phone,
  RefreshCw,
  TriangleAlert,
  UserRound,
} from "lucide-react";

import { Avatar } from "@/components/app-shell/avatar";
import { EmptyState } from "@/components/app-shell/empty-state";
import { InfoTip } from "@/components/app-shell/info-tip";
import { Pill } from "@/components/app-shell/pill";
import { Button } from "@/components/ui/button";
import { Skeleton, SkeletonRows } from "@/components/ui/skeleton";
import { requireSupabase } from "@/lib/auth/supabase-client";
import {
  confidenceTone,
  displayName,
  formatDateRange,
  formatDuration,
  sheetFacts,
  sheetLine,
} from "@/lib/candidates/format";
import { readRetentionDueAt } from "@/lib/candidates/queries";
import { SKILLS_SHOWN, visibleSkills } from "@/lib/candidates/skills";
import { useCandidateUpdate, type CandidateState } from "@/lib/candidates/use-candidate";
import { usePhotoUrl } from "@/lib/candidates/use-photo-url";
import { useQuery } from "@/lib/data/use-query";
import type { CandidateExperience, CandidateRow, ConfidenceMap, DocumentRow } from "@/lib/db/types";
import { useI18n, useT } from "@/lib/i18n";
import { useCurrentOrg, useOrg } from "@/lib/org/org-context";
import { cn } from "@/lib/utils";

import { Block, Unknown, type BlockHeading } from "./block";
import { CandidateActions } from "./candidate-actions";
import { Chip, ChipEditor } from "./chip-editor";
import { ClampedText } from "./clamped-text";
import { ConfidenceHint } from "./confidence-pill";
import { ConsentBlock, type ConsentPatch } from "./consent-block";
import { DocumentsBlock } from "./documents-block";
import { SimilarBlock } from "./similar-block";
import { TagsBlock } from "./tags-block";

/** The read fields the sheet marks with a confidence pill. */
const HINTED_FIELDS: readonly (keyof ConfidenceMap)[] = [
  "full_name",
  "headline",
  "languages",
  "summary",
  "experiences",
  "education",
  "skills",
  "email",
  "phone",
];

export function CandidateSheet({
  state,
  compact = false,
  onChanged,
  onErased,
}: {
  /** The profile as use-candidate.ts reads it. */
  state: CandidateState;
  /** On the candidate's page: no name and no actions in the head (the Workspace header has them). */
  compact?: boolean | undefined;
  /** Heard after every write, once the profile was read again (the pool reads its list again). */
  onChanged?: (() => void) | undefined;
  /** Where to go once the profile is erased. */
  onErased: () => void;
}) {
  const t = useT();
  const { candidate, loading, error, refreshCandidate } = state;
  if (loading) return <SheetSkeleton compact={compact} />;
  if (!candidate) {
    return error ? (
      <EmptyState
        quiet
        icon={<TriangleAlert />}
        title={t("common.error")}
        action={
          <Button
            type="button"
            variant="outline"
            icon={<RefreshCw />}
            onClick={() => void refreshCandidate()}
          >
            {t("common.retry")}
          </Button>
        }
      />
    ) : (
      <EmptyState
        quiet
        icon={<UserRound />}
        title={t("candidates.notFound.text")}
        action={
          compact ? (
            <Button asChild variant="outline" icon={<ArrowLeft />}>
              <Link to="/app/candidates">{t("candidates.back")}</Link>
            </Button>
          ) : undefined
        }
      />
    );
  }
  return (
    <ProfileSheet
      candidate={candidate}
      documents={state.documents}
      compact={compact}
      onChanged={onChanged}
      onErased={onErased}
      refreshCandidate={refreshCandidate}
      refreshDocuments={state.refreshDocuments}
    />
  );
}

function SheetSkeleton({ compact }: { compact: boolean }) {
  const t = useT();
  return (
    <div aria-busy="true">
      <p className="sr-only">{t("common.loading")}</p>
      <div
        className={cn(
          "flex items-center gap-4 border-b border-line",
          compact ? "px-6 py-4" : "p-6",
        )}
      >
        <Skeleton className={cn("shrink-0 rounded-lg", compact ? "size-11" : "size-18")} />
        <div className="flex-1 space-y-2.5">
          {compact ? null : <Skeleton className="h-5 w-1/3" />}
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-3 w-1/4" />
        </div>
      </div>
      <SkeletonRows rows={5} avatar={false} />
    </div>
  );
}

function ProfileSheet({
  candidate,
  documents,
  compact,
  onChanged,
  onErased,
  refreshCandidate,
  refreshDocuments,
}: {
  candidate: CandidateRow;
  documents: DocumentRow[];
  compact: boolean;
  onChanged: (() => void) | undefined;
  onErased: () => void;
  refreshCandidate: () => Promise<void>;
  refreshDocuments: () => Promise<void>;
}) {
  const { t, locale } = useI18n();
  const { org } = useCurrentOrg();
  const { can, showPhotos } = useOrg();
  const canEdit = can("member");
  const name = displayName(candidate, t("candidates.noName"));
  const photoUrl = usePhotoUrl(candidate.photo_path, showPhotos);
  const confidence: ConfidenceMap = candidate.confidence ?? {};
  // One explanation for every "to check" pill of the sheet, beside the name, only when one shows.
  const doubtful = HINTED_FIELDS.some((field) => confidenceTone(confidence[field]) !== "none");
  const marked =
    candidate.status === "archived" ||
    candidate.source === "manual" ||
    candidate.consent_status === "withdrawn";
  const line = sheetLine(locale, candidate, (company) => t("candidates.atCompany", { company }));
  const facts = sheetFacts(candidate);
  const heading: BlockHeading = compact ? "h2" : "h3";
  const now = new Date();

  // Every write reads the profile again, then tells the caller (the pool's list follows).
  const changed = useCallback(async () => {
    await refreshCandidate();
    onChanged?.();
  }, [refreshCandidate, onChanged]);
  const update = useCandidateUpdate(org.id, candidate.id, changed);
  const retention = useQuery(
    `retention:${candidate.id}:${candidate.last_contact_at ?? ""}:${candidate.created_at}`,
    async () => readRetentionDueAt(await requireSupabase(), candidate.id),
  );

  async function saveConsent(patch: ConsentPatch) {
    await update(patch, t("common.saved"));
  }

  const pills = marked ? (
    <>
      {candidate.status === "archived" ? (
        <Pill size="sm" dot>
          {t("candidates.status.archived")}
        </Pill>
      ) : null}
      {candidate.source === "manual" ? (
        <Pill size="sm">{t("candidates.source.manual")}</Pill>
      ) : null}
      {candidate.consent_status === "withdrawn" ? (
        <Pill size="sm" tone="negative">
          {t("candidates.consent.withdrawn")}
        </Pill>
      ) : null}
    </>
  ) : null;
  const help = doubtful ? (
    <InfoTip label={t("candidates.review")}>{t("candidates.confidence.help.check")}</InfoTip>
  ) : null;
  const factsLine = (
    <p className="text-meta text-muted-foreground">
      {facts || `${t("candidates.field.languages")} · ${t("common.unknown")}`}{" "}
      <ConfidenceHint value={confidence.languages} />
    </p>
  );

  const summary = candidate.summary?.trim() ?? "";
  const experiences = candidate.experiences ?? [];
  const education = candidate.education ?? [];
  const links = candidate.links ?? [];

  return (
    <div className="fade-in [animation-duration:var(--duration-fast)]">
      {compact ? (
        <div className="flex items-center gap-4 border-b border-line px-6 py-4">
          <Avatar name={name} size="lg" variant="profile" photoUrl={photoUrl} decorative />
          <div className="min-w-0 flex-1">
            {factsLine}
            {marked || doubtful ? (
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                {pills}
                <ConfidenceHint value={confidence.full_name} />
                <ConfidenceHint value={confidence.headline} />
                {help}
              </div>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4 border-b border-line p-6 sm:flex-row sm:items-center">
          <div className="flex min-w-0 flex-1 items-start gap-4 sm:items-center">
            <Avatar name={name} size="xl" variant="profile" photoUrl={photoUrl} decorative />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <h2 className="min-w-0 text-xl leading-[1.625rem] font-semibold text-ink break-words">
                  {name}
                </h2>
                <ConfidenceHint value={confidence.full_name} />
                {help}
              </div>
              <p className="mt-0.5 text-sm text-muted-foreground tabular-nums">
                {line || t("common.unknown")} <ConfidenceHint value={confidence.headline} />
              </p>
              <div className="mt-1">{factsLine}</div>
              {marked ? (
                <div className="mt-2.5 flex flex-wrap items-center gap-1.5">{pills}</div>
              ) : null}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <CandidateActions
              candidate={candidate}
              documents={documents}
              name={name}
              onChanged={changed}
              onErased={onErased}
            />
          </div>
        </div>
      )}

      <div className="@container">
        <div className="grid gap-6 gap-x-8 p-6 @2xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <div className="flex min-w-0 flex-col gap-6">
            <Block as={heading} title={t("candidates.field.summary")} hint={confidence.summary}>
              {summary ? (
                <ClampedText
                  text={summary}
                  lines={3}
                  className="text-sm leading-[1.3125rem] text-ink"
                />
              ) : (
                <Unknown />
              )}
            </Block>

            <Block
              as={heading}
              title={t("candidates.field.career")}
              hint={confidence.experiences}
              count={experiences.length}
            >
              {experiences.length ? (
                <CareerRail experiences={experiences} now={now} />
              ) : (
                <Unknown />
              )}
            </Block>

            <Block
              as={heading}
              title={t("candidates.field.education")}
              hint={confidence.education}
              count={education.length}
            >
              {education.length ? (
                <ul className="flex flex-col gap-1.5 text-meta leading-[1.1875rem]">
                  {education.map((entry, index) => (
                    <li key={`${entry.degree}-${index}`} className="text-ink break-words">
                      <span className="font-medium">
                        {entry.degree?.trim() || t("common.unknown")}
                      </span>
                      {entry.school?.trim() ? (
                        <span className="text-muted-foreground"> · {entry.school.trim()}</span>
                      ) : null}
                      {entry.year?.trim() ? (
                        <span className="text-muted-foreground tabular-nums">
                          {" "}
                          · {entry.year.trim()}
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <Unknown />
              )}
            </Block>

            <Block as={heading} title={t("candidates.field.contactLinks")}>
              <ul className="space-y-2">
                <ContactRow
                  icon={<Mail />}
                  href={candidate.email?.trim() ? `mailto:${candidate.email.trim()}` : null}
                  text={candidate.email}
                  hint={confidence.email}
                />
                <ContactRow
                  icon={<Phone />}
                  href={
                    candidate.phone?.trim() ? `tel:${candidate.phone.replace(/[^+\d]/g, "")}` : null
                  }
                  text={candidate.phone}
                  hint={confidence.phone}
                />
                {links.length ? (
                  links.map((link, index) => (
                    <Fragment key={`${link.url}-${index}`}>
                      <ContactRow
                        icon={<ExternalLink />}
                        href={link.url}
                        text={link.label?.trim() || link.url}
                        detail={link.label?.trim() ? hostOf(link.url) : undefined}
                        external
                      />
                    </Fragment>
                  ))
                ) : (
                  <ContactRow icon={<Link2 />} href={null} text={null} />
                )}
              </ul>
            </Block>
          </div>

          <div className="flex min-w-0 flex-col gap-6">
            <SkillsBlock
              as={heading}
              skills={candidate.skills ?? []}
              hint={confidence.skills}
              canEdit={canEdit}
              onChange={async (values) => {
                await update({ skills: values });
              }}
            />
            <DocumentsBlock
              as={heading}
              candidate={{ id: candidate.id, name }}
              documents={documents}
              canEdit={canEdit}
              onChanged={() => {
                void refreshDocuments();
                void changed();
              }}
            />
            <SimilarBlock
              as={heading}
              orgId={org.id}
              candidateId={candidate.id}
              name={name}
              showPhotos={showPhotos}
            />
            <TagsBlock
              as={heading}
              tags={candidate.tags ?? []}
              canEdit={canEdit}
              onChange={async (values) => {
                await update({ tags: values });
              }}
            />
            <ConsentBlock
              as={heading}
              candidate={candidate}
              retentionDueAt={retention.data ?? null}
              retentionMonths={org.retention_months}
              canEdit={canEdit}
              onSave={saveConsent}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * The career as a rail of positions: a dot per position (filled for
 * the one held today), "title · company" in bold, "depuis 2019 · 7 ans"
 * muted (the period and its duration computed, nothing estimated), the
 * description folded to two lines. The rail is drawn here rather than
 * with the Timeline primitive: its 7rem date column does not fit the
 * column of a detail pane.
 */
function CareerRail({
  experiences,
  now,
}: {
  experiences: readonly CandidateExperience[];
  /** The clock the durations of ongoing positions are counted to. */
  now: Date;
}) {
  const { t, locale } = useI18n();
  return (
    <ol className="stagger flex flex-col gap-3.5">
      {experiences.map((experience, index) => {
        const range = formatDateRange(locale, experience.start, experience.end);
        const duration = formatDuration(locale, experience.start, experience.end, now);
        const current = Boolean(experience.start?.trim()) && !experience.end?.trim();
        const description = experience.description?.trim() ?? "";
        const company = experience.company?.trim();
        const when = [range, duration].filter((part) => part.length > 0).join(" · ");
        return (
          <li
            key={`${experience.title}-${index}`}
            className="rise-in relative pl-[1.125rem] before:absolute before:top-1.5 before:-bottom-3.5 before:left-[0.3125rem] before:w-px before:bg-line last:before:hidden"
          >
            <span
              aria-hidden="true"
              className={cn(
                "absolute top-1.5 left-px size-[0.5625rem] rounded-full border-2 border-ink",
                current ? "bg-ink" : "bg-background",
              )}
            />
            <p className="text-meta leading-[1.1875rem] font-semibold text-ink break-words">
              {experience.title?.trim() || t("common.unknown")}
              {company ? ` · ${company}` : null}
              {current ? (
                <span className="sr-only"> ({t("candidates.experience.current")})</span>
              ) : null}
            </p>
            <p className="text-meta leading-[1.1875rem] text-muted-foreground tabular-nums">
              {when || t("common.unknown")}
            </p>
            {description ? (
              <ClampedText
                text={description}
                lines={2}
                className="mt-1 text-meta leading-[1.1875rem] text-ink-soft"
              />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

/** The skills: quiet chips, the first eight then "+ N", or the editor in place for a member. */
function SkillsBlock({
  as,
  skills,
  hint,
  canEdit,
  onChange,
}: {
  as: BlockHeading;
  skills: string[];
  hint: number | null | undefined;
  canEdit: boolean;
  onChange: (values: string[]) => Promise<void>;
}) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const { shown, hidden } = visibleSkills(skills, expanded);

  return (
    <Block
      as={as}
      title={t("candidates.field.skills")}
      hint={hint}
      count={skills.length}
      action={
        canEdit ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            icon={editing ? <Check /> : <Pencil />}
            onClick={() => setEditing((value) => !value)}
            aria-label={editing ? t("candidates.skills.done") : t("candidates.skills.edit")}
            aria-pressed={editing}
            className="text-muted-foreground hover:text-ink"
          />
        ) : null
      }
    >
      {editing ? (
        <ChipEditor
          values={skills}
          canEdit
          emptyKey="common.unknown"
          placeholder={t("candidates.skills.placeholder")}
          onChange={onChange}
        />
      ) : !skills.length ? (
        <Unknown />
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {shown.map((skill) => (
            <li key={skill} className="min-w-0">
              <Chip>{skill}</Chip>
            </li>
          ))}
          {hidden > 0 || skills.length > SKILLS_SHOWN ? (
            <li>
              {/* An outlined chip; the pseudo-element around it makes a 40px target. */}
              <button
                type="button"
                onClick={() => setExpanded((value) => !value)}
                aria-expanded={expanded}
                className="press relative inline-flex h-7 cursor-pointer items-center rounded-full border border-line px-2.5 text-meta font-medium text-muted-foreground tabular-nums before:absolute before:inset-x-0 before:-inset-y-1.5 hover:border-ink hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {hidden === 1
                  ? t("candidates.skills.more.one")
                  : hidden > 0
                    ? t("candidates.skills.more", { count: hidden })
                    : t("candidates.showLess")}
              </button>
            </li>
          ) : null}
        </ul>
      )}
    </Block>
  );
}

/** A contact detail or a link: one icon, the value as a link the person opens, "not stated" when none. */
function ContactRow({
  icon,
  href,
  text,
  detail,
  external = false,
  hint,
}: {
  icon: ReactNode;
  href: string | null;
  text: string | null | undefined;
  /** What stands next to the value in muted text (a link's host). */
  detail?: string | undefined;
  external?: boolean;
  hint?: number | null | undefined;
}) {
  const t = useT();
  const clean = text?.trim();
  return (
    <li className="flex min-w-0 items-center gap-2.5 text-sm">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-sm bg-muted text-muted-foreground [&_svg]:size-4">
        {icon}
      </span>
      {clean && href ? (
        <a
          href={href}
          className="min-w-0 truncate rounded-sm text-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
        >
          {clean}
          {external ? <span className="sr-only"> {t("candidates.link.newTab")}</span> : null}
        </a>
      ) : (
        <span className="text-muted-foreground">{t("common.unknown")}</span>
      )}
      {detail ? (
        <span className="min-w-0 truncate text-meta text-muted-foreground">{detail}</span>
      ) : null}
      <ConfidenceHint value={hint} />
    </li>
  );
}

/** The host of a URL, for the line next to a link; "" when the URL does not parse. */
function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return "";
  }
}
