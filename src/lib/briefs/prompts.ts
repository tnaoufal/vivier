/**
 * What leaves for the model and the database, built here so it can be
 * read and tested without either: the brief as one query text (stored
 * with the search and embedded), the full-text terms the search
 * function gets, the two system prompts (criteria extraction, result
 * explanation), the compact payload of an explanation request, and the
 * guard that drops a criterion about a protected characteristic.
 * Prompts are in English; the model answers in the brief's language.
 */
import type { BriefRow, MatchResult } from "@/lib/db/types";

import { normalise, type MatchProfile } from "./matching";

export type BriefText = Pick<BriefRow, "title" | "description" | "criteria">;

/** The most rows the retrieval answers; scoring runs on all of them. */
export const RETRIEVAL_LIMIT = 80;
/** The most results the model explains, the top of the ranking. */
export const EXPLANATION_MAX = 12;
/** The most criteria an extraction proposes. */
export const EXTRACTION_MAX = 12;

export const QUERY_TEXT_MAX = 6000;
export const TEXT_QUERY_MAX_TERMS = 48;
const DESCRIPTION_MAX = 3000;
const SUMMARY_MAX = 600;
const EVIDENCE_MAX = 120;

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
// protected characteristics
// ---------------------------------------------------------------------

const PROTECTED = new RegExp(
  "(?<![\\p{L}])(" +
    [
      "age", "ages", "aged", "date de naissance", "birth", "born", "sexe", "sex", "gender", "femme", "homme",
      "female", "male", "origine", "origines", "origin", "origins", "ethnic", "ethnie", "ethnique", "race",
      "racial", "nationalite", "nationality", "religion", "religieux", "religieuse", "religious", "confession",
      "handicap", "handicape", "handicapee", "disability", "disabled", "enceinte", "grossesse", "pregnancy",
      "pregnant", "famille", "familiale", "family", "marital", "marie", "mariee", "married", "enfants",
      "children", "syndicat", "syndical", "syndicale", "syndique", "trade union", "politique", "political",
      "orientation sexuelle", "sexual orientation", "photo", "photographie",
    ].join("|") +
    ")(?![\\p{L}])",
  "u",
);

/** True when a label or value names a protected characteristic: such a criterion is never kept. */
export function protectedCriterion(label: string, value: string): boolean {
  return PROTECTED.test(normalise(label)) || PROTECTED.test(normalise(value));
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
// explanations
// ---------------------------------------------------------------------

export interface ExplanationCandidate {
  profile: MatchProfile;
  result: MatchResult;
}

export interface ExplanationVerdict {
  criterion: string;
  verdict: string;
  evidence: string | null;
}

export interface ExplanationProfile {
  candidateId: string;
  headline: string | null;
  summary: string | null;
  skills: string[];
  languages: string[];
  location: string | null;
  yearsExperience: number | null;
  availability: string | null;
  education: string[];
  verdicts: ExplanationVerdict[];
}

export interface ExplanationPayload {
  brief: {
    title: string;
    description: string;
    criteria: { id: string; label: string; value: string; required: boolean }[];
  };
  candidates: ExplanationProfile[];
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

/**
 * The user message of an explanation request: the brief, its criteria,
 * and for each of the top candidates a compact profile (no name, no
 * contact details) with the verdicts already computed. At most
 * EXPLANATION_MAX candidates.
 */
export function explanationPayload(brief: BriefText, candidates: readonly ExplanationCandidate[]): ExplanationPayload {
  const criteria = brief.criteria ?? [];
  const labels = new Map(criteria.map((criterion) => [criterion.id, criterion.label] as const));
  return {
    brief: {
      title: brief.title.trim().slice(0, 200),
      description: brief.description.trim().slice(0, DESCRIPTION_MAX),
      criteria: criteria.map((criterion) => ({
        id: criterion.id,
        label: criterion.label,
        value: criterion.value,
        required: criterion.required,
      })),
    },
    candidates: candidates.slice(0, EXPLANATION_MAX).map(({ profile, result }) => ({
      candidateId: profile.id,
      headline: text(profile.headline, 200),
      summary: text(profile.summary, SUMMARY_MAX),
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
      education: (Array.isArray(profile.education) ? profile.education : [])
        .filter((entry) => entry && typeof entry.degree === "string" && entry.degree.trim())
        .slice(0, 5)
        .map((entry) => (entry.school ? `${entry.degree.trim()} — ${entry.school}` : entry.degree.trim())),
      verdicts: result.verdicts.map((verdict) => ({
        criterion: labels.get(verdict.criterionId) ?? verdict.criterionId,
        verdict: verdict.verdict,
        evidence: verdict.evidence ? verdict.evidence.slice(0, EVIDENCE_MAX) : null,
      })),
    })),
  };
}

export function explanationSystemPrompt(): string {
  return [
    "You explain, for an HR team, how each candidate profile relates to a job brief. The team decides; you only describe.",
    'Answer with JSON only: {"explanations":[{"candidateId":"...","why":"..."}]}, one entry per candidate given, with the candidateId exactly as given.',
    "Rules for why:",
    "- Two or three factual sentences in the language of the brief, stating what matches the criteria, what is missing, and what the profile does not say (a verdict of not_stated means the CV says nothing about it: say so, never treat it as a lack).",
    "- Rest only on the profile and the verdicts given. No praise, no speculation, no advice, no ranking between candidates, no recommendation to hire or reject.",
    "- Never mention or infer age, gender, origin, nationality, family situation, health, religion, politics or any other protected characteristic.",
    "- Plain sentences, no bullet points, no markdown, at most 400 characters per candidate.",
  ].join("\n");
}
