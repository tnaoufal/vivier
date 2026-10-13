/**
 * What leaves for the model and the database, built here so it can be
 * read and tested without either: the brief as one query text (stored
 * with the search and embedded), the full-text terms the search
 * function gets, the two system prompts (criteria extraction, the expert
 * assessment of one candidate against one brief), and the payload of an
 * assessment request (the guard against a criterion about a protected
 * characteristic is criteria.ts's). Prompts are in English; the model answers
 * in the brief's language. A payload never carries a name, an email or
 * a phone number: the model reads a profile, not a person. The name is
 * read for that very reason, so redactIdentity() can take it out of
 * every text (the CV's indexed text starts with it), along with e-mail
 * addresses and phone numbers.
 */
import type { BriefRow, CandidateRow } from "@/lib/db/types";

import { escapeRegExp, normalise, type MatchProfile } from "./matching";

export type BriefText = Pick<BriefRow, "title" | "description" | "criteria">;

/**
 * Up to this many active candidates the search takes the whole pool, so
 * no profile is left out by the retrieval; above it the hybrid retrieval
 * answers RETRIEVAL_LIMIT rows and the assessment reads those.
 */
export const FULL_POOL_MAX = 200;
/** The most rows the retrieval answers; scoring runs on all of them. */
export const RETRIEVAL_LIMIT = 120;
/** The most criteria an extraction proposes. */
export const EXTRACTION_MAX = 12;

export const QUERY_TEXT_MAX = 6000;
export const TEXT_QUERY_MAX_TERMS = 48;
/** The whole assessment payload stays under about this many characters: the CV text is clipped to what is left. */
export const ASSESSMENT_PAYLOAD_MAX = 9000;
const ASSESSMENT_DESCRIPTION_MAX = 4000;
const ASSESSMENT_EXPERIENCES_MAX = 12;
const ASSESSMENT_EXPERIENCE_TEXT_MAX = 500;
const SUMMARY_MAX = 600;

/** Title, description, then each criterion's label and value, each once, one per line. */
export function queryTextOf(brief: BriefText): string {
  const parts: string[] = [];
  const push = (value: string | null | undefined) => {
    const trimmed = value?.trim();
    if (trimmed && !parts.includes(trimmed)) parts.push(trimmed);
  };
  push(brief.title);
  push(brief.description);
  for (const criterion of brief.criteria ?? []) {
    push(criterion.label);
    push(criterion.value);
  }
  return parts.join("\n").slice(0, QUERY_TEXT_MAX);
}

/** Function words and job-ad boilerplate: present in every brief and in most CVs, they only add noise. */
const STOP_WORDS = new Set<string>([
  // fr
  "les", "des", "une", "pour", "avec", "dans", "sur", "par", "est", "son", "ses", "sa", "qui", "que", "quoi",
  "pas", "plus", "nous", "vous", "notre", "votre", "vos", "nos", "aux", "chez", "sous", "entre", "ans",
  "ainsi", "afin", "dont", "cette", "ces", "cet", "leur", "leurs", "elle", "ils", "elles", "sont", "etre",
  "avoir", "fait", "faire", "tout", "tous", "toute", "toutes", "comme", "aussi", "tres", "bien", "sans",
  "mais", "donc", "car", "via", "puis", "encore", "deja", "poste", "profil", "mission", "missions",
  "recherche", "recherchons", "cherchons", "cherche", "candidat", "candidate", "candidats", "candidates",
  "equipe", "entreprise", "societe", "groupe", "annee", "annees", "minimum", "souhaite", "souhaitee",
  "idealement", "imperatif", "imperativement", "obligatoire", "indispensable", "requis", "requise",
  "niveau", "bonne", "bonnes", "bon", "bons", "connaissance", "connaissances", "competence", "competences",
  "maitrise", "capacite", "capacites", "experience", "experiences", "experimente", "experimentee",
  // en
  "the", "and", "for", "with", "from", "that", "this", "our", "your", "you", "are", "has", "have", "will",
  "who", "what", "not", "but", "all", "any", "can", "years", "year", "etc", "within", "also", "very",
  "well", "must", "should", "would", "able", "strong", "good", "required", "preferred", "ideally",
  "least", "position", "role", "looking", "seeking", "join", "team", "company", "candidate", "candidates",
  "skills", "skill", "knowledge", "level", "plus", "proven", "track", "record", "ability", "excellent",
]);

