/**
 * The comparative tiering: once the profiles have been read one by one
 * and the retained ones challenged, a senior recruiter looks at them
 * side by side and decides what to put in front of the hiring manager.
 * The browser sends groups of up to RANK_GROUP_MAX retained or
 * borderline results (then, when there were several groups, one last
 * group of the A's, so their order is one comparison); the server
 * builds one compact sheet per result (no name, no CV text: the
 * decision, the score, the five dimension scores, the requirement rows
 * with the required ones marked, the seniority note, the strengths,
 * the concerns and the second opinion's reservation), asks the model
 * for a tier per candidate, anchored on the brief (A present now, B a
 * reservation to check, C behind the others of the group) with one
 * line saying why relative to the others, and applyRanking() binds the
 * answer: a no_fit never gets A or B, a borderline never gets A, a fit
 * at C becomes borderline (never no_fit: the team decides), unknown ids
 * are ignored. Pure, tested in ranking.test.ts.
 */
import { compareTiered, forbiddenSentence, isTier, NOTE_MAX } from "./assessment.js";
import { roleCriterion, roleFirst } from "./criteria.js";
import { DIMENSIONS } from "./scoring.js";
import type {
  AssessmentDimension,
  AssessmentTier,
  BriefCriterion,
  MatchResult,
  RequirementMet,
  RoleProfile,
} from "./types.js";

/** The most results one ranking call compares; fewer than RANK_GROUP_MIN is nothing to compare. */
export const RANK_GROUP_MAX = 8;
export const RANK_GROUP_MIN = 2;

/** One requirement row as the sheet carries it: the label, whether the brief requires it, what the first reading answered. */
export interface RankingRequirement {
  label: string;
  required: boolean;
  met: RequirementMet;
}

/** One result as the ranking reads it: the sheet, never the person. */
export interface RankingSheet {
  candidateId: string;
  decision: "fit" | "borderline" | "no_fit";
  score: number;
  /** The five dimension scores; null for an assessment made before the dimensions. */
  dimensions: Record<AssessmentDimension, number> | null;
  /** One row per criterion of the search, the role first: so the model applies its own rule on the must-haves. */
  requirements: RankingRequirement[];
  /** The first reading's note on the seniority (under, at, above the level); null when it wrote none. */
  seniority: string | null;
  strengths: string[];
  concerns: string[];
  /** The second opinion's reason when it doubted; null otherwise. */
  challenge: string | null;
}

/** The model's answer as the schema lets it through. */
export interface ModelRankingAnswer {
  ranking: { candidateId: string; tier: string; note?: string | null | undefined }[];
}

/** The sheets of the results that carry an assessment, in the order given, their requirement rows joined with the search's criteria. */
export function rankingSheets(
  results: readonly MatchResult[],
  criteria: readonly BriefCriterion[] = [],
): RankingSheet[] {
  const ordered = roleFirst(criteria);
  const sheets: RankingSheet[] = [];
  for (const result of results) {
    const assessment = result.assessment;
    if (!assessment) continue;
    const dimensions = assessment.dimensions;
    let scores: Record<AssessmentDimension, number> | null = null;
    if (dimensions) {
      scores = {} as Record<AssessmentDimension, number>;
      for (const dimension of DIMENSIONS) scores[dimension] = dimensions[dimension]?.score ?? 50;
    }
    const rows = new Map(assessment.requirements.map((row) => [row.criterionId, row.met] as const));
    sheets.push({
      candidateId: result.candidateId,
      decision: assessment.decision,
      score: assessment.score,
      dimensions: scores,
      requirements: ordered.flatMap((criterion) => {
        const met = rows.get(criterion.id);
        return met ? [{ label: criterion.label, required: criterion.required, met }] : [];
      }),
      seniority: dimensions?.seniority.note || null,
      strengths: assessment.strengths ?? [],
      concerns: assessment.concerns ?? [],
      challenge: assessment.challenge?.verdict === "doubt" ? assessment.challenge.reason : null,
    });
  }
  return sheets;
}

export interface RankingPayload {
  brief: {
    title: string;
    /** The role's definition when the brief has one. */
    role: string | null;
    mustHaves: string[];
  };
  candidates: RankingSheet[];
}

/** The user message: the brief in a few lines (title, role definition, must-haves) and the sheets. */
export function rankingPayload(
  brief: {
    title: string;
    criteria: readonly BriefCriterion[];
    roleProfile?: RoleProfile | null | undefined;
  },
  sheets: readonly RankingSheet[],
): RankingPayload {
  const role = roleCriterion(brief.criteria);
  return {
    brief: {
      title: brief.title.trim().slice(0, 200),
      role: role ? role.value : null,
      mustHaves: brief.roleProfile?.mustHaves ?? [],
    },
    candidates: [...sheets],
  };
}

