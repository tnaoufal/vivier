/**
 * The triage of a whole-pool search: before any CV is read in full,
 * every active profile of the pool is sorted by métier, forty at a
 * time, from a compact card (the headline, the position held today,
 * four earlier ones, the years, the first degree, the first skills:
 * no name, no contact, no place, no link, no photo, no summary, no CV
 * text), the way a senior recruiter briefs a sourcer: is this person's
 * job this job, a neighbouring one worth reading, another one, or can
 * the card not tell. The profiles kept (yes, close, unknown: a card too
 * thin to judge is read in full rather than dropped, since silence is
 * never a lack) enter the search's results for the full reading; the
 * others are set aside with the reason the model gave. The rules here
 * bind the answer before it is stored: an unanswered card is unknown,
 * a reason that names a protected characteristic is withheld, and a
 * "no" on a card whose current title or headline carries the job's
 * name is read anyway. Pure: no model, no data access; tested in
 * triage.test.ts.
 */
import type {
  BriefCriterion,
  CandidateRow,
  MatchResult,
  RoleProfile,
  RoleSeniority,
  TriageVerdict,
} from "@/lib/db/types";

import { forbiddenSentence } from "./assessment";
import { roleCriterion } from "./criteria";
import { compareResults, containsWord, normalise } from "./matching";
import { redactIdentity } from "./prompts";

/** The most profiles one triage call reads. */
export const TRIAGE_BATCH_MAX = 40;
/** A verdict's reason is clipped here before it is stored. */
export const TRIAGE_REASON_MAX = 160;
/** How many triage calls the browser keeps in flight at once. */
export const TRIAGE_CONCURRENCY = 4;
/** The user message of a full batch stays under about this many characters: the cards shrink to fit. */
export const TRIAGE_PAYLOAD_MAX = 16000;

/** Every text of a card is clipped here at most. */
const CARD_TEXT_MAX = 120;
const CARD_DATE_MAX = 20;
const CARD_PREVIOUS_MAX = 4;
const CARD_SKILLS_MAX = 12;
const ROLE_TEXT_MAX = 120;
const ROLE_LIST_MAX = 8;
const ROLE_MISSIONS_MAX = 6;
const ROLE_MUST_HAVES_MAX = 6;
const ROLE_DEFINITION_MAX = 600;
/** The shortest phrase the guard looks for once normalised ("rh", "pm"). */
const ROLE_TERM_MIN = 2;

export const TRIAGE_VERDICTS: readonly TriageVerdict[] = ["yes", "close", "no", "unknown"];

export function isTriageVerdict(value: unknown): value is TriageVerdict {
  return typeof value === "string" && (TRIAGE_VERDICTS as readonly string[]).includes(value);
}

/** True for a verdict whose profile is read in full: everything but another job. */
export function passesTriage(verdict: TriageVerdict): boolean {
  return verdict !== "no";
}

/** The verdicts whose profiles the promotion takes into the results. */
export const TRIAGE_PASSING: readonly TriageVerdict[] = TRIAGE_VERDICTS.filter(passesTriage);

// ---------------------------------------------------------------------
// the card
// ---------------------------------------------------------------------

/**
 * The columns the triage loads: the name is read only so redactIdentity()
 * can take it out of the texts; it never leaves. Never the contact
 * details, the place, the links, the photo, the summary or the CV text.
 */
export const TRIAGE_PROFILE_COLUMNS =
  "id,full_name,headline,years_experience,experiences,education,skills";

export type TriageProfile = Pick<
  CandidateRow,
  "id" | "full_name" | "headline" | "years_experience" | "experiences" | "education" | "skills"
>;

export interface TriageCurrent {
  title: string;
  company: string | null;
  since: string | null;
}

export interface TriagePrevious {
  title: string;
  company: string | null;
  from: string | null;
  to: string | null;
}

/** What the model reads of one profile, under a ref that names it in the batch only. */
export interface TriageCard {
  ref: string;
  headline: string | null;
  /** The first position without an end date, null when every position has ended. */
  current: TriageCurrent | null;
  /** Up to four other positions, in the CV's order (newest first). */
  previous: TriagePrevious[];
  years: number | null;
  /** The first degree as one short line (degree, school), never its year. */
  education: string | null;
  skills: string[];
}

/** A card and the candidate it stands for: the id stays on the server, the model reads the ref. */
export interface TriageEntry {
  candidateId: string;
  card: TriageCard;
}

function clip(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/\s+/g, " ");
  return trimmed ? trimmed.slice(0, max).trim() : null;
}

