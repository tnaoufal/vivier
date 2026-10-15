/**
 * What the model's assessment of a candidate becomes once it is read
 * here: every requirement of the brief gets a row, the evidence and the
 * summary are clipped, every quote is checked against the texts the
 * model was given (a "yes" whose quote is not found there reads as
 * "partial" and is marked unverified; a dimension's score stands above
 * neutral only on a quote that is found), the five dimensions a senior
 * recruiter scores (métier, seniority, context, trajectory,
 * achievements) are clipped and guarded, the score is the composite of
 * scoring.ts when the model scored the dimensions (its own score is
 * kept apart, advisory), and the decision and score obey the brief
 * first on its role, then on its required requirements, whatever the
 * model answered (a métier that is not the role is a no_fit however the
 * rest reads, an adjacent one is at most borderline; with the
 * dimensions, a fit also needs the role requirement at "yes" and the
 * métier scored ROLE_DIMENSION_FIT_MIN or more, else it is at most
 * borderline; a required requirement clearly not met is a no_fit, one
 * the CV says nothing about is at most borderline; a no_fit the model
 * cannot pin on either is borderline: the team decides; a fit needs
 * FIT_MIN_SCORE). A sentence that names a protected
 * characteristic or a period without a position is withheld, and the
 * assessment says how many were, so the reading shown is never taken
 * for complete. The second opinion (applyChallenge) can only lower: a
 * doubt with a quoted evidence found in the profile sends a retained
 * profile to "to check"; a doubt without one is an opinion and changes
 * nothing. Pure: no model, no data access; every rule is stated once
 * and tested in assessment.test.ts. The rest of the module reads
 * assessed results for the panel: the groups the page shows (to
 * present, to dig into, set aside, not analysed), the requirement most
 * often missing, the rows a RequirementList shows (the role first,
 * wherever the brief keeps it), with the deterministic verdicts as the
 * fallback when no model answered.
 */
import { protectedCriterion, roleCriterion, roleFirst } from "./criteria.js";
import { normalise } from "./matching.js";
import {
  compositeScore,
  DIMENSIONS,
  dimensionScore,
  NEUTRAL_SCORE,
  requirementsCoverage,
} from "./scoring.js";
import type {
  Assessment,
  AssessmentChallenge,
  AssessmentDecision,
  AssessmentDimension,
  AssessmentTier,
  BriefCriterion,
  CriterionKind,
  CriterionResult,
  CriterionVerdict,
  DimensionScore,
  MatchResult,
  RequirementAssessment,
  RequirementMet,
  RequirementRow,
} from "./types.js";

/** The most candidates one assessment call reads: the browser sends batches of this size, one after the other. */
export const ASSESS_BATCH_MAX = 6;
export const EVIDENCE_MAX = 200;
export const SUMMARY_MAX = 600;
/** A dimension's note, a strength, a concern, a question, a rank note, a challenge's reason: each clipped here. */
export const NOTE_MAX = 200;
export const STRENGTHS_MAX = 5;
export const CONCERNS_MAX = 4;
export const QUESTIONS_MAX = 3;
/** A "fit" needs at least this score: what is presented is strict, the rest is the team's to dig into. */
export const FIT_MIN_SCORE = 75;
/** A "borderline" needs at least this score; below it the profile is a no_fit. */
export const BORDERLINE_MIN_SCORE = 45;
/** With the dimensions, a "fit" also needs the métier scored at least this (and the role requirement at "yes"); else at most borderline. */
export const ROLE_DIMENSION_FIT_MIN = 70;
/** A required requirement at "no" caps the score here (and forces no_fit). */
export const REQUIRED_NO_SCORE_CAP = 39;
/** A required requirement at "unknown" caps the score here (and the decision at borderline). */
export const REQUIRED_UNKNOWN_SCORE_CAP = 69;
/** Required requirements the model itself read as met in part (a grounded quote) that make a fit a borderline: one keeps the fit (its mark says "partiel"), this many or more ask for a human look; a "yes" the rules downgraded always does. */
export const REQUIRED_PARTIALS_MAX = 2;
/** The role at "no" (another métier) caps the score here and forces no_fit, whatever the other requirements. */
export const ROLE_NO_SCORE_CAP = 25;
/** The role at "partial" (an adjacent métier) caps the score here and the decision at borderline. */
export const ROLE_PARTIAL_SCORE_CAP = 65;
/** The role at "unknown" (no experience to read) caps the score here and the decision at borderline. */
export const ROLE_UNKNOWN_SCORE_CAP = 60;
/** A second opinion's doubt with evidence caps the score here (and the decision at borderline). */
export const CHALLENGE_DOUBT_SCORE_CAP = 69;

