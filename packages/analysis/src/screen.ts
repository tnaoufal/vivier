/**
 * The screening of the profiles the triage kept (yes, close), before
 * any is read in full: a senior recruiter gives each card a score 0..100
 * against the brief's reading (the level asked first, then the
 * must-haves and the required requirements, then the context) and a
 * reason of twelve words at most, SCREEN_BATCH_MAX cards a call, so the
 * promotion reads the best PROMOTE_MAX of a kept set that can hold
 * hundreds. The card is the triage's (no name, no contact, no place, no
 * link, no photo, no summary, no CV text; the texts cleaned of the
 * person's name and place), its positions written as lines, with the
 * years and the first skills always on it since the seniority weighs
 * most here. The rules bind the answer before it is stored: a card not
 * answered, or scored outside 0..100, keeps a null score (unscorable,
 * never a zero); a reason is clipped to SCREEN_REASON_MAX and withheld
 * when it names a protected characteristic or a period without a
 * position. rankKept() is the order of the kept rows (score first,
 * nulls last, yes before close, then the id) and promotable() what the
 * promotion takes: every forced row, then the PROMOTE_MAX best. Pure:
 * no model, no data access; tested in screen.test.ts.
 */
import { forbiddenSentence } from "./assessment.js";
import { roleCriterion } from "./criteria.js";
import {
  triageCard,
  triageRoleBrief,
  type TriageBriefSource,
  type TriageCard,
  type TriageRoleBrief,
} from "./triage.js";
import type { BriefCriterion, RoleProfile, TriageProfile, TriageVerdict } from "./types.js";

/** The most cards one screening call scores. */
export const SCREEN_BATCH_MAX = 25;
/** A reason is clipped here before it is stored (the prompt asks for SCREEN_REASON_WORDS words). */
export const SCREEN_REASON_MAX = 80;
export const SCREEN_REASON_WORDS = 12;
/** The skills a screening card carries: the first ones listed, the most central first. */
export const SCREEN_SKILLS_MAX = 12;
/** How many of the kept profiles the promotion brings into the results for the full reading. */
export const PROMOTE_MAX = 30;

/** What the model reads of one profile: the triage card with its positions as lines, under a ref that names it in the batch only. */
export interface ScreenCard {
  ref: string;
  headline: string | null;
  /** The position held today as one line: title | company | since when. */
  current: string | null;
  /** The earlier positions, newest first, one line each: title | company | period. */
  previous: string[];
  /** The total years of experience as stated; null when the profile states none. */
  years: number | null;
  /** The first degree as one short line, never its year. */
  education: string | null;
  /** The first SCREEN_SKILLS_MAX skills. */
  skills: string[];
}

/** A card and the candidate it stands for: the id stays on the server, the model reads the ref. */
export interface ScreenEntry {
  candidateId: string;
  card: ScreenCard;
}

function line(parts: readonly (string | null)[]): string | null {
  const kept = parts.filter((part): part is string => Boolean(part));
  return kept.length ? kept.join(" | ") : null;
}

function period(from: string | null, to: string | null): string | null {
  if (!from && !to) return null;
  return `${from ?? "?"} - ${to ?? "?"}`;
}

/** The screening card of one profile: the triage card (same redaction, same clips), its positions as lines, the years and the skills always on it. */
export function screenCard(profile: TriageProfile, ref: string): ScreenCard {
  const card: TriageCard = triageCard(profile, ref);
  return {
    ref,
    headline: card.headline,
    current: card.current
      ? line([
          card.current.title,
          card.current.company,
          card.current.since ? `since ${card.current.since}` : null,
        ])
      : null,
    previous: card.previous.flatMap((position) => {
      const text = line([position.title, position.company, period(position.from, position.to)]);
      return text ? [text] : [];
    }),
    years: card.years,
    education: card.education,
    skills: card.skills.slice(0, SCREEN_SKILLS_MAX),
  };
}

/** The cards of a batch, refs c1..cN in the order given. */
export function screenEntries(profiles: readonly TriageProfile[]): ScreenEntry[] {
  return profiles.map((profile, index) => ({
    candidateId: profile.id,
    card: screenCard(profile, `c${index + 1}`),
  }));
}

