/**
 * What leaves for the model and the database, built here so it can be
 * read and tested without either: the brief as one query text (stored
 * with the search and embedded), the full-text terms the search
 * function gets, the system prompts (the one reading of a brief, which
 * answers the role profile and the criteria together, the role first;
 * the screening of one candidate against one brief the way a senior
 * recruiter reads a CV: the métier first, then the seniority, the
 * context, the trajectory and the achievements, with strengths,
 * concerns and interview questions; the second opinion on a retained
 * profile), the rules that bind a brief's reading before it is stored
 * (enforceBriefReading; the zod schema of the answer is each app's own,
 * src/lib/briefs/prompts.ts in the web app), and the payloads of those requests, where the
 * role (the job itself) comes first and apart from the other
 * requirements, its definition read off the role profile whenever the
 * brief has one, and the role profile (the understanding of the job)
 * travels compact (the guard against a criterion about a protected
 * characteristic is criteria.ts's). payloadTexts() lists what the model
 * was given, so assessment.ts can check that a quote it answers exists.
 * Prompts are in English; the model answers in the brief's language. A
 * payload never carries a name, an email or a phone number: the model
 * reads a profile, not a person. The name is read for that very reason,
 * so redactIdentity() can take it out of every text (the CV's indexed
 * text starts with it), along with e-mail addresses and phone numbers.
 */
import {
  isCriterionKind,
  LABEL_MAX,
  protectedCriterion,
  roleCriterion,
  roleCriterionOf,
  roleFirst,
  toWeight,
  VALUE_MAX,
  withId,
} from "./criteria.js";
import { escapeRegExp, normalise } from "./matching.js";
import {
  briefSourceHash,
  cleanRoleProfile,
  guardRoleProfile,
  jobTitleOf,
  ROLE_ASSUMPTIONS_MAX,
  ROLE_MISSIONS_MAX,
  ROLE_MISSIONS_MIN,
  ROLE_PROFILE_BRIEF_MAX,
  ROLE_PROFILE_ITEM_MAX,
  ROLE_PROFILE_LIST_MAX,
  ROLE_PROFILE_TEXT_MAX,
  roleDefinitionOf,
  statesMaximumYears,
  type RoleProfileAnswer,
} from "./role-profile.js";
import type {
  Assessment,
  AssessmentDimension,
  AssessmentProfile,
  BriefCriterion,
  BriefSource,
  CriterionKind,
  RequirementMet,
  RoleProfile,
  RoleSeniority,
} from "./types.js";

export type { AssessmentProfile } from "./types.js";

/** The brief as the payloads read it: its text, its criteria, and the role profile when it has one. */
export interface BriefText extends BriefSource {
  criteria: BriefCriterion[];
  roleProfile?: RoleProfile | null | undefined;
}

/**
 * Up to this many active candidates the search takes the whole pool, so
 * no profile is left out by the retrieval; above it the hybrid retrieval
 * answers RETRIEVAL_LIMIT rows and the assessment reads those.
 */
export const FULL_POOL_MAX = 200;
/** The most rows the retrieval answers; scoring runs on all of them. */
export const RETRIEVAL_LIMIT = 120;
/** The most criteria an extraction proposes, the role among them. */
export const EXTRACTION_MAX = 12;
/** A role's definition: the job's domain, its core missions, the equivalent titles, the sector when the brief names one. */
export const ROLE_DEFINITION_MAX = VALUE_MAX;

export const QUERY_TEXT_MAX = 6000;
export const TEXT_QUERY_MAX_TERMS = 48;
/**
 * How many terms of the role's definition go ahead of the title in the
 * full-text query: its equivalent titles are worth finding, but the
 * whole text (missions, titles, a sector) would take most of the terms
 * before the other criteria's values were reached.
 */
export const ROLE_DEFINITION_QUERY_TERMS = 12;
/** The whole assessment payload stays under about this many characters: the CV text is clipped to what is left. */
export const ASSESSMENT_PAYLOAD_MAX = 9000;
const ASSESSMENT_DESCRIPTION_MAX = 4000;
const ASSESSMENT_EXPERIENCES_MAX = 12;
const ASSESSMENT_EXPERIENCE_TEXT_MAX = 500;
const SUMMARY_MAX = 600;

/**
 * The role's definition as the payloads and the full-text query read
 * it: the profile's (domain, missions, equivalent titles) whenever the
 * brief has a profile that names something, else the criterion's stored
 * value. The team edits the profile; the criterion written at the first
 * search would otherwise stay as it was.
 */