/** One dimension as the model answers it, before any rule applies. */
export interface ModelDimensionAnswer {
  score?: number | null | undefined;
  note?: string | null | undefined;
  evidence?: string | null | undefined;
}

/** The model's answer as the schema lets it through, before any rule applies. */
export interface ModelAssessmentAnswer {
  requirements: { criterionId: string; met: string; evidence?: string | null | undefined }[];
  decision: string;
  score: number;
  summary: string;
  /** Absent on an answer made before the dimensions: the model's score is then the score. */
  dimensions?: Partial<Record<string, ModelDimensionAnswer | null | undefined>> | null | undefined;
  strengths?: string[] | null | undefined;
  concerns?: string[] | null | undefined;
  questions?: string[] | null | undefined;
}

/** The second opinion as the schema lets it through. */
export interface ModelChallengeAnswer {
  verdict: string;
  reason?: string | null | undefined;
  evidence?: string | null | undefined;
}

/** What the rules read besides the model's answer. */
export interface EnforceOptions {
  /** The texts the model was given (payloadTexts): a quote found in none of them is unverified. Left out, nothing is checked. */
  texts?: readonly string[] | undefined;
  /** True for a brief whose profile is junior: a role at "unknown" keeps its score (internships are positions), the decision still borderline. */
  junior?: boolean | undefined;
}

export type ResultDecision = AssessmentDecision | "unassessed";

const MET_VALUES: readonly RequirementMet[] = ["yes", "partial", "no", "unknown"];
const DECISIONS: readonly AssessmentDecision[] = ["fit", "borderline", "no_fit"];
const TIERS: readonly AssessmentTier[] = ["A", "B", "C"];

function isMet(value: string): value is RequirementMet {
  return (MET_VALUES as readonly string[]).includes(value);
}

function isDecision(value: string): value is AssessmentDecision {
  return (DECISIONS as readonly string[]).includes(value);
}

export function isTier(value: unknown): value is AssessmentTier {
  return typeof value === "string" && (TIERS as readonly string[]).includes(value);
}

function clip(value: string | null | undefined, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

/** The decision a score alone would give, for a model that answered none the schema knows. */
function decisionFromScore(score: number): AssessmentDecision {
  if (score >= FIT_MIN_SCORE) return "fit";
  if (score >= BORDERLINE_MIN_SCORE) return "borderline";
  return "no_fit";
}

// ---------------------------------------------------------------------
// what a sentence may never say
// ---------------------------------------------------------------------

function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, " ");
}

/**
 * The phrases that name a career break, a gap or a leave, as whole
 * words, case and accents apart: a sentence about a profile that
 * carries one is dropped before it is stored, since a period without a
 * position is never read, scored or mentioned. Phrases, not words:
 * "gap", "interruption" and "trou" alone name a market gap, a service
 * interruption, a hole in a pipeline, and a recruiter's note has a use
 * for them.
 */
const CAREER_BREAK_PHRASES = [
  "career break",
  "career gap",
  "career interruption",
  "employment gap",
  "gap in employment",
  "gap year",
  "gap in (?:the|his|her|their|my) (?:cv|resume|career|employment)",
  "(?:cv|resume) gap",
  "gap (?:de|of) \\S+ (?:mois|ans?|annees?|months?|years?)",
  "gap entre",
  "trou dans (?:le|son|sa|la|un|leur) (?:cv|parcours|carriere)",
  "trou de \\S+ (?:mois|ans?|annees?)",
  "trou entre",
  "periode d'inactivite",
  "periode sans (?:emploi|activite|poste)",
  "sans emploi",
  "sans poste",
  "inactivite professionnelle",
  "annees? blanches?",
  "annees? sans (?:emploi|activite|poste)",
  "interruption de (?:carriere|parcours)",
  "carriere interrompue",
  "parcours interrompu",
  "conge (?:parental|maternite|de maternite|paternite|de paternite|sabbatique)",
  "(?:maternity|paternity|parental) leave",
  "sabbatical",
  "sabbatique",
];
const CAREER_BREAK = new RegExp(
  `(?<![\\p{L}])(?:${CAREER_BREAK_PHRASES.join("|")})(?![\\p{L}])`,
  "u",
);

/**
 * The wider protected words (family, children, politics, a photo) name
 * a person only in a personal construction: "sa famille", "his
 * children", "situation familiale", "née en 1975". In a job's words
 * ("politique commerciale", "famille de produits", "petite enfance")
 * they say nothing about anyone, and the sentence is kept.
 */
