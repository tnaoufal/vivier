/**
 * The profile as a recruiter reads a CV: one sheet, its sections divided
 * by hairlines. The summary on three lines with "see more"; the career
 * as a timeline with the period and its duration computed, the company,
 * the title and the description folded to two lines; the education in
 * compact rows; the skills as quiet chips, the first eight with "+ N"
 * for the rest; the contact details and the links. "Not stated" in
 * muted text for every empty field (never a dash that could read as
 * "none"), a confidence hint where the structuring was unsure. A member
 * edits the skills in place behind a pencil; the rest is edited through
 * the form's drawer (profile-form.tsx).
 */
import { Fragment, useState, type ReactNode } from "react";
import { Check, ExternalLink, Link2, Mail, Pencil, Phone } from "lucide-react";

import { Timeline, TimelineItem } from "@/components/app-shell/timeline";
import { Button } from "@/components/ui/button";
import { formatDateRange, formatDuration } from "@/lib/candidates/format";
import { SKILLS_SHOWN, visibleSkills } from "@/lib/candidates/skills";
import type { CandidateRow, ConfidenceMap } from "@/lib/db/types";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

import { Chip, ChipEditor } from "./chip-editor";
import { ClampedText } from "./clamped-text";
import { ConfidenceHint } from "./confidence-pill";

/** One section of the sheet: a title with an optional count, the hint, an action on the right, then the content. */
function Block({
  title,
  hint,
  count,
  action,
  children,
}: {
  title: ReactNode;
  hint?: number | null | undefined;
  count?: number | undefined;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="p-6 sm:p-8">
      <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 className="text-base font-semibold text-ink">
          {title}
          {typeof count === "number" && count > 0 ? (
            <span className="ml-2 text-sm font-normal text-muted-foreground tabular-nums">
              {count}
            </span>
          ) : null}
        </h2>
        <ConfidenceHint value={hint} />
        {action ? <div className="ml-auto">{action}</div> : null}
      </div>
      {children}
    </section>
  );
}

/** What the CV did not state. */
function Unknown() {
  const { t } = useI18n();
  return <p className="text-sm text-muted-foreground">{t("common.unknown")}</p>;
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
  const { t } = useI18n();
  const clean = text?.trim();
  return (
    <li className="flex min-w-0 items-center gap-3 text-body">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-sm bg-muted text-muted-foreground [&_svg]:size-4">
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
        <span className="text-sm text-muted-foreground">{t("common.unknown")}</span>
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

/** The skills: quiet chips, the first eight then "+ N", or the editor in place for a member. */
function SkillsBlock({
  skills,
  hint,
  canEdit,
  onChange,
}: {
  skills: string[];
  hint: number | null | undefined;
  canEdit: boolean;
  onChange: (values: string[]) => Promise<void>;
}) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const { shown, hidden } = visibleSkills(skills, expanded);

  return (
    <Block
      title={t("candidates.field.skills")}
      hint={hint}
      count={skills.length}
      action={
        canEdit ? (
          <Button
            type="button"
            variant={editing ? "outline" : "ghost"}
            icon={editing ? <Check /> : <Pencil />}
            onClick={() => setEditing((value) => !value)}
            className={cn(!editing && "text-muted-foreground hover:text-ink")}
          >
            {editing ? t("candidates.skills.done") : t("candidates.skills.edit")}
          </Button>
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
        <div className="space-y-3">
          <ul className="flex flex-wrap gap-1.5">
            {shown.map((skill) => (
              <li key={skill} className="min-w-0">
                <Chip>{skill}</Chip>
              </li>
            ))}
          </ul>
          {hidden > 0 || skills.length > SKILLS_SHOWN ? (
            <button
              type="button"
              onClick={() => setExpanded((value) => !value)}
              aria-expanded={expanded}
              className="cursor-pointer rounded-sm text-sm font-medium text-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {hidden === 1
                ? t("candidates.skills.more.one")
                : hidden > 0
                  ? t("candidates.skills.more", { count: hidden })
                  : t("candidates.showLess")}
            </button>
          ) : null}
        </div>
      )}
    </Block>
  );
}