export function rankingSystemPrompt(): string {
  return [
    "You are a senior recruitment consultant deciding which of a few retained profiles to present to the hiring manager for ONE job brief. You compare the candidates of this group WITH EACH OTHER, from the sheets given: a first reading's decision and score, its five dimension scores (role, seniority, context, trajectory, achievements, each 0 to 100), the requirement rows (met, partly, not met, not stated; required ones marked), its note on the seniority, the strengths and concerns it listed, and the second opinion's reservation when there is one. The team reviews your ranking and decides; nothing you answer is applied by itself.",
    'Answer with JSON only: {"ranking":[{"candidateId":"...","tier":"A|B|C","note":"..."}]}, one entry per candidate given, with the candidateId exactly as given, in the order you would present them: tier A first, then B, then C, and within A and within B from the strongest to the weakest.',
    "- tier A: present now: you would present this profile to the hiring manager now, whatever the others: the métier is the role, every must-have is met, the second opinion raised nothing or a minor point.",
    "- tier B: worth a deeper look: a real reservation to check before presenting (the role adjacent, a must-have unknown or partial, a seniority or context mismatch, a doubt from the second opinion).",
    "- tier C: do not present now: within this group the reservations outweigh what the profile brings next to the others; a C is still a profile the team may present.",
    '- A required requirement at "unknown" or "partial" is a reservation to check: tier B at most.',
    "- The tier is a judgement of the profile against the brief; the comparison settles the close calls and the order.",
    `- note: one line in the language of the brief, at most ${NOTE_MAX} characters, saying why this tier RELATIVE TO THE OTHERS of the group (what this profile has or lacks that the others do not); a fact from the sheet, not an opinion, no markdown.`,
    '- The tiers are not quotas: a group of similar profiles may all be A, or all be B. A borderline decision from the first reading is a reservation you weigh, not a tier by itself. A candidate whose decision is "borderline" can be B at most: the first reading left a point to check. A "fit" you put at C is sent back to the team as "to check", not set aside: say in the note what to check.',
    "- Never mention, infer or use age, date of birth, gender, origin, nationality, ethnicity, family situation, pregnancy, health, disability, religion, union membership, political opinion, sexual orientation, appearance or any other protected characteristic; never a career break or a gap.",
  ].join("\n");
}

/** The tier a result may hold given its decision: a no_fit C at most, a borderline B at most, a fit as answered. */
function boundTier(
  decision: "fit" | "borderline" | "no_fit",
  tier: AssessmentTier,
): AssessmentTier {
  if (decision === "no_fit") return "C";
  if (decision === "borderline" && tier === "A") return "B";
  return tier;
}

/**
 * The results with the model's tiers applied: the first entry per id
 * wins; an id not in `results`, or without an assessment, or a tier the
 * schema does not know, is ignored; a no_fit gets C at most, a
 * borderline B at most, a fit A, B or C as answered, and a fit at C
 * becomes borderline (never no_fit: the team decides). The note is
 * clipped (dropped and counted as withheld when it names what no
 * sentence may). Results the answer does not name are returned
 * untouched, in the order given.
 */
export function applyRanking(
  results: readonly MatchResult[],
  answer: ModelRankingAnswer,
): MatchResult[] {
  const tiers = new Map<string, { tier: AssessmentTier; note: string | null; withheld: boolean }>();
  for (const entry of answer.ranking) {
    if (!isTier(entry.tier) || tiers.has(entry.candidateId)) continue;
    const raw = typeof entry.note === "string" ? entry.note.trim().slice(0, NOTE_MAX) : "";
    const withheld = raw.length > 0 && forbiddenSentence(raw);
    tiers.set(entry.candidateId, {
      tier: entry.tier,
      note: raw && !withheld ? raw : null,
      withheld,
    });
  }
  return results.map((result) => {
    const assessment = result.assessment;
    const given = tiers.get(result.candidateId);
    if (!assessment || !given) return result;
    const tier = boundTier(assessment.decision, given.tier);
    const decision =
      assessment.decision === "fit" && tier === "C" ? "borderline" : assessment.decision;
    const counted = given.withheld ? { withheld: (assessment.withheld ?? 0) + 1 } : {};
    return {
      ...result,
      assessment: { ...assessment, ...counted, decision, tier, rankNote: given.note },
    };
  });
}

/** The results sorted by tier (A, B, C, then none), then assessed score, then deterministic score. */
export function sortByTier(results: readonly MatchResult[]): MatchResult[] {
  return [...results].sort(compareTiered);
}