const PERSONAL_PATTERNS = [
  "(?:sa|ses|son|leur|leurs|his|her|their|the candidate's|du candidat|de la candidate|of the candidate) (?:famille|enfants?|family|children|child|politique|political|photo|age|situation familiale)",
  "situation (?:familiale|de famille|matrimoniale)",
  "family (?:situation|status|life)",
  "vie de famille",
  "charges? de famille",
  "enfants? a charge",
  "(?:mere|pere) de \\S+ enfants?",
  "(?:mother|father) of \\S+ (?:children|child|kids)",
  "marital status",
  "opinions? politiques?",
  "political (?:opinions?|views?|affiliation)",
  "engagement politique",
  "avec photo",
  "photo (?:du candidat|de la candidate|sur le cv)",
  "with (?:a )?photo",
  "nee? (?:en|le) \\d",
  "born (?:in|on) \\d",
];
const PERSONAL = new RegExp(`(?<![\\p{L}])(?:${PERSONAL_PATTERNS.join("|")})(?![\\p{L}])`, "u");

/**
 * The collocations of a job's vocabulary that carry a word of the core
 * list ("race condition", "origine des produits", "homme de terrain")
 * or of the wider one ("politique commerciale", "famille de produits",
 * "petite enfance"): taken out of the sentence before it is read, so
 * the sentence is judged on the rest of its words.
 */
const JOB_COLLOCATIONS = new RegExp(
  [
    "politique (?:commerciale|tarifaire|rh|achats?|qualite|de prix|produits?|marketing|salariale|de remuneration|de credit|de stocks?|industrielle|financiere|energetique|publique|de la ville|de sante|sociale|du logement|de formation|de securite|de maintenance)",
    "familles? de produits?",
    "product famil(?:y|ies)",
    "famille (?:professionnelle|de metiers?|d'emplois?)",
    "job famil(?:y|ies)",
    "race conditions?",
    "origine des? (?:produits?|donnees|matieres?|marchandises|pieces|fonds|composants)",
    "data origin",
    "origin of (?:the )?(?:data|goods|products|funds|parts)",
    "petite enfance",
    "early childhood",
    "protection de l'enfance",
    "droits? des enfants",
    "(?:homme|femme) de terrain",
    "age (?:du capitaine|d'or|legal|de la retraite)",
    "born (?:global|digital)",
  ].join("|"),
  "gu",
);

/** True when a sentence names a career break, a gap or a leave. */
export function mentionsCareerBreak(text: string): boolean {
  return CAREER_BREAK.test(fold(text));
}

/**
 * True when a sentence about a profile names a protected characteristic
 * (the core list, as a role's definition is read, plus the wider words
 * in a personal construction, the job's collocations taken out first)
 * or a career break: such a sentence is never stored, wherever the
 * model put it, and the assessment counts it as withheld.
 */
export function forbiddenSentence(text: string): boolean {
  const folded = fold(text).replace(JOB_COLLOCATIONS, " ");
  return (
    protectedCriterion(folded, "", "role") || PERSONAL.test(folded) || CAREER_BREAK.test(folded)
  );
}

/** What the rules count as they drop sentences: the assessment says how many were withheld. */
interface Withheld {
  withheld: number;
}

/** The sentences of a list, trimmed and clipped to NOTE_MAX, blanks and repeats dropped, forbidden ones counted and left out, `max` at most. */
function sentencesOf(
  value: readonly unknown[] | null | undefined,
  max: number,
  counter: Withheld,
): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    const text = typeof item === "string" ? clip(item, NOTE_MAX) : null;
    if (!text || out.includes(text)) continue;
    if (forbiddenSentence(text)) {
      counter.withheld += 1;
      continue;
    }
    out.push(text);
    if (out.length >= max) break;
  }
  return out;
}

// ---------------------------------------------------------------------
// an evidence the model was given
// ---------------------------------------------------------------------

/** A window of the evidence this long, found verbatim in one text, grounds it. */
export const GROUNDING_WINDOW = 12;
/** Else this share of its tokens of four letters or digits, found as words of one text, grounds it. */
export const GROUNDING_TOKEN_SHARE = 0.6;
const GROUNDING_TOKEN_MIN = 4;

function tokensOf(text: string): string[] {
  return text.split(/[^\p{L}\p{N}]+/u).filter((token) => token.length >= GROUNDING_TOKEN_MIN);
}

/**
 * True when the evidence can be read in one of the texts the model was
 * given (payloadTexts), case, accents and spacing apart: the whole of
 * it when it is short, else a window of GROUNDING_WINDOW characters
 * found verbatim in one text, else GROUNDING_TOKEN_SHARE of its tokens
 * of four letters or digits found as words of one text (a position
 * quoted with its company and its dates spans the fields of one
 * experience, which travels as one text). A quote the model paraphrased
 * or invented fails, and the rules then read it as unverified: the
 * promise that every claim rests on the CV is checked, not hoped.
 */
