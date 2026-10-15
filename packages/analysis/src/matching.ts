/**
 * Explained matching: one verdict per criterion of a brief against a
 * structured profile, a score over what could be evaluated, and the
 * ranking of a search's results. Pure: no model, no data access; every
 * rule is stated here once and tested in matching.test.ts (the profile
 * shape it reads, MatchProfile, is in types.ts). A criterion
 * the profile says nothing about is "not_stated" and never counts
 * against the person; a verdict of "missing" is given only when the CV
 * contradicts the requirement and always carries the evidence it rests
 * on (the languages or degrees listed, the years, the place). The role
 * (the job itself) is only ever found here, in a title that carries the
 * words of the job's name: a different title is no proof of a different
 * métier, since every company names a job differently; the model judges
 * what the person did.
 */
import type {
  BriefCriterion,
  CriterionResult,
  CriterionVerdict,
  MatchProfile,
  MatchResult,
} from "./types.js";

export type { MatchProfile } from "./types.js";

export interface Retrieval {
  textRank: number | null;
  vectorRank: number | null;
}

/** NFD, diacritics stripped, lowercase, one space between words. */
export function normalise(text: string | null | undefined): string {
  if (typeof text !== "string" || !text) return "";
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** True when `needle` sits in `haystack` as whole words (no letter or digit touching it). */
export function containsWord(haystack: string, needle: string): boolean {
  if (!haystack || !needle) return false;
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(needle)}(?![\\p{L}\\p{N}])`, "u");
  return pattern.test(haystack);
}

/** Up to `around` characters on each side of a match, with ellipses where the text goes on. */
export function snippet(text: string, index: number, length: number, around = 40): string {
  const start = Math.max(0, index - around);
  const end = Math.min(text.length, index + length + around);
  return `${start > 0 ? "…" : ""}${text.slice(start, end).trim()}${end < text.length ? "…" : ""}`;
}

/** The first number in a text ("5 ans" → 5, "3,5" → 3.5), null when none. */
export function firstNumber(text: string): number | null {
  const match = /(\d+(?:[.,]\d+)?)/.exec(text);
  if (!match?.[1]) return null;
  const value = Number.parseFloat(match[1].replace(",", "."));
  return Number.isFinite(value) ? value : null;
}

// ---------------------------------------------------------------------
// languages
// ---------------------------------------------------------------------

/** A1 < A2 < B1 < B2 < C1 < C2 as 1..6. */
const CEFR_RANK: Record<string, number> = { a1: 1, a2: 2, b1: 3, b2: 4, c1: 5, c2: 6 };

const LEVEL_WORDS: readonly { rank: number; pattern: RegExp }[] = [
  { rank: 6, pattern: /\b(bilingue|bilingual|natif|native|maternel|maternelle|mother tongue)\b/ },
  { rank: 5, pattern: /\b(avance|advanced)\b/ },
  {
    rank: 4,
    pattern:
      /\b(courant|courante|fluent|fluently|professionnel|professionnelle|professional|business)\b/,
  },
  { rank: 3, pattern: /\b(intermediaire|intermediate)\b/ },
  {
    rank: 2,
    pattern:
      /\b(notions|basique|basic|beginner|debutant|debutante|scolaire|elementary|elementaire)\b/,
  },
];

/**
 * The level a text states, as a rank 1..6: a CEFR letter first (B2, C1,
 * "b 2"), else a word ("courant"/"fluent" = B2, "bilingue"/"native" =
 * C2, and the usual words in between). Null when nothing says a level.
 */
export function levelRank(text: string | null | undefined): number | null {
  const n = normalise(text);
  if (!n) return null;
  const cefr = /(?<![\p{L}\p{N}])([abc])\s?([12])(?![\p{L}\p{N}])/u.exec(n);
  if (cefr?.[1] && cefr[2]) return CEFR_RANK[`${cefr[1]}${cefr[2]}`] ?? null;
  for (const word of LEVEL_WORDS) if (word.pattern.test(n)) return word.rank;
  return null;
}

const LANGUAGE_ALIASES: Record<string, readonly string[]> = {
  english: ["english", "anglais", "ingles", "inglese", "englisch"],
  french: ["french", "francais", "frances", "francese", "franzosisch"],
  spanish: ["spanish", "espagnol", "espanol", "castellano", "castillan"],
  german: ["german", "allemand", "deutsch", "aleman"],
  italian: ["italian", "italien", "italiano"],
  portuguese: ["portuguese", "portugais", "portugues"],
  dutch: ["dutch", "neerlandais", "nederlands", "hollandais"],
  chinese: ["chinese", "chinois", "mandarin", "cantonais", "cantonese"],
  arabic: ["arabic", "arabe"],
  russian: ["russian", "russe"],
  japanese: ["japanese", "japonais"],
  polish: ["polish", "polonais"],
  turkish: ["turkish", "turc"],
};

/** "anglais", "English", "inglés" → "english"; null for a language the table does not know. */
export function languageKey(text: string | null | undefined): string | null {
  const n = normalise(text);
  if (!n) return null;
  for (const [key, aliases] of Object.entries(LANGUAGE_ALIASES)) {
    if (aliases.some((alias) => containsWord(n, alias))) return key;
  }
  return null;
}

/** True when a criterion's value names the same language as a profile entry (aliases first, then containment). */
export function sameLanguage(value: string, name: string): boolean {
  const a = languageKey(value);
  const b = languageKey(name);
  if (a && b) return a === b;
  const nv = normalise(value);
  const nn = normalise(name);
  if (nn.length < 2 || nv.length < 2) return false;
  return nv.includes(nn) || nn.includes(nv);
}

// ---------------------------------------------------------------------
// one criterion
// ---------------------------------------------------------------------

function result(
  criterion: BriefCriterion,
  verdict: CriterionVerdict,
  evidence: string | null,
): CriterionResult {
  return { criterionId: criterion.id, verdict, evidence: evidence ? evidence.slice(0, 200) : null };
}

function cleanStrings(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return values
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => value.trim());
}

function words(value: string): string[] {
  return value.split(" ").filter((word) => word.length >= 2);
}

function evaluateSkill(criterion: BriefCriterion, profile: MatchProfile): CriterionResult {
  const value = normalise(criterion.value);
  const skills = cleanStrings(profile.skills);
  const text = normalise(profile.search_text);
  if (!skills.length && !text) return result(criterion, "not_stated", null);
  if (!value) return result(criterion, "not_stated", null);
  for (const skill of skills) {
    if (normalise(skill).includes(value)) return result(criterion, "match", skill);
  }
  if (text) {
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(value)}(?![\\p{L}\\p{N}])`, "u");
    const found = pattern.exec(text);
    if (found) return result(criterion, "match", snippet(text, found.index, value.length));
  }
  const parts = words(value);
  if (parts.length >= 2) {
    const haystack = `${skills.map(normalise).join(" ")} ${text}`;
    const present = parts.filter((word) => containsWord(haystack, word));
    if (present.length * 2 >= parts.length) return result(criterion, "partial", present.join(", "));
  }
  // A skill the CV does not name is not a skill the person lacks: a CV
  // lists what it chooses to, and the text may be clipped.
  return result(criterion, "not_stated", null);
}