export function roleDefinitionText(brief: BriefText, role: BriefCriterion): string {
  const fromProfile = brief.roleProfile ? roleDefinitionOf(brief.roleProfile) : "";
  return fromProfile || role.value;
}

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
  "les",
  "des",
  "une",
  "pour",
  "avec",
  "dans",
  "sur",
  "par",
  "est",
  "son",
  "ses",
  "sa",
  "qui",
  "que",
  "quoi",
  "pas",
  "plus",
  "nous",
  "vous",
  "notre",
  "votre",
  "vos",
  "nos",
  "aux",
  "chez",
  "sous",
  "entre",
  "ans",
  "ainsi",
  "afin",
  "dont",
  "cette",
  "ces",
  "cet",
  "leur",
  "leurs",
  "elle",
  "ils",
  "elles",
  "sont",
  "etre",
  "avoir",
  "fait",
  "faire",
  "tout",
  "tous",
  "toute",
  "toutes",
  "comme",
  "aussi",
  "tres",
  "bien",
  "sans",
  "mais",
  "donc",
  "car",
  "via",
  "puis",
  "encore",
  "deja",
  "poste",
  "profil",
  "mission",
  "missions",
  "recherche",
  "recherchons",
  "cherchons",
  "cherche",
  "candidat",
  "candidate",
  "candidats",
  "candidates",
  "equipe",
  "entreprise",
  "societe",
  "groupe",
  "annee",
  "annees",
  "minimum",
  "souhaite",
  "souhaitee",
  "idealement",
  "imperatif",
  "imperativement",
  "obligatoire",
  "indispensable",
  "requis",
  "requise",
  "niveau",
  "bonne",
  "bonnes",
  "bon",
  "bons",
  "connaissance",
  "connaissances",
  "competence",
  "competences",
  "maitrise",
  "capacite",
  "capacites",
  "experience",
  "experiences",
  "experimente",
  "experimentee",
  // en
  "the",
  "and",
  "for",
  "with",
  "from",
  "that",
  "this",
  "our",
  "your",
  "you",
  "are",
  "has",
  "have",
  "will",
  "who",
  "what",
  "not",
  "but",
  "all",
  "any",
  "can",
  "years",
  "year",
  "etc",
  "within",
  "also",
  "very",
  "well",
  "must",
  "should",
  "would",
  "able",
  "strong",
  "good",
  "required",
  "preferred",
  "ideally",
  "least",
  "position",
  "role",
  "looking",
  "seeking",
  "join",
  "team",
  "company",
  "candidate",
  "candidates",
  "skills",
  "skill",
  "knowledge",
  "level",
  "plus",
  "proven",
  "track",
  "record",
  "ability",
  "excellent",
]);

/** The terms of one text: normalised, three letters at least, no stop word, each once. */
function termsOf(part: string | null | undefined): string[] {
  const out = new Set<string>();
  for (const token of normalise(part).split(/[^\p{L}\p{N}]+/u)) {
    if (token.length >= 3 && !STOP_WORDS.has(token)) out.add(token);
  }
  return [...out];
}

/**
 * The terms the full-text search gets, joined with OR so a long brief
 * ranks by how many of its words a CV holds instead of demanding every
 * one of them: the criteria other than the role first (values, then
 * labels), then the role's label and the first terms of its definition
 * (ROLE_DEFINITION_QUERY_TERMS), then the title, the description, and
 * the rest of the definition; normalised, three letters at least, no
 * stop word, each once, `maxTerms` at most. The role's definition
 * comes after the other criteria on purpose: six hundred characters of
 * missions and titles would otherwise crowd out the languages, the
 * degree and the tools the brief asks for.
 */
export function textQueryOf(brief: BriefText, maxTerms = TEXT_QUERY_MAX_TERMS): string {
  const criteria = brief.criteria ?? [];
  const role = roleCriterion(criteria);
  const others = criteria.filter((criterion) => criterion !== role);
  const definition = role ? termsOf(roleDefinitionText(brief, role)) : [];
  const ordered: string[][] = [
    ...others.map((criterion) => termsOf(criterion.value)),
    ...others.map((criterion) => termsOf(criterion.label)),
    role ? termsOf(role.label) : [],
    definition.slice(0, ROLE_DEFINITION_QUERY_TERMS),
    termsOf(brief.title),
    termsOf(brief.description),
    definition.slice(ROLE_DEFINITION_QUERY_TERMS),
  ];
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const part of ordered) {
    for (const token of part) {
      if (seen.has(token)) continue;
      seen.add(token);
      terms.push(token);
      if (terms.length >= maxTerms) return terms.join(" OR ");
    }
  }
  return terms.join(" OR ");
}

// ---------------------------------------------------------------------
// the one reading of a brief: the role profile and the criteria
// ---------------------------------------------------------------------

/**
 * How the role's definition is written: what the assessment reads to
 * judge whether a profile's métier is this job, whatever the titles.
 */
const ROLE_DEFINITION_RULES = [
  `- The role's value is the ROLE DEFINITION, up to ${ROLE_DEFINITION_MAX} characters, in the language of the brief, as prose: the domain of the job (sales, finance, engineering...), the three to six core missions that define the job (for a business developer: prospecting new accounts, selling and negotiating, growing revenue from new clients), the usual equivalent titles under which other companies name the same job (commercial grands comptes, ingénieur d'affaires, chargé d'affaires, sales executive, account executive), and, only when the brief says so, the sector or the product.`,
  "- Write the definition from what this job is in the market, not only from the brief's words: the brief rarely spells out the missions, and only adds the sector, the product or a particular scope when it states one.",
  '- Missions, scope and titles only: never a protected characteristic (age, gender, origin, family situation, health, religion, politics, appearance...), and none of the words that name one (write "domain" or "métier", not "family" or "famille", for the job\'s domain).',
];

/** What the answer schema lets through; named so the handler and the enforcement read a typed value. */
export interface BriefReadingAnswer {
  profile: RoleProfileAnswer;
  criteria: {
    kind: string;
    label: string;
    value: string;
    required?: boolean | undefined;
    weight?: number | undefined;
  }[];
  warnings?: string[] | undefined;
}