export function evidenceGrounded(evidence: string, texts: readonly string[]): boolean {
  const needle = normalise(evidence);
  if (!needle) return false;
  const folded = texts.map((text) => normalise(text)).filter((text) => text.length > 0);
  if (!folded.length) return false;
  if (needle.length <= GROUNDING_WINDOW) {
    if (folded.some((text) => text.includes(needle))) return true;
  } else {
    for (let index = 0; index + GROUNDING_WINDOW <= needle.length; index += 1) {
      const window = needle.slice(index, index + GROUNDING_WINDOW);
      if (folded.some((text) => text.includes(window))) return true;
    }
  }
  const tokens = [...new Set(tokensOf(needle))];
  if (!tokens.length) return false;
  const needed = Math.ceil(tokens.length * GROUNDING_TOKEN_SHARE);
  return folded.some((text) => {
    const words = new Set(tokensOf(text));
    return tokens.filter((token) => words.has(token)).length >= needed;
  });
}

// ---------------------------------------------------------------------
// the requirements
// ---------------------------------------------------------------------

/**
 * One requirement row from the model's entry for a criterion, with the
 * deterministic verdict of the same criterion as a second reading:
 * - a "yes" without evidence becomes "partial" (a claim the model cannot
 *   quote is not a met requirement), and so does a "yes" whose evidence
 *   is found nowhere in what the model was given, the quote kept and
 *   marked unverified so the team reads it as the model's claim; any
 *   other row with such a quote is marked the same;
 * - a "yes" on a required criterion the deterministic pass found missing
 *   with evidence (a language absent from a stated list, years clearly
 *   below the threshold, a location that contradicts) becomes "partial"
 *   with that evidence appended: two readings disagree, the person
 *   decides, and the profile lands in "to check" instead of "fit";
 * - a "no" without evidence, or whose evidence is found nowhere in what
 *   the model was given, becomes "unknown", unless the deterministic
 *   pass found the requirement missing with evidence of its own (a
 *   language absent from the listed ones, years below the threshold, a
 *   place that contradicts): that evidence is then shown with the "no".
 *   Silence read as a lack is the one thing the prompt forbids, and a
 *   profile is never set aside with nothing to show for it.
 */
/** The kinds whose deterministic reading may dispute a model's "yes": a degree's or a free requirement's wording is too varied to deny. */
const DISPUTABLE_KINDS: ReadonlySet<BriefCriterion["kind"]> = new Set([
  "skill",
  "language",
  "location",
  "experience",
]);

function requirementOf(
  criterion: BriefCriterion,
  answer: ModelAssessmentAnswer["requirements"][number] | undefined,
  deterministic: CriterionResult | undefined,
  texts: readonly string[] | undefined,
): RequirementAssessment {
  if (!answer) return { criterionId: criterion.id, met: "unknown", evidence: null };
  let met: RequirementMet = isMet(answer.met) ? answer.met : "unknown";
  let evidence = clip(answer.evidence, EVIDENCE_MAX);
  if (met === "unknown") evidence = null;
  const saidYes = met === "yes";
  let unverified = evidence !== null && texts !== undefined && !evidenceGrounded(evidence, texts);
  if (saidYes && (!evidence || unverified)) met = "partial";
  if (met === "no" && unverified) {
    // The model's quote goes; what the deterministic pass may put in its place is the rules' own, not a claim.
    evidence = null;
    unverified = false;
  }
  if (met === "no" && !evidence) {
    if (deterministic?.verdict === "missing" && deterministic.evidence)
      evidence = clip(deterministic.evidence, EVIDENCE_MAX);
    else met = "unknown";
  }
  if (
    saidYes &&
    criterion.required &&
    DISPUTABLE_KINDS.has(criterion.kind) &&
    deterministic?.verdict === "missing" &&
    deterministic.evidence
  ) {
    met = "partial";
    evidence = clip(
      [evidence, deterministic.evidence]
        .filter((part): part is string => Boolean(part))
        .join(" · "),
      EVIDENCE_MAX,
    );
  }
  const row: RequirementAssessment = { criterionId: criterion.id, met, evidence };
  if (unverified && evidence !== null) row.evidenceUnverified = true;
  return row;
}

// ---------------------------------------------------------------------
// the dimensions
// ---------------------------------------------------------------------

/**
 * One dimension as stored: the score rounded into 0..100 (neutral, 50,
 * when the model gave none: silence is never a lack), the note and the
 * evidence clipped; both dropped and counted as withheld when either
 * names a protected characteristic or a career break, since a note
 * rests on its evidence. A score above neutral stands only on an
 * evidence, and on one found in what the model was given (else kept,
 * marked unverified): the same rule as a requirement's "yes", since the
 * role dimension weighs forty points of the composite.
 */
