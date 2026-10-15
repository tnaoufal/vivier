/**
 * The pieces of a dossier sheet the public page shows outside the app
 * (`translate()` in the organisation's language): the decision as a
 * pill with its icon and word, the sentences of the marks, the
 * requirement rows the shared RequirementList takes, the score as a
 * figure, and the one muted line of facts (the years first, then the
 * place and the availability when the CV states them). Each takes the
 * translator as a parameter so the words never depend on the reader's
 * browser.
 */
import { Pill } from "@/components/app-shell/pill";
import type { RequirementRow } from "@/components/app-shell/requirement-list";
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
 * The decision as a pill with one leading icon, so a shape is never the
 * only signal; "not analysed" when null. Its tone and icon are the
 * analysis's own (DECISION_LOOK), so a decision has one look from the
 * search to the dossier; the words stay the dossier's translator's.
 */
export function DecisionPill({
  decision,
  t,
}: {
  decision: AssessmentDecision | null;
  t: Translate;
}) {
  const { tone, icon: Icon } = DECISION_LOOK[decision ?? "unassessed"];
  return (
    <Pill tone={tone} icon={<Icon />}>
      {decision ? t(DECISION_KEYS[decision]) : t("shares.decision.none")}
    </Pill>
  );
}

/**
 * The score as a figure, "82 / 100", with the sentence for assistive
 * technologies and the hover; without one, the reason in muted text,
 * never a bare dash read as "none".
 */
export function ScoreText({ score, t }: { score: number | null; t: Translate }) {
  if (score === null) {
    return <span className="text-sm text-muted-foreground">{t("shares.score.none")}</span>;
  }
  return (
    <span className="font-medium text-ink tabular-nums" title={scoreLabel(t, score)}>
      {t("shares.score", { score })}
    </span>
  );
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
  const total = item.requirements.length;
  if (total === 1) return t("shares.requirements.met.one", { met: metCount(item.requirements) });
  return t("shares.requirements.met", { met: metCount(item.requirements), total });
}

/**
 * "8 years of experience · Lyon · availability: 1 month": the years
 * first (said "not stated" when the CV gives none: the one fact every
 * sheet places), then the place and the availability only when stated.
 */
export function factsLine(
  t: Translate,
  item: Pick<ShareItem, "location" | "yearsExperience" | "availability">,
): string {
  const years =
    item.yearsExperience === null
      ? t("shares.page.years.none")
      : item.yearsExperience === 1
        ? t("shares.page.years.one")
        : t("shares.page.years.many", { years: item.yearsExperience });
  const parts = [years];
  if (item.location) parts.push(item.location);
  if (item.availability) parts.push(t("shares.page.availability", { value: item.availability }));
  return parts.join(" · ");
}