/**
 * The one call that reads a brief: the system prompt asks, in one JSON,
 * for the role profile (the understanding of the job a senior recruiter
 * writes down before reading a CV) and for the criteria (the role
 * first, then one per requirement the brief states); the user message
 * is the brief's title and text, clipped to ROLE_PROFILE_BRIEF_MAX. The
 * brief is the only source and nobody checks or edits the answer before
 * the analysis reads it, so the prompt says what is read from the text
 * and what from the job as it is in the market.
 */
export function readBriefPrompt(brief: BriefSource): {
  system: string;
  user: string;
} {
  const description = brief.description.trim().slice(0, ROLE_PROFILE_BRIEF_MAX);
  return {
    system: [
      "You are a senior recruitment consultant. You read ONE job brief, exactly as its author wrote it, and write down in one JSON what you would brief a junior recruiter with before a single CV is read: your understanding of the job (profile) and the brief's requirements as criteria (criteria), the job itself first. The brief is the only source: what you answer is what the analysis reads, and it decides nothing about a person.",
      'Answer with JSON only: {"profile":{"assumptions":["..."],"domain":"...","seniority":"junior|confirmed|senior|manager|executive","yearsMin":3,"yearsMax":null,"missions":["..."],"equivalentTitles":["..."],"adjacentProfiles":["..."],"context":{"sector":null,"product":null,"clients":null,"scope":null},"mustHaves":["..."],"niceToHaves":["..."],"successFactors":["..."],"questions":["..."]},"criteria":[{"kind":"role|skill|experience|language|location|education|availability|other","label":"...","value":"...","required":true,"weight":2}],"warnings":["..."]}.',
      "Rules for profile:",
      `- assumptions: two to four sentences saying what the brief does not state and you had to assume (the exact métier when the title is ambiguous, the level, the scope); [] when the brief is explicit. At most ${ROLE_ASSUMPTIONS_MAX} sentences.`,
      `- domain: the domain of the job as it is in the market (sales, finance, engineering, care...), written from what this job is, not only from the brief's words; at most ${ROLE_PROFILE_TEXT_MAX} characters. Write "domain" or "métier", not "family" or "famille", for the job's domain.`,
      '- seniority: the level the brief asks for: "junior" (first years), "confirmed" (autonomous in the role), "senior" (reference in the role, mentors), "manager" (leads people doing the job), "executive" (leads the function).',
      "- yearsMin: the years of experience in the role the brief states, or the minimum the level implies; null when nothing says. yearsMax: ONLY when the brief itself states a maximum; never infer one from the level: a ceiling on experience is a proxy for age and is not yours to write.",
      `- missions: the ${ROLE_MISSIONS_MIN} to ${ROLE_MISSIONS_MAX} core missions that define the job (for a business developer: prospecting new accounts, selling and negotiating, growing revenue from new clients), from your knowledge of the job: the brief rarely spells them out.`,
      "- equivalentTitles: the usual titles under which other companies name the same job, in the brief's language and in English when the market uses it.",
      '- adjacentProfiles: the neighbouring backgrounds that can succeed in the job, each with what it lacks in a few words (e.g. "account manager : keeps clients, does not win them").',
      "- context: the sector, the product, the clients and the scope markers (team size, budget, deal size, territory) ONLY when the brief states them; null for each one the brief does not state. Never guess a context.",
      "- mustHaves: the deal-breakers in words, as the brief states them (a language, a degree, a place, a tool, years in the role), nothing the brief does not say. niceToHaves: what the brief welcomes without requiring it.",
      "- successFactors: what makes someone succeed in this job, as a senior recruiter would say it: the behaviours and the know-how that separate a good hire from a bad one.",
      "- questions: three to five points to verify in an interview with every candidate for this job.",
      `- Lists hold at most ${ROLE_PROFILE_LIST_MAX} items of at most ${ROLE_PROFILE_ITEM_MAX} characters, in the language of the brief, plain words, no markdown.`,
      "Rules for criteria:",
      `- At most ${EXTRACTION_MAX} criteria, the most useful first, one criterion per requirement, nothing the brief does not say, except the role definition, which you write from your knowledge of the job (the brief rarely spells out the missions).`,
      '- The FIRST criterion is always the role, exactly one, built from the title and the text: "kind":"role", label = the job title as the brief names it (e.g. "Business Developer"), "required":true, "weight":3.',
      ...ROLE_DEFINITION_RULES,
      "- The role's definition and profile.domain, profile.missions and profile.equivalentTitles describe the same job: write them from one reading.",
      "- Each of profile.mustHaves is a required criterion of the matching kind, in the brief's words; what the brief welcomes without requiring it is a criterion that is not required.",
      '- Then the other criteria. kind: "skill" for a tool, technique, method or domain; "experience" for years of experience (value is the number of years alone, e.g. "5"); "language" for a spoken language (value is the language with its level when stated, e.g. "anglais C1", "english fluent"); "location" for a city, region or country (value is the place alone); "education" for a degree or a school; "availability" for a start date or notice period; "other" for anything else.',
      '- label: short, in the language of the brief, as it reads on a chip (e.g. "Anglais courant", "5 ans en contrôle de gestion"). value: the thing to find in a profile, lowercase, no filler words.',
      "- required: true only when the brief states the requirement as mandatory (must, required, mandatory, obligatoire, impératif, indispensable, exigé). Otherwise false.",
      "- weight: 3 for what the brief insists on, 2 for what it asks for, 1 for what it only welcomes (a plus, apprécié, idéalement, nice to have).",
      "- Never produce a criterion about age, date of birth, gender, origin, nationality, ethnicity, family situation, pregnancy, health, disability, religion, union membership, political opinion, sexual orientation, appearance or any other protected characteristic, even when the brief asks for it: drop it and add one sentence to warnings naming the dropped request, in the language of the brief. warnings is [] when nothing was dropped.",
      "- Never a protected characteristic in any field of the profile either, and none of the words that name one, even when the brief asks for it: leave it out.",
    ].join("\n"),
    user: `Title: ${brief.title.trim()}\n\nBrief:\n${description || "(no description)"}`,
  };
}