function dimensionOf(
  answer: ModelDimensionAnswer | null | undefined,
  texts: readonly string[] | undefined,
  counter: Withheld,
): DimensionScore {
  const note = clip(answer?.note, NOTE_MAX);
  const evidence = clip(answer?.evidence, EVIDENCE_MAX);
  const forbidden =
    (note !== null && forbiddenSentence(note)) ||
    (evidence !== null && forbiddenSentence(evidence));
  if (forbidden) counter.withheld += 1;
  const kept = forbidden ? null : evidence;
  const unverified = kept !== null && texts !== undefined && !evidenceGrounded(kept, texts);
  const score = dimensionScore(answer?.score) ?? NEUTRAL_SCORE;
  const out: DimensionScore = {
    score: kept !== null && !unverified ? score : Math.min(score, NEUTRAL_SCORE),
    note: forbidden ? "" : (note ?? ""),
    evidence: kept,
  };
  if (unverified) out.evidenceUnverified = true;
  return out;
}

/** The five dimensions from what the model answered under "dimensions": each one once, missing ones neutral. */
function dimensionsOf(
  answered: NonNullable<ModelAssessmentAnswer["dimensions"]>,
  texts: readonly string[] | undefined,
  counter: Withheld,
): Record<AssessmentDimension, DimensionScore> {
  const out = {} as Record<AssessmentDimension, DimensionScore>;
  for (const dimension of DIMENSIONS)
    out[dimension] = dimensionOf(answered[dimension], texts, counter);
  return out;
}

/**
 * The assessment stored for a result: the model's answer made to obey
 * the brief. Every criterion gets a row (one the model skipped is
 * "unknown"); the summary is clipped; the dimensions, strengths,
 * concerns and questions are clipped and guarded. The score is the
 * composite of the dimensions and the requirements' coverage when the
 * model scored the dimensions (its own score is kept as modelScore,
 * advisory), else the model's score as before. Then the decision and
 * the score, the role first: the role at "no" forces no_fit and caps
 * the score at 25, whatever the other requirements say and whether or
 * not the team kept it required; at "partial" it caps the decision at
 * borderline and the score at 65; at "unknown" at borderline and 60 (a
 * role at "yes" without evidence is already "partial" by the general
 * rule). When the model scored the dimensions, a fit also needs the
 * role requirement at "yes" and the métier dimension at
 * ROLE_DIMENSION_FIT_MIN (70) or more, else the decision is at most
 * borderline: the métier weighs forty points of the composite, and a
 * profile retained on the rest alone, or for a brief without a role
 * criterion (no métier judged), is the team's to look at, not to
 * present. Then the required requirements: one at "no" forces no_fit
 * and caps the score at 39; one at "unknown" caps the decision at
 * borderline and the score at 69; one the model itself read as "partial"
 * on a grounded quote keeps a fit (its mark says met in part),
 * REQUIRED_PARTIALS_MAX of them cap the decision at borderline, and so
 * does a "yes" the rules downgraded (no quote, a quote not in the
 * profile, a deterministic pass that disputes it); a no_fit the model answered
 * with the role met (or absent) and no required requirement at "no" is
 * borderline, since a profile is never set aside with nothing to show
 * for it (what bothered the model is in its concerns, with evidence);
 * "fit" needs a score of FIT_MIN_SCORE (75) or more, "borderline" 45 or
 * more, otherwise no_fit. The model's own borderline is never raised:
 * it is allowed to be stricter. With `texts`, every quote is checked
 * against what the model was given; with `junior`, a role at "unknown"
 * keeps its score.
 */