/**
 * The terms the full-text search gets, joined with OR so a long brief
 * ranks by how many of its words a CV holds instead of demanding every
 * one of them: criteria first (values, then labels), then the title,
 * then the description; normalised, three letters at least, no stop
 * word, each once, `maxTerms` at most.
 */
export function textQueryOf(brief: BriefText, maxTerms = TEXT_QUERY_MAX_TERMS): string {
  const ordered = [
    ...(brief.criteria ?? []).map((criterion) => criterion.value),
    ...(brief.criteria ?? []).map((criterion) => criterion.label),
    brief.title,
    brief.description,
  ];
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const part of ordered) {
    for (const token of normalise(part).split(/[^\p{L}\p{N}]+/u)) {
      if (token.length < 3 || STOP_WORDS.has(token) || seen.has(token)) continue;
      seen.add(token);
      terms.push(token);
      if (terms.length >= maxTerms) return terms.join(" OR ");
    }
  }
  return terms.join(" OR ");
}

// ---------------------------------------------------------------------
// criteria extraction
// ---------------------------------------------------------------------

export function extractionSystemPrompt(): string {
  return [
    "You extract hiring criteria from a job brief for an HR team. The team reviews every proposal; nothing you answer is applied by itself.",
    'Answer with JSON only: {"criteria":[{"kind":"skill|experience|language|location|education|availability|other","label":"...","value":"...","required":true,"weight":2}],"warnings":["..."]}.',
    "Rules:",
    `- At most ${EXTRACTION_MAX} criteria, the most useful first, one criterion per requirement, nothing the brief does not say.`,
    '- kind: "skill" for a tool, technique, method or domain; "experience" for years of experience (value is the number of years alone, e.g. "5"); "language" for a spoken language (value is the language with its level when stated, e.g. "anglais C1", "english fluent"); "location" for a city, region or country (value is the place alone); "education" for a degree or a school; "availability" for a start date or notice period; "other" for anything else.',
    '- label: short, in the language of the brief, as it reads on a chip (e.g. "Anglais courant", "5 ans en contrôle de gestion"). value: the thing to find in a profile, lowercase, no filler words.',
    "- required: true only when the brief states the requirement as mandatory (must, required, mandatory, obligatoire, impératif, indispensable, exigé). Otherwise false.",
    "- weight: 3 for what the brief insists on, 2 for what it asks for, 1 for what it only welcomes (a plus, apprécié, idéalement, nice to have).",
    "- Never produce a criterion about age, date of birth, gender, origin, nationality, ethnicity, family situation, pregnancy, health, disability, religion, union membership, political opinion, sexual orientation, appearance or any other protected characteristic, even when the brief asks for it: drop it and add one sentence to warnings naming the dropped request, in the language of the brief.",
    "- warnings is [] when nothing was dropped.",
  ].join("\n");
}

export function extractionUserPrompt(brief: Pick<BriefRow, "title" | "description">): string {
  const description = brief.description.trim().slice(0, 12000);
  return `Title: ${brief.title.trim()}\n\nBrief:\n${description || "(no description)"}`;
}

// ---------------------------------------------------------------------
// the expert assessment of one candidate against one brief
// ---------------------------------------------------------------------

/**
 * The columns the assessment reads: the matching's, the dated
 * experiences, and the name, which never leaves: the payload strips it
 * out of every text it sends.
 */
export type AssessmentProfile = MatchProfile & Pick<CandidateRow, "experiences" | "full_name">;

export interface AssessmentRequirement {
  id: string;
  label: string;
  value: string;
  required: boolean;
  weight: number;
}

export interface AssessmentExperience {
  title: string;
  company: string | null;
  start: string | null;
  end: string | null;
  description: string | null;
}