/** "Anglais (C1)", or "Anglais" when no level is stated. */
function languageText(language: { name: string; level: string | null }): string {
  const level =
    typeof language.level === "string" && language.level.trim() ? language.level.trim() : null;
  return level ? `${language.name.trim()} (${level})` : language.name.trim();
}

function evaluateLanguage(criterion: BriefCriterion, profile: MatchProfile): CriterionResult {
  const languages = (Array.isArray(profile.languages) ? profile.languages : []).filter(
    (language) => language && typeof language.name === "string" && language.name.trim().length > 0,
  );
  if (!languages.length) return result(criterion, "not_stated", null);
  const found = languages.find((language) => sameLanguage(criterion.value, language.name));
  // The languages the CV does list are the evidence of the absence: the
  // assessment shows them next to a model "yes" so the two readings can be told apart.
  if (!found) return result(criterion, "missing", languages.map(languageText).join(", "));
  const evidence = languageText(found);
  const needed = levelRank(criterion.value) ?? levelRank(criterion.label);
  if (needed === null) return result(criterion, "match", evidence);
  const has = levelRank(found.level);
  if (has !== null && has >= needed) return result(criterion, "match", evidence);
  return result(criterion, "partial", evidence);
}

function evaluateLocation(criterion: BriefCriterion, profile: MatchProfile): CriterionResult {
  const location = normalise(profile.location);
  if (!location) return result(criterion, "not_stated", null);
  const value = normalise(criterion.value);
  if (!value) return result(criterion, "not_stated", null);
  if (location.includes(value) || (location.length >= 2 && value.includes(location))) {
    return result(criterion, "match", profile.location);
  }
  return result(criterion, "missing", profile.location);
}

