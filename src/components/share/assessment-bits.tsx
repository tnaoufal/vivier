/**
 * The pieces of a sheet's assessment shared by the review step (inside
 * the app, `useT()`) and the dossier a link opens (outside the app,
 * `translate()` in the organisation's language): the decision pill with
 * its leading icon, the sentences of the marks, the requirement rows the
 * shared RequirementList takes, the score's text tone and the one muted
 * line of practical facts, "not stated" where the CV gave nothing. Each
 * takes the translator as a parameter so colour, words and language
 * never depend on where the sheet is shown.
 */
import { Pill } from "@/components/app-shell/pill";
import type { RequirementRow } from "@/components/app-shell/requirement-list";
import { ringTone } from "@/components/app-shell/score-ring";
import { DECISION_LOOK } from "@/components/briefs/decision-pill";
import type { AssessmentDecision, RequirementMet, ShareItem } from "@/lib/db/types";
import type { Params, TranslationKey } from "@/lib/i18n";
import { metCount } from "@/lib/shares/draft";

export type Translate = (key: TranslationKey, params?: Params) => string;

const DECISION_KEYS: Record<AssessmentDecision, TranslationKey> = {
  fit: "shares.decision.fit",
  borderline: "shares.decision.borderline",
  no_fit: "shares.decision.no_fit",
};

const MET_KEYS: Record<RequirementMet, TranslationKey> = {
  yes: "shares.met.yes",
  partial: "shares.met.partial",
  no: "shares.met.no",
  unknown: "shares.met.unknown",
};

/** The sentence of a mark, for the RequirementList's assistive label. */
export function metLabel(t: Translate, met: RequirementMet): string {
  return t(MET_KEYS[met]);
}

/**
 * The decision as a pill with one leading icon, so colour is never the
 * only signal; "not analysed" when null. Its tone and icon are the
 * analysis's own (DECISION_LOOK), so a decision has one look from the
 * search to the dossier; the words stay the dossier's translator's.
 */
export function DecisionPill({ decision, t }: { decision: AssessmentDecision | null; t: Translate }) {
  const { tone, icon: Icon } = DECISION_LOOK[decision ?? "unassessed"];
  return (
    <Pill tone={tone} icon={<Icon />}>
      {decision ? t(DECISION_KEYS[decision]) : t("shares.decision.none")}
    </Pill>
  );
}

const SCORE_TEXT = {
  positive: "text-positive",
  caution: "text-caution-foreground",
  negative: "text-negative",
} as const;

/**
 * The score as a tabular number in the ring's tone; without one, a muted
 * dash (as the ring draws it) whose reason is its text for assistive
 * technologies and its hover, never a bare dash read as "none".
 */
export function ScoreText({ score, t }: { score: number | null; t: Translate }) {
  if (score === null) {
    return (
      <span className="tabular-nums text-muted-foreground" title={t("shares.score.none")}>
        <span aria-hidden="true">—</span>
        <span className="sr-only">{t("shares.score.none")}</span>
      </span>
    );
  }
  return <span className={`font-semibold tabular-nums ${SCORE_TEXT[ringTone(score)]}`}>{score}</span>;
}

export function scoreLabel(t: Translate, score: number | null): string {
  return score === null ? t("shares.score.none") : t("shares.score.label", { score });
}

/** The rows of a sheet for the shared RequirementList (ids are positions: the dossier keeps no criterion id). */
export function requirementRowsOf(item: Pick<ShareItem, "requirements">): RequirementRow[] {
  return item.requirements.map((row, index) => ({
    id: String(index),
    label: row.label,
    required: row.required,
    met: row.met,
    evidence: row.evidence,
  }));
}

/** "6 / 8 requirements met", or "no analysis" when the sheet holds no table. */
export function metSentence(t: Translate, item: Pick<ShareItem, "requirements">): string {
  if (!item.requirements.length) return t("shares.requirements.none");
  return t("shares.requirements.met", { met: metCount(item.requirements), total: item.requirements.length });
}

/** "Lyon · 8 years of experience · availability: 1 month", each part "not stated" when null. */
export function factsLine(t: Translate, item: Pick<ShareItem, "location" | "yearsExperience" | "availability">): string {
  const years =
    item.yearsExperience === null
      ? t("shares.page.years.none")
      : item.yearsExperience === 1
        ? t("shares.page.years.one")
        : t("shares.page.years.many", { years: item.yearsExperience });
  const availability = item.availability
    ? t("shares.page.availability", { value: item.availability })
    : t("shares.page.availability.none");
  return [item.location ?? t("shares.page.location.none"), years, availability].join(" · ");
}