export function enforceAssessment(
  criteria: readonly BriefCriterion[],
  deterministicVerdicts: readonly CriterionResult[],
  modelAnswer: ModelAssessmentAnswer,
  model: string,
  options: EnforceOptions = {},
): Assessment {
  const texts = options.texts;
  const counter: Withheld = { withheld: 0 };
  const answered = new Map<string, ModelAssessmentAnswer["requirements"][number]>();
  for (const entry of modelAnswer.requirements) {
    if (!answered.has(entry.criterionId)) answered.set(entry.criterionId, entry);
  }
  const verdicts = new Map(
    deterministicVerdicts.map((verdict) => [verdict.criterionId, verdict] as const),
  );
  const requirements = criteria.map((criterion) =>
    requirementOf(criterion, answered.get(criterion.id), verdicts.get(criterion.id), texts),
  );
  // A junior brief's role at "unknown" is not a required requirement left unanswered: internships are positions, and a profile with none is the team's to look at, not capped.
  const juniorRole = options.junior ? roleCriterion(criteria) : null;
  const required = (met: RequirementMet) =>
    criteria.some(
      (criterion, index) =>
        criterion.required &&
        requirements[index]?.met === met &&
        !(criterion === juniorRole && met === "unknown"),
    );
  const requiredNo = required("no");
  const requiredUnknown = required("unknown");
  // A required requirement met in part: by the model's own reading, with a quote found in
  // the profile (soft: a related diploma, a close sector), or a "yes" the rules could not
  // ground or the deterministic pass disputed (hard: a claim, which is the team's to check).
  let softPartials = 0;
  let hardPartials = 0;
  criteria.forEach((criterion, index) => {
    const row = requirements[index];
    if (!criterion.required || row?.met !== "partial") return;
    if (answered.get(criterion.id)?.met === "partial" && !row.evidenceUnverified) softPartials += 1;
    else hardPartials += 1;
  });
  const role = roleCriterion(criteria);
  const roleMet: RequirementMet | null = role
    ? (requirements[criteria.indexOf(role)]?.met ?? "unknown")
    : null;

  const modelScore = clampScore(modelAnswer.score);
  const dimensions =
    modelAnswer.dimensions && typeof modelAnswer.dimensions === "object"
      ? dimensionsOf(modelAnswer.dimensions, texts, counter)
      : null;
  let score = dimensions
    ? compositeScore({
        role: dimensions.role.score,
        seniority: dimensions.seniority.score,
        context: dimensions.context.score,
        trajectory: dimensions.trajectory.score,
        achievements: dimensions.achievements.score,
        requirementsCoverage: requirementsCoverage(criteria, requirements),
      })
    : modelScore;
  let decision: AssessmentDecision = isDecision(modelAnswer.decision)
    ? modelAnswer.decision
    : decisionFromScore(score);
  // The métier first: another one sets the profile aside whatever the rest, an adjacent one asks for a human look.
  if (roleMet === "no") {
    decision = "no_fit";
    score = Math.min(score, ROLE_NO_SCORE_CAP);
  } else if (roleMet === "partial") {
    score = Math.min(score, ROLE_PARTIAL_SCORE_CAP);
    if (decision === "fit") decision = "borderline";
  } else if (roleMet === "unknown") {
    // A junior brief reads internships and first positions as positions: the cap would empty "to present" by construction; the human look stays.
    if (!options.junior) score = Math.min(score, ROLE_UNKNOWN_SCORE_CAP);
    if (decision === "fit") decision = "borderline";
  }
  // With the dimensions, what is presented is strict: the role requirement at "yes" and the métier scored high enough, else the team looks first.
  if (
    dimensions &&
    decision === "fit" &&
    (roleMet !== "yes" || dimensions.role.score < ROLE_DIMENSION_FIT_MIN)
  )
    decision = "borderline";
  if (requiredNo) {
    decision = "no_fit";
    score = Math.min(score, REQUIRED_NO_SCORE_CAP);
  } else if (requiredUnknown) {
    score = Math.min(score, REQUIRED_UNKNOWN_SCORE_CAP);
    if (decision === "fit") decision = "borderline";
  } else if ((hardPartials > 0 || softPartials >= REQUIRED_PARTIALS_MAX) && decision === "fit") {
    decision = "borderline";
  }
  // A no_fit the rules cannot pin on the role or on a required requirement is the team's call: borderline, and the thresholds below still set aside a composite too low (the card then names the score).
  if (decision === "no_fit" && roleMet !== "no" && !requiredNo) decision = "borderline";
  if (decision === "fit" && score < FIT_MIN_SCORE) decision = "borderline";
  if (decision === "borderline" && score < BORDERLINE_MIN_SCORE) decision = "no_fit";

  const assessment: Assessment = {
    decision,
    ...(isDecision(modelAnswer.decision) ? { modelDecision: modelAnswer.decision } : {}),
    score,
    summary: clip(modelAnswer.summary, SUMMARY_MAX) ?? "",
    requirements,
    model,
  };
  if (dimensions) {
    assessment.modelScore = modelScore;
    assessment.dimensions = dimensions;
    assessment.strengths = sentencesOf(modelAnswer.strengths, STRENGTHS_MAX, counter);
    assessment.concerns = sentencesOf(modelAnswer.concerns, CONCERNS_MAX, counter);
    assessment.questions = sentencesOf(modelAnswer.questions, QUESTIONS_MAX, counter);
  }
  if (counter.withheld > 0) assessment.withheld = counter.withheld;
  return assessment;
}

// ---------------------------------------------------------------------
// the second opinion
// ---------------------------------------------------------------------