/** The job as the screening reads it: the triage's reading of it, with the years asked and the context the brief states. */
export interface ScreenRoleBrief extends TriageRoleBrief {
  yearsMin: number | null;
  yearsMax: number | null;
  /** The sector, product, clients and scope the brief states; null without a role profile. */
  context: RoleProfile["context"] | null;
}

/** The job for the screening: triageRoleBrief() plus the years and the context of the role profile when the brief has one. */
export function screenRoleBrief(brief: TriageBriefSource): ScreenRoleBrief {
  const profile = brief.role_profile;
  return {
    ...triageRoleBrief(brief),
    yearsMin: profile?.yearsMin ?? null,
    yearsMax: profile?.yearsMax ?? null,
    context: profile ? { ...profile.context } : null,
  };
}

/** One requirement of the brief as the screening reads it: the role is left out (role carries it). */
export interface ScreenRequirement {
  label: string;
  value: string;
  required: boolean;
  weight: number;
}

/** The brief's requirements other than the role, in the brief's order. */
export function screenRequirements(criteria: readonly BriefCriterion[]): ScreenRequirement[] {
  const role = roleCriterion(criteria);
  return criteria
    .filter((criterion) => criterion !== role)
    .map((criterion) => ({
      label: criterion.label,
      value: criterion.value,
      required: criterion.required,
      weight: criterion.weight,
    }));
}

export interface ScreenPayload {
  role: ScreenRoleBrief;
  requirements: ScreenRequirement[];
  cards: ScreenCard[];
}

/** The user message of a screening call: the job, its requirements, then the cards. */
export function screenPayload(
  role: ScreenRoleBrief,
  requirements: readonly ScreenRequirement[],
  cards: readonly ScreenCard[],
): ScreenPayload {
  return { role, requirements: [...requirements], cards: [...cards] };
}

export function screenSystemPrompt(): string {
  return [
    "You are a senior recruitment consultant. Before the profiles a sourcer kept for ONE job are read in full, you score each card against the job's reading, so the team reads the strongest first. The team reviews every reading; nothing you answer is applied by itself, and every profile is still a person the team may read in full.",
    'Answer with JSON only: {"scores":[{"ref":"c1","score":0,"reason":"..."}]}, exactly one entry per card, with its ref exactly as given.',
    "role is the job: title is the job as the team names it; domain, missions, equivalentTitles and mustHaves say what it is; seniority (junior | confirmed | senior | manager | executive), yearsMin and yearsMax are the level and the years asked (null when the brief says nothing); adjacentProfiles are the neighbouring backgrounds the team still reads; context is the sector, product, clients and scope the brief states (null when it does not); definition, when present, is the team's own definition of the job. requirements are the brief's other requirements, each with its label, its value, whether it is required and its weight (1 welcome, 2 asked, 3 insisted on).",
    "Each card is one profile: headline (how the person presents themselves), current (the position held today: title | company | since when), previous (earlier positions, newest first: title | company | period), years (total years of experience as stated), education (the first degree), skills (the first ones listed). A field the card leaves out is not stated, never a lack.",
    "score: 0 to 100, how strongly the card answers the job's reading. Weigh the seniority most: the level reached (the titles, the scope, the thread of the positions) and the years against role.seniority, yearsMin and yearsMax; then the must-haves and the required requirements the card shows or contradicts; then the context. 85 or more: this job at the level asked, the must-haves visible on the card. Around 60: this job, the level or a must-have unclear. Around 40: this job far under the level asked, or a required requirement the card contradicts. 20 or less: the card describes another job.",
    "When the card says nothing about a point, the point is neutral: silence is never a lack, and a thin card scores around 50, never 0. Above the level asked is a point to weigh, never a disqualification by itself, unless yearsMax is set or the brief says it wants that level and not more.",
    `reason: at most ${SCREEN_REASON_WORDS} words, in the language of the brief (the language of role.title and role.missions), naming the fact that decides (a position, the years, a must-have seen or missing); a fact, never an opinion, no markdown.`,
    "Never use, infer or mention age, date of birth, gender, origin, nationality, ethnicity, family situation, pregnancy, health, disability, religion, union membership, political opinion, sexual orientation, appearance or any other protected characteristic; never a career break, a gap or a period without a position.",
  ].join("\n");
}