export function ProfileSections({
  candidate,
  canEdit,
  onSkills,
  now = new Date(),
}: {
  candidate: CandidateRow;
  canEdit: boolean;
  /** Saves the skills a member edited in place. */
  onSkills: (values: string[]) => Promise<void>;
  /** The clock the durations of ongoing positions are counted to; injectable for tests. */
  now?: Date;
}) {
  const { t, locale } = useI18n();
  const confidence: ConfidenceMap = candidate.confidence ?? {};
  const summary = candidate.summary?.trim() ?? "";
  const experiences = candidate.experiences ?? [];
  const education = candidate.education ?? [];
  const links = candidate.links ?? [];

  return (
    <div className="sheet divide-y divide-border">
      <Block title={t("candidates.field.summary")} hint={confidence.summary}>
        {summary ? <ClampedText text={summary} lines={3} /> : <Unknown />}
      </Block>

      <Block
        title={t("candidates.field.career")}
        hint={confidence.experiences}
        count={experiences.length}
      >
        {experiences.length ? (
          <Timeline>
            {experiences.map((experience, index) => {
              const range = formatDateRange(locale, experience.start, experience.end);
              const duration = formatDuration(locale, experience.start, experience.end, now);
              const current = Boolean(experience.start?.trim()) && !experience.end?.trim();
              const description = experience.description?.trim() ?? "";
              return (
                <Fragment key={`${experience.title}-${index}`}>
                  <TimelineItem
                    when={
                      <span className="flex flex-col">
                        <span>{range || t("common.unknown")}</span>
                        {duration ? (
                          <span className="text-muted-foreground">{duration}</span>
                        ) : null}
                      </span>
                    }
                    title={
                      <>
                        {experience.title?.trim() || t("common.unknown")}
                        {current ? (
                          <span className="sr-only"> ({t("candidates.experience.current")})</span>
                        ) : null}
                      </>
                    }
                    subtitle={experience.company?.trim() || t("common.unknown")}
                    current={current}
                  >
                    {description ? (
                      <ClampedText
                        text={description}
                        lines={2}
                        className="text-sm leading-6 text-ink"
                      />
                    ) : null}
                  </TimelineItem>
                </Fragment>
              );
            })}
          </Timeline>
        ) : (
          <Unknown />
        )}
      </Block>

      <Block
        title={t("candidates.field.education")}
        hint={confidence.education}
        count={education.length}
      >
        {education.length ? (
          <ul className="stagger divide-y divide-border/70">
            {education.map((entry, index) => (
              <li
                key={`${entry.degree}-${index}`}
                className="rise-in flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-3 first:pt-0 last:pb-0"
              >
                <div className="min-w-0 flex-1 basis-64">
                  <p className="text-body font-medium text-ink break-words">
                    {entry.degree?.trim() || t("common.unknown")}
                  </p>
                  <p className="text-sm text-muted-foreground break-words">
                    {entry.school?.trim() || t("common.unknown")}
                  </p>
                </div>
                <span className="text-meta text-muted-foreground tabular-nums">
                  {entry.year?.trim() || t("common.unknown")}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <Unknown />
        )}
      </Block>

      <SkillsBlock
        skills={candidate.skills ?? []}
        hint={confidence.skills}
        canEdit={canEdit}
        onChange={onSkills}
      />

      <Block title={t("candidates.field.contactLinks")}>
        <ul className="space-y-2.5">
          <ContactRow
            icon={<Mail />}
            href={candidate.email?.trim() ? `mailto:${candidate.email.trim()}` : null}
            text={candidate.email}
            hint={confidence.email}
          />
          <ContactRow
            icon={<Phone />}
            href={candidate.phone?.trim() ? `tel:${candidate.phone.replace(/[^+\d]/g, "")}` : null}
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
  );
}