export interface AssessmentPayload {
  brief: {
    title: string;
    description: string;
    requirements: AssessmentRequirement[];
  };
  candidate: {
    headline: string | null;
    summary: string | null;
    skills: string[];
    languages: string[];
    location: string | null;
    yearsExperience: number | null;
    availability: string | null;
    experiences: AssessmentExperience[];
    education: string[];
    /** The CV's text as indexed, clipped to what the budget leaves; null when nothing is left. */
    extra: string | null;
  };
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

// ---------------------------------------------------------------------
// what never leaves: the name, the e-mail, the phone
// ---------------------------------------------------------------------

const EMAIL_PATTERN = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.\p{L}{2,}/gu;
/** A run of digits with the separators phone numbers are written with, eight characters at least. */
const DIGIT_RUN = /\+?\d[\d .()-]{6,}\d/g;
const YEAR_GROUP = /(?<!\d)(?:19|20)\d{2}(?!\d)/;

/**
 * True for a digit run that reads as a phone number: 8 to 15 digits once
 * the separators are gone, and no group that is a year, since a date
 * range ("2019-2021", "2019-01 - 2021-06") stays for the model to read
 * seniority from. A long figure written with spaces may go with the
 * phones; the structured fields are untouched by this.
 */
function isPhone(run: string): boolean {
  const digits = run.replace(/\D/g, "").length;
  return digits >= 8 && digits <= 15 && !YEAR_GROUP.test(run);
}

/** The parts as whole words, in this order, with spaces or hyphens between them, whatever the case. */
function wordPattern(parts: readonly string[]): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}])${parts.map(escapeRegExp).join("[\\s-]+")}(?![\\p{L}\\p{N}])`, "giu");
}

/**
 * The patterns a name is removed with: the whole name in the order given
 * and reversed, then each word and each hyphen-joined part of three
 * letters or more on its own (a summary may call the person by their
 * first name). A part that is also a word or a place disappears from
 * the text with it; the structured fields keep what they hold.
 */
function namePatterns(fullName: string | null | undefined): RegExp[] {
  const words = (fullName ?? "").trim().split(/\s+/u).filter((word) => word.length > 0);
  const parts = words.flatMap((word) => word.split("-")).filter((part) => part.length > 0);
  if (!parts.length) return [];
  const patterns = [wordPattern(parts)];
  if (parts.length > 1) patterns.push(wordPattern([...parts].reverse()));
  for (const piece of Array.from(new Set([...words, ...parts]))) {
    if (piece.length >= 3) patterns.push(wordPattern([piece]));
  }
  return patterns;
}

/**
 * The text with the person's identity taken out: e-mail addresses and
 * phone numbers first, then every occurrence of the name, whatever its
 * case; the whitespace left behind is collapsed. Every free text of a
 * payload goes through here, the CV's indexed text included, since the
 * processor writes the name on its first line.
 */
export function redactIdentity(text: string, fullName: string | null | undefined): string {
  let out = text.replace(EMAIL_PATTERN, " ").replace(DIGIT_RUN, (run) => (isPhone(run) ? " " : run));
  for (const pattern of namePatterns(fullName)) out = out.replace(pattern, " ");
  return out
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

/** A text field of the payload: redacted, then trimmed and clipped (null when nothing is left). */
type CleanText = (value: unknown, max: number) => string | null;

function experiencesOf(profile: AssessmentProfile, clean: CleanText): AssessmentExperience[] {
  const entries = Array.isArray(profile.experiences) ? profile.experiences : [];
  const out: AssessmentExperience[] = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const title = clean(entry.title, 160);
    const company = clean(entry.company, 120);
    if (!title && !company) continue;
    out.push({
      title: title ?? "",
      company,
      start: text(entry.start, 20),
      end: text(entry.end, 20),
      description: clean(entry.description, ASSESSMENT_EXPERIENCE_TEXT_MAX),
    });
    if (out.length >= ASSESSMENT_EXPERIENCES_MAX) break;
  }
  return out;
}

/**
 * The user message of an assessment request: the brief with its
 * requirements, and the candidate's structured profile (no name, no
 * contact details) followed by the CV's text clipped so the whole
 * payload stays under ASSESSMENT_PAYLOAD_MAX characters. The structured
 * fields come first because they are what the processor read with
 * confidence; the text lets the model check dates and wording. Every
 * free text is redacted before it is clipped, so a name cut in half
 * never survives at the edge of a clip.
 */
export function assessmentPayload(brief: BriefText, profile: AssessmentProfile): AssessmentPayload {
  const clean: CleanText = (value, max) =>
    typeof value === "string" ? text(redactIdentity(value, profile.full_name), max) : null;
  const payload: AssessmentPayload = {
    brief: {
      title: brief.title.trim().slice(0, 200),
      description: brief.description.trim().slice(0, ASSESSMENT_DESCRIPTION_MAX),
      requirements: (brief.criteria ?? []).map((criterion) => ({
        id: criterion.id,
        label: criterion.label,
        value: criterion.value,
        required: criterion.required,
        weight: criterion.weight,
      })),
    },
    candidate: {
      headline: clean(profile.headline, 200),
      summary: clean(profile.summary, SUMMARY_MAX),
      skills: (Array.isArray(profile.skills) ? profile.skills : [])
        .filter((skill): skill is string => typeof skill === "string" && skill.trim().length > 0)
        .slice(0, 40)
        .map((skill) => skill.trim().slice(0, 60)),
      languages: (Array.isArray(profile.languages) ? profile.languages : [])
        .filter((language) => language && typeof language.name === "string" && language.name.trim())
        .slice(0, 10)
        .map((language) => (language.level ? `${language.name.trim()} (${language.level})` : language.name.trim())),
      location: text(profile.location, 120),
      yearsExperience: typeof profile.years_experience === "number" ? profile.years_experience : null,
      availability: text(profile.availability, 120),
      experiences: experiencesOf(profile, clean),
      education: (Array.isArray(profile.education) ? profile.education : [])
        .filter((entry) => entry && typeof entry.degree === "string" && entry.degree.trim())
        .slice(0, 5)
        .map((entry) => (entry.school ? `${entry.degree.trim()} — ${entry.school}` : entry.degree.trim())),
      extra: null,
    },
  };
  const left = ASSESSMENT_PAYLOAD_MAX - JSON.stringify(payload).length;
  const extra = clean(profile.search_text, Math.max(0, left));
  payload.candidate.extra = left > 0 && extra ? extra : null;
  return payload;
}

export function assessmentSystemPrompt(): string {
  return [
    "You are a senior recruitment consultant in the field of the job brief. You assess ONE candidate profile against ONE brief for a hiring team, the way you would before presenting the candidate to a client. The team reviews your reading and decides; nothing you answer is applied by itself.",
    'Answer with JSON only: {"requirements":[{"criterionId":"...","met":"yes|partial|no|unknown","evidence":"..."}],"decision":"fit|borderline|no_fit","score":0,"summary":"..."}.',
    "Rules for requirements: one entry per requirement given, with its id exactly as given.",
    '- met: "yes" when the profile clearly satisfies it; "partial" when it satisfies it in part (a lower level, fewer years, a neighbouring skill); "no" when the profile clearly does not satisfy it; "unknown" when the profile says nothing about it. Silence is never a lack: a requirement the CV does not mention is "unknown", not "no".',
    '- evidence: a short quote or fact taken from the profile, at most 200 characters, never invented, never paraphrased into something the profile does not say. Empty when met is "unknown".',
    "- Be strict on required requirements: when the profile clearly does not meet a required requirement, answer \"no\", whatever the rest of the profile.",
    "- Seniority and years of experience are judged from the dated experiences when the CV states them (add up the relevant periods); the stated total is a hint, not a proof.",
    "- Judge the field of experience, not only the words: a title in another industry or another role does not meet a requirement about this one.",
    'Rules for decision: "fit" when every required requirement is met and you would present the profile to the client as it is; "borderline" when it deserves a human look (a required requirement unknown, or important optional ones missing); "no_fit" when a required requirement is not met or the profile is clearly off the brief.',
    "Rules for score: 0 to 100, the overall fit of the profile to the brief, required requirements weighing most, then the weights given.",
    "Rules for summary: two to four factual sentences in the language of the brief, for a hiring manager: what matches, what is missing, what the CV does not say. No praise, no advice, no ranking, no recommendation to hire or reject, no bullet points, no markdown.",
    "Never mention, infer or use age, date of birth, gender, origin, nationality, ethnicity, family situation, pregnancy, health, disability, religion, union membership, political opinion, sexual orientation, appearance or any other protected characteristic, even when the brief or the profile mentions one.",
  ].join("\n");
}