/**
 * The assessment after the second opinion: a doubt WITH a quoted
 * evidence found in what the model was given (when `texts` is known)
 * and a reason that names neither a protected characteristic nor a
 * career break sends the decision to borderline (never raises a
 * no_fit), caps the score at 69, appends the reason to the concerns
 * (the card shows it under its own heading) and stores the challenge;
 * anything else (confirmed, or a doubt without evidence, or with a
 * quote the profile does not hold: an opinion is not a fact) is stored
 * as confirmed and changes nothing else. A reason or an evidence the
 * filter withheld adds to the assessment's count.
 */
export function applyChallenge(
  assessment: Assessment,
  answer: ModelChallengeAnswer,
  options: EnforceOptions = {},
): Assessment {
  const rawReason = clip(answer.reason, NOTE_MAX);
  const reasonForbidden = rawReason !== null && forbiddenSentence(rawReason);
  const reason = rawReason && !reasonForbidden ? rawReason : null;
  const rawEvidence = clip(answer.evidence, EVIDENCE_MAX);
  const evidenceForbidden = rawEvidence !== null && forbiddenSentence(rawEvidence);
  const evidence = rawEvidence && !evidenceForbidden ? rawEvidence : null;
  const withheld =
    (assessment.withheld ?? 0) + (reasonForbidden ? 1 : 0) + (evidenceForbidden ? 1 : 0);
  const counted = withheld > 0 ? { withheld } : {};
  const grounded =
    evidence !== null && (options.texts === undefined || evidenceGrounded(evidence, options.texts));
  const doubt = answer.verdict === "doubt" && reason !== null && grounded;
  if (!doubt) {
    // A doubt the model could not quote is not kept even as a sentence; a confirmation's reason (why the profile holds) is.
    const challenge: AssessmentChallenge = {
      verdict: "confirmed",
      reason: answer.verdict === "confirmed" ? reason : null,
      evidence: null,
    };
    return { ...assessment, ...counted, challenge };
  }
  const concerns = [...(assessment.concerns ?? [])];
  if (!concerns.includes(reason)) concerns.push(reason);
  const challenge: AssessmentChallenge = { verdict: "doubt", reason, evidence };
  return {
    ...assessment,
    ...counted,
    decision: assessment.decision === "no_fit" ? "no_fit" : "borderline",
    score: Math.min(assessment.score, CHALLENGE_DOUBT_SCORE_CAP),
    concerns,
    challenge,
  };
}

// ---------------------------------------------------------------------
// reading assessed results
// ---------------------------------------------------------------------

/** The decision of a result: the assessment's, or "unassessed" when no model answered. */
export function decisionOf(result: Pick<MatchResult, "assessment">): ResultDecision {
  return result.assessment?.decision ?? "unassessed";
}

/** The tier the comparative pass gave a result, null before it ran. */
export function tierOf(result: Pick<MatchResult, "assessment">): AssessmentTier | null {
  const tier = result.assessment?.tier;
  return isTier(tier) ? tier : null;
}

const TIER_RANK: Record<AssessmentTier, number> = { A: 0, B: 1, C: 2 };

function tierRank(result: Pick<MatchResult, "assessment">): number {
  const tier = tierOf(result);
  return tier ? TIER_RANK[tier] : TIERS.length;
}

/** Tier first (A, B, C, then none), then the assessed score (highest first), then the deterministic score. */
export function compareTiered(a: MatchResult, b: MatchResult): number {
  const ta = tierRank(a);
  const tb = tierRank(b);
  if (ta !== tb) return ta - tb;
  const sa = a.assessment?.score ?? 0;
  const sb = b.assessment?.score ?? 0;
  if (sa !== sb) return sb - sa;
  return b.score - a.score;
}

export interface ResultBuckets {
  /** The profiles to present: fit with tier A, or fit the comparative pass has not tiered yet. */
  present: MatchResult[];
  /** The profiles worth a deeper look: borderline, and fit with tier B or C. */
  deeper: MatchResult[];
  /** The profiles the analysis set aside: no_fit. */
  setAside: MatchResult[];
  /** No model read them yet, in the order given (the deterministic ranking). */
  unassessed: MatchResult[];
  /** Every fit, whatever its tier (kept for callers that read by decision). */
  fit: MatchResult[];
  /** Every borderline. */
  borderline: MatchResult[];
  /** The same list as setAside. */
  noFit: MatchResult[];
}

/**
 * The results by what the page shows: to present, to dig into, set
 * aside, each sorted by tier then score; the unassessed kept in the
 * order given. The lists by decision (fit, borderline, noFit) are the
 * same results read the old way.
 */