/** An end that says the position is held today, as a hand-typed profile may write it. */
const ONGOING =
  /^(?:present|current|currently|now|today|ongoing|aujourd'hui|a ce jour|actuel(?:le)?|actuellement|en cours|en poste|-|…)$/;

function ended(end: unknown): boolean {
  const text = normalise(typeof end === "string" ? end : "").replace(/[’‘]/g, "'");
  return text.length > 0 && !ONGOING.test(text);
}

/**
 * The compact card of one profile: every text redacted of the person's
 * name, e-mail and phone (redactIdentity), trimmed and clipped to
 * CARD_TEXT_MAX; the position held today apart from the earlier ones.
 */
export function triageCard(profile: TriageProfile, ref: string): TriageCard {
  const text = (value: unknown, max: number = CARD_TEXT_MAX): string | null =>
    typeof value === "string" ? clip(redactIdentity(value, profile.full_name), max) : null;
  const positions = (Array.isArray(profile.experiences) ? profile.experiences : []).flatMap(
    (entry) => {
      if (!entry || typeof entry !== "object") return [];
      const title = text(entry.title);
      const company = text(entry.company);
      if (!title && !company) return [];
      return [
        {
          title: title ?? "",
          company,
          start: clip(entry.start, CARD_DATE_MAX),
          end: clip(entry.end, CARD_DATE_MAX),
          ongoing: !ended(entry.end),
        },
      ];
    },
  );
  const currentIndex = positions.findIndex((position) => position.ongoing);
  const held = positions[currentIndex];
  const current: TriageCurrent | null = held
    ? { title: held.title, company: held.company, since: held.start }
    : null;
  const previous = positions
    .filter((_, index) => index !== currentIndex)
    .slice(0, CARD_PREVIOUS_MAX)
    .map((position) => ({
      title: position.title,
      company: position.company,
      from: position.start,
      to: position.end,
    }));
  const degree = (Array.isArray(profile.education) ? profile.education : []).find(
    (entry) => entry && typeof entry.degree === "string" && entry.degree.trim(),
  );
  const school = degree ? text(degree.school) : null;
  const education = degree
    ? text(school ? `${degree.degree.trim()} — ${school}` : degree.degree)
    : null;
  const skills: string[] = [];
  for (const skill of Array.isArray(profile.skills) ? profile.skills : []) {
    const value = text(skill);
    if (value && !skills.includes(value)) skills.push(value);
    if (skills.length >= CARD_SKILLS_MAX) break;
  }
  const years =
    typeof profile.years_experience === "number" && Number.isFinite(profile.years_experience)
      ? Math.max(0, Math.round(profile.years_experience * 10) / 10)
      : null;
  return {
    ref,
    headline: text(profile.headline),
    current,
    previous,
    years,
    education,
    skills,
  };
}

/** The cards of a batch, refs c1..cN in the order given. */
export function triageEntries(profiles: readonly TriageProfile[]): TriageEntry[] {
  return profiles.map((profile, index) => ({
    candidateId: profile.id,
    card: triageCard(profile, `c${index + 1}`),
  }));
}

// ---------------------------------------------------------------------
// what the triage reads about the job
// ---------------------------------------------------------------------

export interface TriageRoleBrief {
  /** The job as the team names it. */
  title: string;
  domain: string | null;
  seniority: RoleSeniority | null;
  equivalentTitles: string[];
  adjacentProfiles: string[];
  missions: string[];
  mustHaves: string[];
  /** The role criterion's definition, for a brief without a role profile. */
  definition: string | null;
}

/** The brief as the triage reads it: its title, its criteria (the search's), its role profile. */
export interface TriageBriefSource {
  title: string;
  criteria: readonly BriefCriterion[];
  role_profile: RoleProfile | null;
}

function clipList(list: readonly unknown[], max: number, length: number): string[] {
  const out: string[] = [];
  for (const item of list) {
    const value = clip(item, length);
    if (value && !out.includes(value)) out.push(value);
    if (out.length >= max) break;
  }
  return out;
}

function sameText(a: string, b: string): boolean {
  return foldTitle(a) === foldTitle(b);
}

/**
 * What the triage reads about the job: from the role profile when the
 * brief has one (the title, the domain, the level, the equivalent
 * titles, the adjacent profiles, six missions and six must-haves at
 * most), else from the role criterion (its label, its definition) and
 * the brief's title. The role criterion's label joins the equivalent
 * titles when it names the job otherwise than the profile does, so the
 * guard looks for both names.
 */
export function triageRoleBrief(brief: TriageBriefSource): TriageRoleBrief {
  const role = roleCriterion(brief.criteria);
  const roleLabel = clip(role?.label, ROLE_TEXT_MAX);
  const briefTitle = clip(brief.title, ROLE_TEXT_MAX);
  const profile = brief.role_profile;
  if (profile) {
    const title = clip(profile.title, ROLE_TEXT_MAX) ?? roleLabel ?? briefTitle ?? "";
    const equivalentTitles = clipList(profile.equivalentTitles, ROLE_LIST_MAX, ROLE_TEXT_MAX);
    if (
      roleLabel &&
      !sameText(roleLabel, title) &&
      !equivalentTitles.some((entry) => sameText(entry, roleLabel))
    )
      equivalentTitles.unshift(roleLabel);
    return {
      title,
      domain: clip(profile.domain, ROLE_TEXT_MAX),
      seniority: profile.seniority,
      equivalentTitles: equivalentTitles.slice(0, ROLE_LIST_MAX),
      adjacentProfiles: clipList(profile.adjacentProfiles, ROLE_LIST_MAX, ROLE_TEXT_MAX),
      missions: clipList(profile.missions, ROLE_MISSIONS_MAX, ROLE_TEXT_MAX),
      mustHaves: clipList(profile.mustHaves, ROLE_MUST_HAVES_MAX, ROLE_TEXT_MAX),
      definition: null,
    };
  }
  const title = roleLabel ?? briefTitle ?? "";
  const definition = clip(role?.value, ROLE_DEFINITION_MAX);
  return {
    title,
    domain: null,
    seniority: null,
    equivalentTitles: briefTitle && title && !sameText(briefTitle, title) ? [briefTitle] : [],
    adjacentProfiles: [],
    missions: [],
    mustHaves: [],
    definition: definition && !sameText(definition, title) ? definition : null,
  };
}

// ---------------------------------------------------------------------
// the prompt and the payload
// ---------------------------------------------------------------------

export function triageSystemPrompt(): string {
  return [
    "You are a senior recruitment consultant. Before anyone reads a CV in full, you sort a talent pool for ONE job, the way you would brief a sourcer: which profiles are worth reading for this job. The team reviews every reading; nothing you answer is applied by itself, and every profile you keep is read in full afterwards.",
    'Answer with JSON only: {"verdicts":[{"ref":"c1","verdict":"yes|close|no|unknown","reason":"..."}]}, exactly one entry per card, with its ref exactly as given.',
    "role is the job: title is the job as the team names it; domain, missions, equivalentTitles and mustHaves say what it is; adjacentProfiles are the neighbouring backgrounds the team would still read; definition, when present, is the team's own definition of the job.",
    "Each card is one profile: headline (how the person presents themselves), current (the position held today: title | company | since when), previous (earlier positions, newest first: title | company | period), years (total years of experience as stated), education (the first degree), skills (the first ones listed). A field the card leaves out is not stated, never a lack.",
    "Judge the job the person actually does or did: the missions, the context, the thread of the career. Never judge the wording of a title alone.",
    '- The same job carries different names across companies, countries and languages: "Business Developer", "Chargé d\'affaires", "Account Executive" and "Ingénieur commercial" can all be the same job. The equivalent titles are examples, not a closed list.',
    '- A shared word does not make the same job: "Business Developer" is not "Développeur mobile"; "Chef de projet IT" is not "Directeur de projets industriels".',
    '- "yes": the current position, or the main thread of the career, is this job or the same job under another name.',
    '- "close": an adjacent background listed in role.adjacentProfiles, this job held earlier in the career, or the same function in a neighbouring domain: a profile a senior recruiter would still read in full.',
    '- "no": another job.',
    '- "unknown": the card does not say enough to judge (no title, no position).',
    'Not judged here: the seniority, the years, the location, the languages, the availability, the nice-to-haves and the detail of the must-haves; later stages read the full profile for them. A junior or a very senior person who does this job is "yes".',
    'When you hesitate between "close" and "no", answer "close": a profile you keep is only read, one you drop is never seen.',
    "reason: at most 25 words, in the language of the brief (the language of role.title and role.missions), naming the title or the mission that decides; a fact, never an opinion, no markdown.",
    "Never use, infer or mention age, date of birth, gender, origin, nationality, ethnicity, family situation, pregnancy, health, disability, religion, union membership, political opinion, sexual orientation, appearance or any other protected characteristic; never a career break, a gap or a period without a position.",
  ].join("\n");
}

/** A card as the payload carries it: each position as one line, the empty fields left out. */
export interface TriageWireCard {
  ref: string;
  headline?: string;
  current?: string;
  previous?: string[];
  years?: number;
  education?: string;
  skills?: string;
}

export interface TriagePayload {
  role: TriageRoleBrief;
  cards: TriageWireCard[];
}

/** How much of a card a payload carries: the cards shrink one level at a time until the batch fits. */
interface CardLevel {
  text: number;
  previous: number;
  previousCompany: boolean;
  education: boolean;
  skills: number;
}

/**
 * The levels, richest first: the skills go first, then the degree, then
 * the earlier positions' companies, then the earlier positions; the
 * headline and the position held today stay to the last level, since
 * they decide the métier.
 */
const CARD_LEVELS: readonly CardLevel[] = [
  { text: 120, previous: 4, previousCompany: true, education: true, skills: 12 },
  { text: 100, previous: 4, previousCompany: true, education: true, skills: 6 },
  { text: 80, previous: 4, previousCompany: true, education: true, skills: 3 },
  { text: 80, previous: 4, previousCompany: true, education: false, skills: 0 },
  { text: 64, previous: 3, previousCompany: true, education: false, skills: 0 },
  { text: 56, previous: 3, previousCompany: false, education: false, skills: 0 },
  { text: 48, previous: 2, previousCompany: false, education: false, skills: 0 },
  { text: 40, previous: 1, previousCompany: false, education: false, skills: 0 },
  { text: 32, previous: 0, previousCompany: false, education: false, skills: 0 },
];

function cut(value: string | null, max: number): string | null {
  return value ? clip(value, max) : null;
}

function positionLine(parts: readonly (string | null)[]): string | null {
  const kept = parts.filter((part): part is string => Boolean(part));
  return kept.length ? kept.join(" | ") : null;
}

function period(from: string | null, to: string | null): string | null {
  if (!from && !to) return null;
  return `${from ?? "?"} - ${to ?? "?"}`;
}

function wireCard(card: TriageCard, level: CardLevel): TriageWireCard {
  const out: TriageWireCard = { ref: card.ref };
  const headline = cut(card.headline, level.text);
  if (headline) out.headline = headline;
  if (card.current) {
    const line = positionLine([
      cut(card.current.title, level.text),
      cut(card.current.company, level.text),
      card.current.since ? `since ${card.current.since}` : null,
    ]);
    if (line) out.current = line;
  }
  const previous = card.previous.slice(0, level.previous).flatMap((position) => {
    const line = positionLine([
      cut(position.title, level.text),
      level.previousCompany ? cut(position.company, level.text) : null,
      period(position.from, position.to),
    ]);
    return line ? [line] : [];
  });
  if (previous.length) out.previous = previous;
  if (card.years !== null) out.years = card.years;
  const education = level.education ? cut(card.education, level.text) : null;
  if (education) out.education = education;
  const skills = card.skills
    .slice(0, level.skills)
    .map((skill) => cut(skill, Math.min(level.text, 60)))
    .filter((skill): skill is string => Boolean(skill));
  if (skills.length) out.skills = skills.join(", ");
  return out;
}

/**
 * The user message of a triage call: the job, then the cards, at the
 * richest level whose JSON stays under TRIAGE_PAYLOAD_MAX characters
 * (the last level when none does). A level applies to the whole batch,
 * so every card of it is read alike.
 */
export function triagePayload(role: TriageRoleBrief, cards: readonly TriageCard[]): TriagePayload {
  let payload: TriagePayload = { role, cards: [] };
  for (const level of CARD_LEVELS) {
    payload = { role, cards: cards.map((card) => wireCard(card, level)) };
    if (JSON.stringify(payload).length <= TRIAGE_PAYLOAD_MAX) return payload;
  }
  return payload;
}

// ---------------------------------------------------------------------
// the rules on the answer
// ---------------------------------------------------------------------

/** The model's answer as the schema lets it through, before any rule applies. */
export interface ModelTriageAnswer {
  verdicts: { ref: string; verdict: string; reason?: string | null | undefined }[];
}

/** The verdict stored for one candidate. */
export interface TriageOutcome {
  verdict: TriageVerdict;
  /** Null when the model gave none, or when the filter withheld it. */
  reason: string | null;
  /** True when the guard turned a "no" into "close": the card carries the job's name. */
  guarded: boolean;
}

/** normalise() (accents, case, spaces), one apostrophe, hyphens and slashes as spaces: how the guard compares titles. */
function foldTitle(text: string | null | undefined): string {
  return normalise(text)
    .replace(/[’‘`´]/g, "'")
    .replace(/[-‐‑–—_/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The phrases the guard looks for: the job's title and its equivalent titles, normalised, two characters or more, each once. */
export function triageRoleTerms(
  role: Pick<TriageRoleBrief, "title" | "equivalentTitles">,
): string[] {
  const out: string[] = [];
  for (const title of [role.title, ...role.equivalentTitles]) {
    const term = foldTitle(title);
    if (term.length >= ROLE_TERM_MIN && !out.includes(term)) out.push(term);
  }
  return out;
}

/** True when the card's current title or its headline carries one of the terms as whole words. */
export function carriesRoleName(card: TriageCard, terms: readonly string[]): boolean {
  const texts = [card.current?.title, card.headline].map(foldTitle).filter(Boolean);
  return texts.some((text) => terms.some((term) => containsWord(text, term)));
}

function verdictOf(value: unknown): TriageVerdict {
  const folded = typeof value === "string" ? value.trim().toLowerCase() : "";
  return isTriageVerdict(folded) ? folded : "unknown";
}

function reasonOf(value: unknown): string | null {
  const reason = clip(value, TRIAGE_REASON_MAX);
  return reason && !forbiddenSentence(reason) ? reason : null;
}

/**
 * The verdicts stored, by candidate id, one per card: a verdict outside
 * the four reads "unknown"; a card the model did not answer is
 * "unknown" with no reason (it is read in full rather than dropped:
 * silence is never a lack); a ref answered twice keeps its first
 * answer; a ref no card carries is ignored; a reason is trimmed,
 * clipped to TRIAGE_REASON_MAX and withheld (null) when it names a
 * protected characteristic or a period without a position (the
 * assessment's filter); a "no" on a card whose current title or
 * headline carries the job's name (triageRoleTerms) becomes "close",
 * marked guarded, so a lazy answer never drops a profile that carries
 * the job's name: the full reading decides.
 */
export function enforceTriage(
  entries: readonly TriageEntry[],
  answer: ModelTriageAnswer,
  roleTerms: readonly string[],
): Map<string, TriageOutcome> {
  const byRef = new Map(entries.map((entry) => [entry.card.ref, entry] as const));
  const answered = new Map<string, TriageOutcome>();
  for (const item of Array.isArray(answer.verdicts) ? answer.verdicts : []) {
    if (!item || typeof item.ref !== "string") continue;
    const entry = byRef.get(item.ref.trim());
    if (!entry || answered.has(entry.candidateId)) continue;
    let verdict = verdictOf(item.verdict);
    let guarded = false;
    if (verdict === "no" && carriesRoleName(entry.card, roleTerms)) {
      verdict = "close";
      guarded = true;
    }
    answered.set(entry.candidateId, { verdict, reason: reasonOf(item.reason), guarded });
  }
  const out = new Map<string, TriageOutcome>();
  for (const entry of entries) {
    out.set(
      entry.candidateId,
      answered.get(entry.candidateId) ?? { verdict: "unknown", reason: null, guarded: false },
    );
  }
  return out;
}

/** How many of each verdict a set of outcomes holds, and how many the guard kept. */
export function countTriage(
  outcomes: Iterable<TriageOutcome>,
): Record<TriageVerdict, number> & { guarded: number } {
  const counts = { yes: 0, close: 0, no: 0, unknown: 0, guarded: 0 };
  for (const outcome of outcomes) {
    counts[outcome.verdict] += 1;
    if (outcome.guarded) counts.guarded += 1;
  }
  return counts;
}

// ---------------------------------------------------------------------
// the order of what the triage kept
// ---------------------------------------------------------------------

const VERDICT_RANK: Record<TriageVerdict, number> = { yes: 0, close: 1, unknown: 2, no: 3 };

/** A result without a triage (an older search) sits with the unknown ones. */
function verdictRank(result: Pick<MatchResult, "triage">): number {
  return result.triage ? VERDICT_RANK[result.triage.verdict] : VERDICT_RANK.unknown;
}

/** Yes before close before unknown, then the deterministic pass (not blocked, score, coverage). */
export function triageOrder(a: MatchResult, b: MatchResult): number {
  const byVerdict = verdictRank(a) - verdictRank(b);
  return byVerdict !== 0 ? byVerdict : compareResults(a, b);
}