/** A brief's reading bound by the rules, as it is stored. */
export interface BriefReading {
  profile: RoleProfile;
  /** The role first and once, then the other criteria the brief states, EXTRACTION_MAX at most, each with a fresh id. */
  criteria: BriefCriterion[];
  /** The model's sentences about requests it dropped, in the brief's language. */
  warnings: string[];
  /** Criteria and fields of the profile dropped here because they named a protected characteristic. */
  dropped: number;
}

/**
 * The answer bound before anything is stored: the profile cleaned (a
 * ceiling on years the brief did not state is the model's, and a proxy
 * for age: dropped) and guarded, with the hash of the text it was read
 * from; the criteria cleaned, capped at EXTRACTION_MAX and stripped of
 * protected characteristics, the role first and once. The role's label
 * is the job as the model names it (else as the profile does); its
 * definition is the profile's (domain, missions, equivalent titles), so
 * the criterion, the payloads and the triage read one job, and a
 * profile read again from a changed text reads as a changed job
 * (roleChangedSince, presentation.ts); the model's own definition
 * stands only when the profile names nothing. A role that names a
 * protected characteristic is left out, and the profile's title stands
 * for the job (triage.ts). Pure: no model, no data access.
 */
export function enforceBriefReading(
  brief: BriefSource,
  answer: BriefReadingAnswer,
  defaults: { model: string | null; createdAt: string },
): BriefReading {
  const cleaned = cleanRoleProfile(
    {
      ...answer.profile,
      yearsMax: statesMaximumYears(brief) ? answer.profile.yearsMax : null,
      sourceHash: briefSourceHash(brief),
    },
    { title: jobTitleOf(brief), model: defaults.model, createdAt: defaults.createdAt },
  );
  const guarded = guardRoleProfile(cleaned);
  const profile = guarded.profile;
  let dropped = guarded.dropped;
  const others: BriefCriterion[] = [];
  let named: { label: string; value: string } | null = null;
  for (const item of answer.criteria) {
    const label = item.label.trim().slice(0, LABEL_MAX);
    const value = item.value.trim().slice(0, VALUE_MAX);
    if (!label || !value) continue;
    const kind: CriterionKind = isCriterionKind(item.kind) ? item.kind : "other";
    if (kind === "role") {
      if (!named) named = { label, value };
      continue;
    }
    // The other criteria stop at the cap; the role is read wherever the model put it.
    if (others.length >= EXTRACTION_MAX) continue;
    if (protectedCriterion(label, value, kind)) {
      dropped += 1;
      continue;
    }
    others.push(
      withId({
        kind,
        label,
        value,
        required: item.required === true,
        weight: toWeight(item.weight),
      }),
    );
  }
  const label = named?.label || profile.title;
  const value = roleDefinitionOf(profile) || named?.value || label;
  let role: BriefCriterion | null = null;
  if (label && value) {
    if (protectedCriterion(label, value, "role")) dropped += 1;
    else role = roleCriterionOf(label, value);
  }
  const criteria = (role ? [role, ...others] : others).slice(0, EXTRACTION_MAX);
  const warnings = (answer.warnings ?? [])
    .map((warning) => warning.trim().slice(0, 300))
    .filter((warning) => warning.length > 0)
    .slice(0, 5);
  return { profile, criteria, warnings, dropped };
}

// ---------------------------------------------------------------------
// the expert assessment of one candidate against one brief
// ---------------------------------------------------------------------

export interface AssessmentRequirement {
  id: string;
  label: string;
  value: string;
  required: boolean;
  weight: number;
}

/** The job itself, first and apart from the other requirements: the model judges it before anything else. */
export interface AssessmentRole {
  id: string;
  /** The job as the brief names it. */
  label: string;
  /** Its definition: the job's domain, core missions, equivalent titles, sector when stated. */
  definition: string;
}

/** The role profile as a payload carries it: what the screening judges against, nothing the team wrote for itself. */
export interface AssessmentRoleProfile {
  domain: string;
  seniority: RoleSeniority;
  yearsMin: number | null;
  yearsMax: number | null;
  missions: string[];
  equivalentTitles: string[];
  adjacentProfiles: string[];
  context: RoleProfile["context"];
  mustHaves: string[];
  successFactors: string[];
}

export interface AssessmentExperience {
  title: string;
  company: string | null;
  start: string | null;
  end: string | null;
  description: string | null;
}

