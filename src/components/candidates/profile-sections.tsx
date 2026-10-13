/**
 * The profile as read: one card per section, "not stated" for every
 * empty field, a confidence hint where the structuring was unsure.
 * Skills and tags are chips a member edits in place; the rest is edited
 * through the form (profile-form.tsx).
 */
import type { ReactNode } from "react";
import { Mail, Phone } from "lucide-react";

import { formatDateRange, yearsLabel } from "@/lib/candidates/format";
import type { CandidateRow, ConfidenceMap } from "@/lib/db/types";
import { useI18n } from "@/lib/i18n";

import { ChipEditor } from "./chip-editor";
import { ConfidenceHint } from "./confidence-pill";

export function Section({
  title,
  hint,
  children,
}: {
  title: ReactNode;
  hint?: number | null | undefined;
  children: ReactNode;
}) {
  return (
    <section className="sheet p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="label-caps">{title}</h2>
        <ConfidenceHint value={hint} />
      </div>
      {children}
    </section>
  );
}

function Value({ text, className = "" }: { text: string | null | undefined; className?: string }) {
  const { t } = useI18n();
  const clean = text?.trim();
  if (!clean) return <p className="text-sm text-muted-foreground">{t("common.unknown")}</p>;
  return <p className={`whitespace-pre-line text-sm text-ink ${className}`}>{clean}</p>;
}

/** Links a value may carry: mailto / tel, opened by the person. */
function ContactLine({ icon, href, text }: { icon: ReactNode; href: string | null; text: string | null }) {
  const { t } = useI18n();
  const clean = text?.trim();
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-muted-foreground [&_svg]:size-4">{icon}</span>
      {clean && href ? (
        <a href={href} className="text-primary hover:underline">
          {clean}
        </a>
      ) : (
        <span className="text-muted-foreground">{t("common.unknown")}</span>
      )}
    </div>
  );
}

export function ProfileSections({
  candidate,
  canEdit,
  onChips,
}: {
  candidate: CandidateRow;
  canEdit: boolean;
  onChips: (column: "skills" | "tags", values: string[]) => Promise<void>;
}) {
  const { t, locale } = useI18n();
  const confidence: ConfidenceMap = candidate.confidence ?? {};
  const years = yearsLabel(locale, candidate.years_experience);

  return (
    <div className="space-y-4">
      <Section title={t("candidates.field.summary")} hint={confidence.summary}>
        <Value text={candidate.summary} />
      </Section>

      <Section title={t("candidates.field.skills")} hint={confidence.skills}>
        <ChipEditor
          values={candidate.skills ?? []}
          canEdit={canEdit}
          placeholder={t("candidates.skills.placeholder")}
          onChange={(values) => onChips("skills", values)}
        />
      </Section>

      <div className="grid gap-4 sm:grid-cols-2">
        <Section title={t("candidates.field.languages")} hint={confidence.languages}>
          {candidate.languages?.length ? (
            <ul className="space-y-1 text-sm text-ink">
              {candidate.languages.map((language, index) => (
                <li key={`${language.name}-${index}`}>
                  {language.name}
                  {language.level?.trim() ? <span className="text-muted-foreground"> · {language.level}</span> : null}
                </li>
              ))}
            </ul>
          ) : (
            <Value text={null} />
          )}
        </Section>
        <Section title={t("candidates.field.years")} hint={confidence.years_experience}>
          <Value text={years} />
        </Section>
      </div>

      <Section title={t("candidates.field.experiences")} hint={confidence.experiences}>
        {candidate.experiences?.length ? (
          <ol className="space-y-4">
            {candidate.experiences.map((experience, index) => {
              const dates = formatDateRange(locale, experience.start, experience.end);
              return (
                <li key={`${experience.title}-${index}`} className="border-l-2 border-border pl-3">
                  <p className="text-sm font-medium text-ink">{experience.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {[experience.company, dates].filter((part) => part && part.trim()).join(" · ") || t("common.unknown")}
                  </p>
                  {experience.description?.trim() ? (
                    <p className="mt-1 whitespace-pre-line text-sm text-ink">{experience.description.trim()}</p>
                  ) : null}
                </li>
              );
            })}
          </ol>
        ) : (
          <Value text={null} />
        )}
      </Section>

      <Section title={t("candidates.field.education")} hint={confidence.education}>
        {candidate.education?.length ? (
          <ul className="space-y-2">
            {candidate.education.map((entry, index) => (
              <li key={`${entry.degree}-${index}`}>
                <p className="text-sm font-medium text-ink">{entry.degree}</p>
                <p className="text-xs text-muted-foreground">
                  {[entry.school, entry.year].filter((part) => part && part.trim()).join(" · ") || t("common.unknown")}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <Value text={null} />
        )}
      </Section>

      <div className="grid gap-4 sm:grid-cols-2">
        <Section title={t("candidates.field.contact")}>
          <div className="space-y-2">
            <ContactLine
              icon={<Mail />}
              href={candidate.email?.trim() ? `mailto:${candidate.email.trim()}` : null}
              text={candidate.email}
            />
            <ConfidenceHint value={confidence.email} />
            <ContactLine
              icon={<Phone />}
              href={candidate.phone?.trim() ? `tel:${candidate.phone.replace(/[^+\d]/g, "")}` : null}
              text={candidate.phone}
            />
            <ConfidenceHint value={confidence.phone} />
          </div>
        </Section>
        <Section title={t("candidates.field.availability")} hint={confidence.availability}>
          <Value text={candidate.availability} />
        </Section>
      </div>

      <Section title={t("candidates.field.links")}>
        {candidate.links?.length ? (
          <ul className="space-y-1 text-sm">
            {candidate.links.map((link, index) => (
              <li key={`${link.url}-${index}`} className="truncate">
                <a href={link.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                  {link.label?.trim() || link.url}
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <Value text={null} />
        )}
      </Section>

      <Section title={t("candidates.field.tags")}>
        <ChipEditor
          values={candidate.tags ?? []}
          canEdit={canEdit}
          placeholder={t("candidates.tags.placeholder")}
          tone="neutral"
          onChange={(values) => onChips("tags", values)}
        />
      </Section>
    </div>
  );
}
