/**
 * The recruiter's reading of a shortlist item's match, shown in the
 * drawer under the requirement list and the model's sentences: the five
 * dimensions as one compact row (the label and the score, the model's
 * one-line note on hover), the comparative pass's line on the rank,
 * then the strengths, the reservations (the second opinion's doubt
 * marked as the counter-reading, apart from the first pass's) and the
 * points for the interview, each only when the assessment carries it.
 * Everything here is what the model read and proposes; nothing in it
 * decides, and an assessment made before the reading shows nothing.
 */
import { Pill } from "@/components/app-shell/pill";
import type { AssessmentDimension, MatchResult } from "@/lib/db/types";
import { useI18n, type TranslationKey } from "@/lib/i18n";
import { hasReading, recruiterReadingOf, type ConcernPoint } from "@/lib/shortlists/requirements";

const DIMENSION_KEYS: Record<AssessmentDimension, TranslationKey> = {
  role: "shortlists.dimension.role",
  seniority: "shortlists.dimension.seniority",
  context: "shortlists.dimension.context",
  trajectory: "shortlists.dimension.trajectory",
  achievements: "shortlists.dimension.achievements",
};

function Points({ title, points }: { title: string; points: readonly string[] }) {
  if (!points.length) return null;
  return (
    <div>
      <h4 className="label-caps">{title}</h4>
      <ul className="mt-1.5 list-disc space-y-1 pl-5 text-[15px] leading-6 text-ink">
        {points.map((point, index) => (
          <li key={`${index}-${point}`} className="break-words">
            {point}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The reservations, the counter-reading's one with a pill before it so the two passes read apart. */
function Concerns({ title, mark, points }: { title: string; mark: string; points: readonly ConcernPoint[] }) {
  if (!points.length) return null;
  return (
    <div>
      <h4 className="label-caps">{title}</h4>
      <ul className="mt-1.5 list-disc space-y-1 pl-5 text-[15px] leading-6 text-ink">
        {points.map((point, index) => (
          <li key={`${index}-${point.text}`} className="break-words">
            {point.challenge ? (
              <Pill tone="caution" dot className="mr-1.5 align-text-bottom">
                {mark}
              </Pill>
            ) : null}
            {point.text}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function RecruiterReading({ match }: { match: MatchResult | null }) {
  const { t } = useI18n();
  const reading = recruiterReadingOf(match);
  if (!hasReading(reading)) return null;
  return (
    <div className="space-y-4">
      {reading.dimensions.length ? (
        <div>
          <h4 className="label-caps">{t("shortlists.reading.dimensions")}</h4>
          <ul className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[13px] leading-5">
            {reading.dimensions.map((row) => {
              const label = t(DIMENSION_KEYS[row.dimension]);
              const sentence = t("shortlists.reading.dimension", { label, score: row.score });
              return (
                <li key={row.dimension} className="flex items-baseline gap-1.5" title={row.note ? `${sentence} · ${row.note}` : sentence}>
                  <span className="text-muted-foreground">{label}</span>
                  <span className="font-medium tabular-nums text-ink" aria-hidden="true">
                    {row.score}
                  </span>
                  <span className="sr-only">{sentence}</span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
      {reading.rankNote ? (
        <div>
          <h4 className="label-caps">{t("shortlists.reading.rank")}</h4>
          <p className="mt-1 text-[15px] leading-6 text-ink break-words">{reading.rankNote}</p>
        </div>
      ) : null}
      <Points title={t("shortlists.reading.strengths")} points={reading.strengths} />
      <Concerns title={t("shortlists.reading.concerns")} mark={t("shortlists.reading.challenge")} points={reading.concerns} />
      <Points title={t("shortlists.reading.questions")} points={reading.questions} />
    </div>
  );
}