function yearsOf(profile: MatchProfile): number | null {
  const raw: unknown = profile.years_experience;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw === "string" && raw.trim()) return firstNumber(raw);
  return null;
}

function evaluateExperience(criterion: BriefCriterion, profile: MatchProfile): CriterionResult {
  const needed = firstNumber(criterion.value) ?? firstNumber(criterion.label);
  // No number to compare with: judged as free text, which can only be found, never absent.
  if (needed === null) return evaluateOther(criterion, profile);
  const years = yearsOf(profile);
  if (years === null) return result(criterion, "not_stated", null);
  const evidence = String(years);
  if (years >= needed) return result(criterion, "match", evidence);
  if (years >= needed - 1) return result(criterion, "partial", evidence);
  return result(criterion, "missing", evidence);
}

function evaluateEducation(criterion: BriefCriterion, profile: MatchProfile): CriterionResult {
  const entries = (Array.isArray(profile.education) ? profile.education : []).filter(
    (entry) => entry && (typeof entry.degree === "string" || typeof entry.school === "string"),
  );
  if (!entries.length) return result(criterion, "not_stated", null);
  const value = normalise(criterion.value);
  if (!value) return result(criterion, "not_stated", null);
  const parts = words(value);
  let partial: string | null = null;
  const listed: string[] = [];
  for (const entry of entries) {
    const degree = typeof entry.degree === "string" ? entry.degree.trim() : "";
    const school = typeof entry.school === "string" ? entry.school.trim() : "";
    const evidence = [degree, school].filter(Boolean).join(", ");
    const text = normalise(evidence);
    if (!text) continue;
    listed.push(evidence);
    if (text.includes(value)) return result(criterion, "match", evidence);
    if (parts.length >= 2) {
      const present = parts.filter((word) => containsWord(text, word));
      if (present.length === parts.length) return result(criterion, "match", evidence);
      if (partial === null && present.length * 2 >= parts.length) partial = evidence;
    }
  }
  if (partial) return result(criterion, "partial", partial);
  if (!listed.length) return result(criterion, "not_stated", null);
  // The degrees the CV does list are the evidence of the absence, as the languages are.
  return result(criterion, "missing", listed.join("; "));
}

function evaluateAvailability(criterion: BriefCriterion, profile: MatchProfile): CriterionResult {
  const availability = normalise(profile.availability);
  if (!availability) return result(criterion, "not_stated", null);
  const value = normalise(criterion.value);
  if (!value) return result(criterion, "not_stated", null);
  if (availability.includes(value)) return result(criterion, "match", profile.availability);
  return result(criterion, "missing", profile.availability);
}

function evaluateOther(criterion: BriefCriterion, profile: MatchProfile): CriterionResult {
  const text = normalise(profile.search_text);
  const value = normalise(criterion.value);
  if (!text || !value) return result(criterion, "not_stated", null);
  const index = text.indexOf(value);
  if (index >= 0) return result(criterion, "match", snippet(text, index, value.length));
  // A free criterion cannot be judged absent from a CV.
  return result(criterion, "not_stated", null);
}

/** Words a job's name carries that say nothing of the job: "chef de projet" is found by "chef" and "projet". */
const ROLE_STOP_WORDS = new Set<string>([
  "des",
  "les",
  "pour",
  "and",
  "the",
  "for",
  "with",
  "avec",
  "sur",
  "senior",
  "junior",
  "confirme",
]);

/** The words of a job's name worth finding in a title: three letters at least, no function word, each once. */
export function roleWords(label: string): string[] {
  const out: string[] = [];
  for (const token of normalise(label).split(/[^\p{L}\p{N}]+/u)) {
    if (token.length < 3 || ROLE_STOP_WORDS.has(token) || out.includes(token)) continue;
    out.push(token);
  }
  return out;
}

/** The headline and the titles of the experiences, as written, blank ones left out. */
function titlesOf(profile: MatchProfile): string[] {
  const titles: string[] = [];
  if (typeof profile.headline === "string" && profile.headline.trim())
    titles.push(profile.headline.trim());
  for (const entry of Array.isArray(profile.experiences) ? profile.experiences : []) {
    if (entry && typeof entry.title === "string" && entry.title.trim())
      titles.push(entry.title.trim());
  }
  return titles;
}