export interface AssessmentBrief {
  title: string;
  description: string;
  /** Null for a brief analysed before the role existed: the assessment then reads the requirements alone. */
  role: AssessmentRole | null;
  /** Null for a brief without a role profile: seniority and context are then judged against the brief's text. */
  roleProfile: AssessmentRoleProfile | null;
  /** The other requirements, the role left out. */
  requirements: AssessmentRequirement[];
}

export interface AssessmentCandidate {
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
}

export interface AssessmentPayload {
  brief: AssessmentBrief;
  candidate: AssessmentCandidate;
}

/** The compact profile: the domain, the level, the missions, the titles, the adjacent profiles, the context, the must-haves, the success factors. */
export function compactRoleProfile(profile: RoleProfile): AssessmentRoleProfile {
  return {
    domain: profile.domain,
    seniority: profile.seniority,
    yearsMin: profile.yearsMin,
    yearsMax: profile.yearsMax,
    missions: profile.missions,
    equivalentTitles: profile.equivalentTitles,
    adjacentProfiles: profile.adjacentProfiles,
    context: { ...profile.context },
    mustHaves: profile.mustHaves,
    successFactors: profile.successFactors,
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
  return new RegExp(
    `(?<![\\p{L}\\p{N}])${parts.map(escapeRegExp).join("[\\s-]+")}(?![\\p{L}\\p{N}])`,
    "giu",
  );
}

/**
 * The patterns a name is removed with: the whole name in the order given
 * and reversed, then each word and each hyphen-joined part of three
 * letters or more on its own (a summary may call the person by their
 * first name). A part that is also a word or a place disappears from
 * the text with it; the structured fields keep what they hold.
 */
function namePatterns(fullName: string | null | undefined): RegExp[] {
  const words = (fullName ?? "")
    .trim()
    .split(/\s+/u)
    .filter((word) => word.length > 0);
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
  let out = text
    .replace(EMAIL_PATTERN, " ")
    .replace(DIGIT_RUN, (run) => (isPhone(run) ? " " : run));
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

function cleanerFor(profile: AssessmentProfile): CleanText {
  return (value, max) =>
    typeof value === "string" ? text(redactIdentity(value, profile.full_name), max) : null;
}

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

/** The brief's part of a payload: the role first and apart (its definition the profile's when there is one), the profile compact, then the other requirements. */
function briefOf(brief: BriefText): AssessmentBrief {
  const criteria = brief.criteria ?? [];
  const role = roleCriterion(criteria);
  return {
    title: brief.title.trim().slice(0, 200),
    description: brief.description.trim().slice(0, ASSESSMENT_DESCRIPTION_MAX),
    role: role
      ? { id: role.id, label: role.label, definition: roleDefinitionText(brief, role) }
      : null,
    roleProfile: brief.roleProfile ? compactRoleProfile(brief.roleProfile) : null,
    requirements: criteria
      .filter((criterion) => criterion !== role)
      .map((criterion) => ({
        id: criterion.id,
        label: criterion.label,
        value: criterion.value,
        required: criterion.required,
        weight: criterion.weight,
      })),
  };
}

/** The candidate's part of a payload: the structured profile with no name and no contact details, the CV's text left for the budget. */
function candidateOf(profile: AssessmentProfile, clean: CleanText): AssessmentCandidate {
  return {
    headline: clean(profile.headline, 200),
    summary: clean(profile.summary, SUMMARY_MAX),
    skills: (Array.isArray(profile.skills) ? profile.skills : [])
      .filter((skill): skill is string => typeof skill === "string" && skill.trim().length > 0)
      .slice(0, 40)
      .map((skill) => skill.trim().slice(0, 60)),
    languages: (Array.isArray(profile.languages) ? profile.languages : [])
      .filter((language) => language && typeof language.name === "string" && language.name.trim())
      .slice(0, 10)
      .map((language) =>
        language.level ? `${language.name.trim()} (${language.level})` : language.name.trim(),
      ),
    location: text(profile.location, 120),
    yearsExperience: typeof profile.years_experience === "number" ? profile.years_experience : null,
    availability: text(profile.availability, 120),
    experiences: experiencesOf(profile, clean),
    education: (Array.isArray(profile.education) ? profile.education : [])
      .filter((entry) => entry && typeof entry.degree === "string" && entry.degree.trim())
      .slice(0, 5)
      .map((entry) =>
        entry.school ? `${entry.degree.trim()} — ${entry.school}` : entry.degree.trim(),
      ),
    extra: null,
  };
}

/** The CV's indexed text, redacted and clipped to what the budget leaves once the rest of the payload is counted. */
function fillExtra<T extends { candidate: AssessmentCandidate }>(
  payload: T,
  profile: AssessmentProfile,
  clean: CleanText,
): T {
  const left = ASSESSMENT_PAYLOAD_MAX - JSON.stringify(payload).length;
  const extra = clean(profile.search_text, Math.max(0, left));
  payload.candidate.extra = left > 0 && extra ? extra : null;
  return payload;
}

/**
 * Every text of a payload the model could quote from, one entry per
 * field, one per experience (its title, company, dates and description
 * together, since a quote names a position with its dates) and, when
 * there are several, the timeline of the positions as one text (a
 * contradiction between two positions' dates quotes both): what
 * assessment.ts checks an evidence against. A quote absent from all of
 * them was not read in the profile.
 */
export function payloadTexts(payload: { candidate: AssessmentCandidate }): string[] {
  const candidate = payload.candidate;
  const timeline = candidate.experiences
    .map((experience) =>
      [experience.title, experience.company, experience.start, experience.end]
        .filter((part): part is string => Boolean(part))
        .join(" "),
    )
    .join(" ; ");
  const texts: (string | null)[] = [
    candidate.headline,
    candidate.summary,
    candidate.skills.join(", "),
    candidate.languages.join(", "),
    candidate.location,
    candidate.yearsExperience === null ? null : String(candidate.yearsExperience),
    candidate.availability,
    ...candidate.experiences.map((experience) =>
      [
        experience.title,
        experience.company,
        experience.start,
        experience.end,
        experience.description,
      ]
        .filter((part): part is string => Boolean(part))
        .join(" "),
    ),
    candidate.experiences.length > 1 ? timeline : null,
    candidate.education.join(", "),
    candidate.extra,
  ];
  return texts.filter((text): text is string => Boolean(text && text.trim()));
}

/**
 * The user message of an assessment request: the brief with its role
 * first and apart, the role profile compact when it has one, then its
 * other requirements, and the candidate's structured profile (no name,
 * no contact details) followed by the CV's text clipped so the whole
 * payload stays under ASSESSMENT_PAYLOAD_MAX characters. The structured
 * fields come first because they are what the processor read with
 * confidence; the text lets the model check dates and wording. Every
 * free text is redacted before it is clipped, so a name cut in half
 * never survives at the edge of a clip.
 */
export function assessmentPayload(brief: BriefText, profile: AssessmentProfile): AssessmentPayload {
  const clean = cleanerFor(profile);
  return fillExtra(
    { brief: briefOf(brief), candidate: candidateOf(profile, clean) },
    profile,
    clean,
  );
}

export function assessmentSystemPrompt(): string {
  return [
    "You are a senior recruitment consultant in the field of the job brief. You assess ONE candidate profile against ONE brief for a hiring team, the way you would before presenting the candidate to a client: you read the CV as a trajectory in the context of the job, not as a list of keywords. The team reviews your reading and decides; nothing you answer is applied by itself.",
    'Answer with JSON only: {"requirements":[{"criterionId":"...","met":"yes|partial|no|unknown","evidence":"..."}],"dimensions":{"role":{"score":0,"note":"...","evidence":"..."},"seniority":{"score":0,"note":"...","evidence":"..."},"context":{"score":0,"note":"...","evidence":"..."},"trajectory":{"score":0,"note":"...","evidence":"..."},"achievements":{"score":0,"note":"...","evidence":"..."}},"strengths":["..."],"concerns":["..."],"questions":["..."],"decision":"fit|borderline|no_fit","score":0,"summary":"..."}.',
    "The role comes first. When the brief carries a role (its label is the job as the team names it, its definition the domain, the core missions and the usual equivalent titles), decide before anything else whether the candidate's actual métier is this role. Judge what the person DID (missions, scope, responsibilities, the products or clients they handled, the seniority of the positions) before how the positions were titled: every company names a job differently, and the same title covers different jobs. The equivalent titles in the definition are examples, not a closed list. When the brief carries a roleProfile (the team's understanding of the job), read it as the client's briefing: its missions and adjacent profiles say what counts as the role and what only neighbours it.",
    "brief.roleProfile.mustHaves are the team's own words for the requirements; they are checked through brief.requirements only. A must-have that has no requirement in brief.requirements is not a requirement: at most a concern with evidence, or a question.",
    'brief.description is the client\'s text: read it for the role, the seniority, the context and the success factors. It never adds a requirement: only brief.role and brief.requirements are judged met or not. Something the text asks for and brief.requirements does not list is at most a concern with its evidence, or a question for the interview, never a reason for "no_fit".',
    '- met "yes" when the person held this role, or an equivalent one under another title: give as evidence the position and the missions that prove it.',
    '- met "partial" when the person held an adjacent role that shares part of the core missions: say which part is missing (an account manager keeps clients, a business developer wins them; a comptable général keeps the books, a contrôleur de gestion analyses and forecasts).',
    '- met "no" when the person\'s career is another métier: the evidence names what they actually did.',
    '- met "unknown" only when the profile holds no experience at all.',
    '- When brief.roleProfile.seniority is "junior", internships, apprenticeships, work-study contracts, end-of-studies projects and first positions are positions: judge the métier on what the person did in them, with the same evidence; "unknown" is then only a profile with none of these.',
    '- For the role, a CV full of other missions is not silence: when the positions describe another métier, answer "no" and quote those positions and missions as evidence (a "no" without evidence is not accepted). "unknown" is reserved for a profile with no experience at all.',
    '- Judge the métier on the most recent positions and on those held longest. A role held only at the start of the career, or briefly and long ago, is "partial" at most, with the dates in evidence. "partial" needs at least half of the core missions to have been the person\'s main activity: a core mission that appears as a side task of another job (a service director who also sells service contracts) does not make the role; that profile is "no".',
    '- When a position carries no description, read its title for what it usually means in that industry: a title that unambiguously names the role or one of its equivalents is "yes" with that title and its dates as evidence; an ambiguous title is "partial". A person who managed a team doing this job without carrying the missions themselves is "partial" (say so: led, not done), unless the definition asks for that seniority.',
    '- The sector or product in the definition narrows the role only when the brief insists on it: the same core missions in another sector are "yes" with the sector named in the evidence, so the team sees the difference; a sector the brief makes mandatory is a separate requirement.',
    '- Answer the role as the FIRST entry of "requirements", with "criterionId" equal to brief.role.id; then one entry per entry of brief.requirements.',
    "Rules for requirements: one entry per requirement given, with its id exactly as given.",
    '- met: "yes" when the profile clearly satisfies it; "partial" when it satisfies it in part (a lower level, fewer years, a neighbouring skill); "no" when the profile clearly does not satisfy it; "unknown" when the profile says nothing about it. Silence is never a lack for the other requirements (the role has its own rule above): a requirement the CV does not mention is "unknown", not "no".',
    '- evidence: a short quote taken from the profile as it is written (a position with its dates, a line of the CV, a listed skill or language), at most 200 characters, never invented, never paraphrased into something the profile does not say: a quote that is not found in the profile does not count as evidence, and a "yes" without one reads as "partial". Empty when met is "unknown".',
    '- Be strict on required requirements: when the profile clearly does not meet a required requirement, answer "no", whatever the rest of the profile.',
    "- Seniority and years of experience are judged from the dated experiences when the CV states them (add up the relevant periods); the stated total is a hint, not a proof.",
    "- Judge the field of experience, not only the words: a title in another industry or another role does not meet a requirement about this one.",
    '- A requirement on a degree or a school is met by that level or that school whatever the field, unless the requirement itself names the field: "diplôme d\'ingénieur ou équivalent" is "yes" for any engineering diploma and for a master\'s degree of the same level; "partial" is a lower level, never another field.',
    "Rules for dimensions: the five things a senior recruiter weighs, each with a score from 0 to 100, one factual note of at most 200 characters in the language of the brief, and the evidence it rests on (a quote or fact from the profile as it is written, at most 200 characters; a score above 50 needs one: without evidence the score is 50).",
    "- role: the métier judgement above as a score: 85 or more when the person held this role with the missions in evidence, around 55 for an adjacent métier, 20 or less for another métier, 50 when no experience says.",
    "- seniority: the level reached and the years in the role against brief.roleProfile.seniority, yearsMin and yearsMax (against the brief's text when there is no profile): under, at, or above the level asked. Say which in the note. Above the level is a concern to name, never a disqualifier by itself: score it around 60, not 0; at the level is 85 or more; far under is 30 or less. Above the level is judged on the level reached (titles, scope, teams led), never on a number of years, and only when brief.roleProfile.yearsMax is set or the brief says it wants that level and not more. For a junior brief, under the level is not a concern; at the level is 85 or more as soon as the person held the missions in an internship or a first position.",
    '- context: the sector, the product, the clients and the scope of the positions against brief.roleProfile.context (against the brief\'s text when there is no profile). When the brief states no context, or the CV says nothing about it, score 50 with the note "le CV ne le précise pas" (in the language of the brief): silence is not a mismatch.',
    "- trajectory: the progression and the coherence of the positions: responsibilities growing, a consistent domain, moves that make sense for the job; several very short positions in the role are stated factually in the note with their dates. NEVER A CAREER BREAK, A GAP, A DATE OF BIRTH, AN AGE, A FAMILY SITUATION: NONE OF THESE IS READ, SCORED OR MENTIONED, IN THIS DIMENSION OR ANYWHERE ELSE.",
    "- achievements: the evidence of impact: quantified results, the scope handled (revenue, budget, team, portfolio, volumes), the responsibilities taken. When the CV states no result, score 50 with a note saying so: a silent CV is not a weak one; below 50 is reserved for results the CV states and that are weak for the role.",
    "Rules for strengths: up to 5 facts from the profile, each at most 200 characters, in the language of the brief: what the person did that answers the brief (a position, a scope, a result, a skill in use), never an opinion, never praise.",
    "Rules for concerns: up to 4 reservations a recruiter would weigh before presenting the profile, each at most 200 characters, facts from the profile too (a must-have met only in part, a seniority above or under, a context far from the brief's, a contradiction in the CV), never an opinion, never a protected characteristic, never a career break or a gap. A thing the CV does not state is not a concern: it is a question.",
    "Rules for questions: up to 3 points a recruiter would verify in a first call with this candidate (what the CV leaves unclear, what to confirm before presenting), each at most 200 characters, in the language of the brief.",
    'Rules for decision: a role at "no" is "no_fit" whatever the rest: a profile whose métier is another one is not presented, however many other requirements it meets. A role at "partial" is at most "borderline". Then: "fit" when every required requirement is met and you would present the profile to the client as it is; "borderline" when it deserves a human look (a required requirement unknown, or important optional ones missing); "no_fit" when a required requirement is not met, never for any other reason: a profile whose métier is the role and whose required requirements are met is at least "borderline", and what bothers you goes in concerns with its evidence.',
    "Rules for score: 0 to 100, the overall fit of the profile to the brief, the role weighing most, then required requirements, then the weights given.",
    "Rules for summary: two to four factual sentences in the language of the brief, for a hiring manager. The first sentence says whether the candidate's métier is the role and on what positions that rests; then what matches, what is missing, what the CV does not say; the last sentence names the main reservation, or says there is none. No praise, no advice, no ranking, no recommendation to hire or reject, no bullet points, no markdown.",
    "Never mention, infer or use age, date of birth, gender, origin, nationality, ethnicity, family situation, pregnancy, health, disability, religion, union membership, political opinion, sexual orientation, appearance or any other protected characteristic, even when the brief or the profile mentions one.",
  ].join("\n");
}

// ---------------------------------------------------------------------
// the second opinion on a retained profile
// ---------------------------------------------------------------------

/** The first reading as the second opinion gets it: what was decided and on what, so the challenge reads the CV against it. */
export interface ChallengeAssessment {
  decision: Assessment["decision"];
  score: number;
  summary: string;
  requirements: {
    label: string;
    required: boolean;
    met: RequirementMet;
    evidence: string | null;
  }[];
  dimensions: Record<AssessmentDimension, { score: number; note: string }> | null;
  strengths: string[];
  concerns: string[];
}

export interface ChallengePayload {
  brief: AssessmentBrief;
  candidate: AssessmentCandidate;
  assessment: ChallengeAssessment;
}

/**
 * The user message of a second-opinion request: the same brief and the
 * same redacted profile as the screening, plus the first reading
 * (decision, score, summary, the requirement rows with their labels,
 * the dimension scores and notes, the strengths, the concerns), so the
 * model can look for what the first reading missed. Same budget.
 */
export function challengePayload(
  brief: BriefText,
  profile: AssessmentProfile,
  assessment: Assessment,
): ChallengePayload {
  const clean = cleanerFor(profile);
  const criteria = roleFirst(brief.criteria ?? []);
  const rows = new Map(assessment.requirements.map((row) => [row.criterionId, row] as const));
  const dimensions = assessment.dimensions;
  const first: ChallengeAssessment = {
    decision: assessment.decision,
    score: assessment.score,
    summary: assessment.summary,
    requirements: criteria.flatMap((criterion) => {
      const row = rows.get(criterion.id);
      return row
        ? [
            {
              label: criterion.label,
              required: criterion.required,
              met: row.met,
              evidence: row.evidence,
            },
          ]
        : [];
    }),
    dimensions: dimensions
      ? {
          role: { score: dimensions.role.score, note: dimensions.role.note },
          seniority: { score: dimensions.seniority.score, note: dimensions.seniority.note },
          context: { score: dimensions.context.score, note: dimensions.context.note },
          trajectory: { score: dimensions.trajectory.score, note: dimensions.trajectory.note },
          achievements: {
            score: dimensions.achievements.score,
            note: dimensions.achievements.note,
          },
        }
      : null,
    strengths: assessment.strengths ?? [],
    concerns: assessment.concerns ?? [],
  };
  return fillExtra(
    { brief: briefOf(brief), candidate: candidateOf(profile, clean), assessment: first },
    profile,
    clean,
  );
}

export function challengeSystemPrompt(): string {
  return [
    "You are a senior recruitment consultant giving a second opinion on ONE candidate profile that a first reading retained for ONE job brief, before it is presented to the hiring manager. Your one job is to find the strongest reason NOT to present this profile for this job, reading the CV again against the brief and against the first reading given. The team reviews your opinion and decides; nothing you answer is applied by itself.",
    'Answer with JSON only: {"verdict":"confirmed|doubt","kind":"metier|requirement|seniority|contradiction|context","reason":"...","evidence":"..."}.',
    "Look for, in this order: a métier mismatch hidden behind titles (the positions describe another job than brief.role, whatever they were called); a seniority mismatch against brief.roleProfile (far under the level; far above it only when the brief states a maximum level or years); a contradiction between facts of the CV (dates that overlap or do not add up, a skill claimed and never used in a position, a scope that does not match the position); a must-have of the brief (a requirement marked required in brief.requirements) the first reading marked met but the profile does not actually meet; a context too far from the brief's (sector, product, clients, scope) when the brief insists on it.",
    "brief.description is the client's text: read it for the role, the seniority, the context and the success factors. It never adds a requirement: only brief.role and brief.requirements are judged met or not. Something the text asks for and brief.requirements does not list is at most a question for the interview, never a reason to doubt.",
    '- verdict "doubt" ONLY with evidence: a quote taken from the profile as it is written, at most 200 characters, that shows the reason; a quote that is not found in the profile does not count. A doubt you cannot quote is not a doubt: answer "confirmed".',
    '- verdict "confirmed" when you find no such reason: reason then says in one sentence what the profile rests on, evidence and kind are empty.',
    '- kind, with a doubt, says what it is about: "metier" when the positions describe another job than brief.role; "requirement" when a required requirement the first reading marked met is not met; "seniority" when the level is far under the one asked, or above a maximum the brief states; "contradiction" when facts of the CV do not add up; "context" when the sector, the product, the clients or the scope are far from the brief\'s.',
    "- reason: one sentence in the language of the brief, at most 200 characters, a fact, not an opinion, no markdown.",
    "- Silence is never a lack: a thing the CV does not state is not a reason to doubt; a missing detail is a question for the interview. Do not repeat a reservation the first reading already lists unless the CV shows it is worse than written.",
    "- Never mention, infer or use age, date of birth, gender, origin, nationality, ethnicity, family situation, pregnancy, health, disability, religion, union membership, political opinion, sexual orientation, appearance or any other protected characteristic; never a career break, a gap or a period without a position: none of these is ever a reason.",
  ].join("\n");
}