/** The model's answer as the schema lets it through, before any rule applies. */
export interface ModelScreenAnswer {
  scores: { ref: string; score?: number | null | undefined; reason?: string | null | undefined }[];
}

/** What is stored for one candidate: the score (null when the card could not be scored) and the reason (null when none, or withheld). */
export interface ScreenOutcome {
  score: number | null;
  reason: string | null;
}

/** A score in 0..100, rounded; null for anything else, a score outside the range included (a wrong answer is not a low one). */
function scoreOf(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  return rounded >= 0 && rounded <= 100 ? rounded : null;
}

function reasonOf(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const clipped = value.trim().replace(/\s+/g, " ").slice(0, SCREEN_REASON_MAX).trim();
  return clipped && !forbiddenSentence(clipped) ? clipped : null;
}

/**
 * The outcomes stored, by candidate id, one per card: a card the model
 * did not answer, or scored outside 0..100 (or not with a number),
 * keeps a null score; a ref answered twice keeps its first answer; a
 * ref no card carries is ignored; a reason is trimmed, clipped to
 * SCREEN_REASON_MAX and withheld (null) when it names a protected
 * characteristic or a period without a position (the assessment's
 * filter).
 */
export function enforceScreen(
  entries: readonly ScreenEntry[],
  answer: ModelScreenAnswer,
): Map<string, ScreenOutcome> {
  const byRef = new Map(entries.map((entry) => [entry.card.ref, entry] as const));
  const answered = new Map<string, ScreenOutcome>();
  for (const item of Array.isArray(answer.scores) ? answer.scores : []) {
    if (!item || typeof item.ref !== "string") continue;
    const entry = byRef.get(item.ref.trim());
    if (!entry || answered.has(entry.candidateId)) continue;
    answered.set(entry.candidateId, { score: scoreOf(item.score), reason: reasonOf(item.reason) });
  }
  const out = new Map<string, ScreenOutcome>();
  for (const entry of entries)
    out.set(entry.candidateId, answered.get(entry.candidateId) ?? { score: null, reason: null });
  return out;
}

/** A kept row of the snapshot as the promotion reads it (search_triage: the verdict, the screening's score, whether a person forced it in). */
export interface KeptRow {
  candidate_id: string;
  verdict: TriageVerdict | null;
  score: number | null;
  forced?: boolean | undefined;
}

const VERDICT_RANK: Record<TriageVerdict, number> = { yes: 0, close: 1, unknown: 2, no: 3 };

function verdictRank(verdict: TriageVerdict | null): number {
  return verdict === null ? VERDICT_RANK.no + 1 : VERDICT_RANK[verdict];
}

/** The best score first (a null score last), then yes before close, then the candidate id: a total order, the same in every runtime. */
export function compareKept(a: KeptRow, b: KeptRow): number {
  if (a.score !== b.score) {
    if (a.score === null) return 1;
    if (b.score === null) return -1;
    return b.score - a.score;
  }
  const byVerdict = verdictRank(a.verdict) - verdictRank(b.verdict);
  if (byVerdict !== 0) return byVerdict;
  if (a.candidate_id === b.candidate_id) return 0;
  return a.candidate_id < b.candidate_id ? -1 : 1;
}

/** The rows in the order of compareKept(). */
export function rankKept<T extends KeptRow>(rows: readonly T[]): T[] {
  return [...rows].sort(compareKept);
}

/** The rows the promotion takes, in order: every forced row (a person brought it back), then the `max` best of the others. */
export function promotable<T extends KeptRow>(rows: readonly T[], max: number = PROMOTE_MAX): T[] {
  const ordered = rankKept(rows);
  const forced = ordered.filter((row) => row.forced === true);
  const best = ordered.filter((row) => row.forced !== true).slice(0, Math.max(0, Math.floor(max)));
  return rankKept([...forced, ...best]);
}