/**
 * The role, read from the titles alone: the words of the job's name
 * (the label; the definition's equivalent titles are free text and are
 * not parsed) against the headline and the title of each experience.
 * Every word in one title is a match with that title as evidence; half
 * of them, a partial with the closest title; otherwise not stated,
 * never missing: a title that reads differently is no proof of another
 * métier, and the model judges what the person actually did.
 */
function evaluateRole(criterion: BriefCriterion, profile: MatchProfile): CriterionResult {
  const wanted = roleWords(criterion.label);
  const titles = titlesOf(profile);
  if (!wanted.length || !titles.length) return result(criterion, "not_stated", null);
  let closest: { title: string; present: number } | null = null;
  for (const title of titles) {
    const haystack = normalise(title);
    const present = wanted.filter((word) => containsWord(haystack, word)).length;
    if (present === wanted.length) return result(criterion, "match", title);
    if (!closest || present > closest.present) closest = { title, present };
  }
  if (closest && closest.present * 2 >= wanted.length)
    return result(criterion, "partial", closest.title);
  return result(criterion, "not_stated", null);
}

/** What one criterion says about one profile, with the evidence it rests on. */
export function evaluateCriterion(
  criterion: BriefCriterion,
  profile: MatchProfile,
): CriterionResult {
  switch (criterion.kind) {
    case "role":
      return evaluateRole(criterion, profile);
    case "skill":
      return evaluateSkill(criterion, profile);
    case "language":
      return evaluateLanguage(criterion, profile);
    case "location":
      return evaluateLocation(criterion, profile);
    case "experience":
      return evaluateExperience(criterion, profile);
    case "education":
      return evaluateEducation(criterion, profile);
    case "availability":
      return evaluateAvailability(criterion, profile);
    case "other":
      return evaluateOther(criterion, profile);
    default:
      return result(criterion, "not_stated", null);
  }
}

// ---------------------------------------------------------------------
// one candidate, one search
// ---------------------------------------------------------------------

export const POINTS: Record<CriterionVerdict, number> = {
  match: 1,
  partial: 0.5,
  missing: 0,
  not_stated: 0,
};

/**
 * The explained match of one profile: verdicts for every criterion, a
 * score of 0..100 over the criteria that could be evaluated (weighted),
 * the coverage (how many could be), and whether a required criterion is
 * missing. `why` stays null here: only a model writes it.
 */
export function scoreCandidate(
  criteria: readonly BriefCriterion[],
  profile: MatchProfile,
  retrieval: Retrieval,
): MatchResult {
  const verdicts: CriterionResult[] = [];
  let weightSum = 0;
  let pointSum = 0;
  let evaluable = 0;
  let blocked = false;
  for (const criterion of criteria) {
    const verdict = evaluateCriterion(criterion, profile);
    verdicts.push(verdict);
    if (verdict.verdict === "not_stated") continue;
    evaluable += 1;
    weightSum += criterion.weight;
    pointSum += criterion.weight * POINTS[verdict.verdict];
    if (criterion.required && verdict.verdict === "missing") blocked = true;
  }
  return {
    candidateId: profile.id,
    score: weightSum > 0 ? Math.round((100 * pointSum) / weightSum) : 0,
    coverage: criteria.length ? evaluable / criteria.length : 1,
    blocked,
    verdicts,
    why: null,
    retrieval: { textRank: retrieval.textRank, vectorRank: retrieval.vectorRank },
  };
}

function compareRank(a: number | null, b: number | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a - b;
}

/** Not blocked first, then score, then coverage, then retrieval order (text rank, then vector rank). */
export function compareResults(a: MatchResult, b: MatchResult): number {
  if (a.blocked !== b.blocked) return a.blocked ? 1 : -1;
  if (a.score !== b.score) return b.score - a.score;
  if (a.coverage !== b.coverage) return b.coverage - a.coverage;
  const byText = compareRank(a.retrieval.textRank, b.retrieval.textRank);
  if (byText !== 0) return byText;
  return compareRank(a.retrieval.vectorRank, b.retrieval.vectorRank);
}

export function rankResults(results: readonly MatchResult[]): MatchResult[] {
  return [...results].sort(compareResults);
}

/** How many verdicts could be evaluated, for "4 criteria out of 5 evaluated". */
export function evaluatedCount(verdicts: readonly CriterionResult[]): number {
  return verdicts.filter((verdict) => verdict.verdict !== "not_stated").length;
}
