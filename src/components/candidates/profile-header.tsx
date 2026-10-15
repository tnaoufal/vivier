/**
 * The head of a CV, under the page's sticky header: the photo in
 * greyscale (when the organisation shows photos and the CV had one; the
 * initials otherwise, square-rounded), the name, the position held
 * today, one line that reads the seniority first, then where and when
 * available, the languages with their level as quiet text, and the
 * small pills that set this profile apart (archived, typed by hand,
 * consent withdrawn). The page title and the actions live in the
 * PageHeader above, so the name here is a card title, not a second h1;
 * the name and the fields are edited through the form's drawer. "Not
 * stated" in muted text where the CV said nothing; a hint where the
 * structuring was unsure, explained once behind the info icon.
 */
import { Avatar } from "@/components/app-shell/avatar";
import { InfoTip } from "@/components/app-shell/info-tip";
import { Pill } from "@/components/app-shell/pill";
import {
  confidenceTone,
  currentPosition,
  displayName,
  languagesSummary,
  metaLine,
} from "@/lib/candidates/format";
import { usePhotoUrl } from "@/lib/candidates/use-photo-url";
import type { CandidateRow, ConfidenceMap } from "@/lib/db/types";
import { useI18n } from "@/lib/i18n";

import { ConfidenceHint } from "./confidence-pill";

/** The read fields the sheet marks with a confidence pill (this head and profile-sections.tsx). */
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

export function ProfileHeader({
  candidate,
  showPhotos,
}: {
  candidate: CandidateRow;
  /** The organisation's choice: a team that practises anonymous CVs turns photos off. */
  showPhotos: boolean;
}) {
  const { t, locale } = useI18n();
  const name = displayName(candidate, t("candidates.noName"));
  const photoUrl = usePhotoUrl(candidate.photo_path, showPhotos);
  const position = currentPosition(candidate);
  const meta = metaLine(locale, candidate);
  const languages = languagesSummary(candidate.languages);
  const confidence: ConfidenceMap = candidate.confidence ?? {};
  // One explanation for every "to check" pill of the page, beside the card's title, only when one shows.
  const doubtful = HINTED_FIELDS.some((field) => confidenceTone(confidence[field]) !== "none");
  const marked =
    candidate.status === "archived" ||
    candidate.source === "manual" ||
    candidate.consent_status === "withdrawn";

  return (
    <section className="sheet p-6" aria-label={name}>
      <div className="flex items-start gap-5">
        <Avatar name={name} size="xl" variant="profile" photoUrl={photoUrl} decorative />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <p className="min-w-0 text-base font-semibold text-ink break-words">{name}</p>
            <ConfidenceHint value={confidence.full_name} />
            {doubtful ? (
              <InfoTip label={t("candidates.review")}>
                {t("candidates.confidence.help.check")}
              </InfoTip>
            ) : null}
          </div>
          <p className="mt-1 text-body text-ink">
            {position ? (
              <>
                <span className="font-medium text-ink">{position.title}</span>
                {position.company ? (
                  <span className="text-muted-foreground">
                    {" "}
                    {t("candidates.atCompany", { company: position.company })}
                  </span>
                ) : null}{" "}
                <ConfidenceHint value={confidence.headline} />
              </>
            ) : (
              <span className="text-muted-foreground">{t("common.unknown")}</span>
            )}
          </p>
          <p className="mt-1 text-sm text-muted-foreground tabular-nums">
            {meta || t("common.unknown")}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {languages || `${t("candidates.field.languages")} · ${t("common.unknown")}`}{" "}
            <ConfidenceHint value={confidence.languages} />
          </p>
          {marked ? (
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
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
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