export function bucketResults(results: readonly MatchResult[]): ResultBuckets {
  const buckets: ResultBuckets = {
    present: [],
    deeper: [],
    setAside: [],
    unassessed: [],
    fit: [],
    borderline: [],
    noFit: [],
  };
  for (const result of results) {
    switch (decisionOf(result)) {
      case "fit": {
        buckets.fit.push(result);
        const tier = tierOf(result);
        if (tier === null || tier === "A") buckets.present.push(result);
        else buckets.deeper.push(result);
        break;
      }
      case "borderline":
        buckets.borderline.push(result);
        buckets.deeper.push(result);
        break;
      case "no_fit":
        buckets.setAside.push(result);
        break;
      default:
        buckets.unassessed.push(result);
    }
  }
  buckets.present.sort(compareTiered);
  buckets.deeper.sort(compareTiered);
  buckets.setAside.sort(compareTiered);
  buckets.fit.sort(compareTiered);
  buckets.borderline.sort(compareTiered);
  buckets.noFit = buckets.setAside;
  return buckets;
}

/**
 * True for a criterion whose "no" sets a profile aside on its own: the
 * role, whether or not the team kept it required, and every required
 * one. What the panel and the cards name as the reason.
 */
function setsAside(criterion: BriefCriterion): boolean {
  return criterion.kind === "role" || criterion.required;
}

/**
 * The criterion most often at "no" among those that set a profile aside
 * (the role, then the required ones; the first in that order on a tie)
 * across the assessed results; null when no assessed result has one at
 * "no".
 */
export function mostMissingRequirement(
  criteria: readonly BriefCriterion[],
  results: readonly MatchResult[],
): BriefCriterion | null {
  const counts = new Map<string, number>();
  for (const result of results) {
    for (const requirement of result.assessment?.requirements ?? []) {
      if (requirement.met === "no")
        counts.set(requirement.criterionId, (counts.get(requirement.criterionId) ?? 0) + 1);
    }
  }
  let best: BriefCriterion | null = null;
  let bestCount = 0;
  for (const criterion of roleFirst(criteria)) {
    if (!setsAside(criterion)) continue;
    const count = counts.get(criterion.id) ?? 0;
    if (count > bestCount) {
      best = criterion;
      bestCount = count;
    }
  }
  return best;
}

const VERDICT_TO_MET: Record<CriterionVerdict, RequirementMet> = {
  match: "yes",
  partial: "partial",
  missing: "no",
  not_stated: "unknown",
};

/** A RequirementList row with the kind of its criterion, so a card can name the role as such ("Métier · Business Developer"), and whether its quote was found in the profile. */
export type ResultRequirementRow = RequirementRow & {
  kind: CriterionKind;
  evidenceUnverified?: boolean;
};

/**
 * One row per criterion for the shared RequirementList, the role first
 * wherever the brief keeps it: from the assessment when the model
 * answered, else from the deterministic verdicts (found → yes, in part
 * → partial, absent → no, not stated → unknown); a criterion neither
 * one speaks about is unknown.
 */
export function requirementRows(
  criteria: readonly BriefCriterion[],
  result: Pick<MatchResult, "verdicts" | "assessment">,
): ResultRequirementRow[] {
  const assessed = new Map(
    (result.assessment?.requirements ?? []).map((row) => [row.criterionId, row] as const),
  );
  const verdicts = new Map(
    result.verdicts.map((verdict) => [verdict.criterionId, verdict] as const),
  );
  return roleFirst(criteria).map((criterion) => {
    const row = assessed.get(criterion.id);
    if (row) {
      return {
        id: criterion.id,
        kind: criterion.kind,
        label: criterion.label,
        required: criterion.required,
        met: row.met,
        evidence: row.evidence,
        ...(row.evidenceUnverified ? { evidenceUnverified: true } : {}),
      };
    }
    const verdict = verdicts.get(criterion.id);
    return {
      id: criterion.id,
      kind: criterion.kind,
      label: criterion.label,
      required: criterion.required,
      met: verdict ? VERDICT_TO_MET[verdict.verdict] : "unknown",
      evidence: verdict?.evidence ?? null,
    };
  });
}

/**
 * The first requirement at "no" that sets a profile aside on its own
 * (the role, then the required ones, in the brief's order) of an
 * assessed result: the reason a card in "set aside" shows.
 */
export function firstMissingRequirement(
  criteria: readonly BriefCriterion[],
  result: Pick<MatchResult, "assessment">,
): BriefCriterion | null {
  const assessment = result.assessment;
  if (!assessment) return null;
  const rows = new Map(assessment.requirements.map((row) => [row.criterionId, row.met] as const));
  return (
    roleFirst(criteria).find(
      (criterion) => setsAside(criterion) && rows.get(criterion.id) === "no",
    ) ?? null
  );
}
