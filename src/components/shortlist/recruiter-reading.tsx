/**
 * The model's detailed reading of a shortlist item's match, in the
 * drawer's reading tab: the five dimensions as ink meters, each with
 * the model's one-line note under its bar; the comparative pass's line
 * on the rank; then the strengths, the reservations (the second
 * opinion's doubt marked as the counter-reading, apart from the first
 * pass's) and the points for the interview, each only when the
 * assessment carries it. Everything here is what the model read and
 * proposes; nothing in it decides, and an assessment made before the
 * reading shows nothing.
 */
import { Meter } from "@/components/app-shell/meter";
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
      <ul className="mt-1.5 list-disc space-y-1 pl-5 text-body text-ink">
        {points.map((point, index) => (
          <li key={`${index}-${point}`} className="break-words">
            {point}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The reservations, the counter-reading's one with a pill before it so the
 * two passes read apart; the pill is a word without a dot, the bullet
 * being the line's one mark.
 */
function Concerns({
  title,
  mark,
  points,
}: {
  title: string;
  mark: string;
  points: readonly ConcernPoint[];
}) {
  if (!points.length) return null;
  return (
    <div>
      <h4 className="label-caps">{title}</h4>
      <ul className="mt-1.5 list-disc space-y-1 pl-5 text-body text-ink">
        {points.map((point, index) => (
          <li key={`${index}-${point.text}`} className="break-words">
            {point.challenge ? (
              <Pill tone="caution" dot={false} size="sm" className="mr-1.5 align-text-bottom">
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
    <section className="space-y-5">
      {reading.dimensions.length ? (
        <div>
          <h4 className="label-caps">{t("shortlists.reading.dimensions")}</h4>
          <ul className="stagger mt-2 grid gap-x-6 gap-y-4 sm:grid-cols-2">
            {reading.dimensions.map((row) => (
              <li key={row.dimension} className="rise-in min-w-0">
                <Meter
                  label={t(DIMENSION_KEYS[row.dimension])}
                  value={row.score}
                  hint={row.note ?? undefined}
                />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {reading.rankNote ? (
        <div>
          <h4 className="label-caps">{t("shortlists.reading.rank")}</h4>
          <p className="mt-1 text-body text-ink break-words">{reading.rankNote}</p>
        </div>
      ) : null}
      <div className="grid gap-5 sm:grid-cols-2">
        <Points title={t("shortlists.reading.strengths")} points={reading.strengths} />
        <Concerns
          title={t("shortlists.reading.concerns")}
          mark={t("shortlists.reading.challenge")}
          points={reading.concerns}
        />
      </div>
      <Points title={t("shortlists.reading.questions")} points={reading.questions} />
    </section>
  );
}
