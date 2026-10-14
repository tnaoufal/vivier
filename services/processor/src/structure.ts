/**
 * From the text of a CV to a profile: the heart of the processor. Two
 * ways in, honest about what they are:
 *
 * - `heuristicProfile` (no model): an email and a phone by regex, a name
 *   from the first lines or the file name, every other field empty, and a
 *   low confidence on each so the UI shows them as unverified.
 * - `modelProfile`: one JSON completion under a system prompt that
 *   extracts only what is written, never guesses, answers null for what
 *   is not stated, and must not extract age, date of birth, gender,
 *   nationality, origin, photo, family, health, religion, union or
 *   political data. The answer is validated and normalised with zod. The
 *   same call says what the document is (`document_kind`: a CV, or
 *   something else such as a cover letter alone, a diploma, a form), so a
 *   file that is not a CV is set aside at no extra cost; only an explicit
 *   "other" sets a document aside, a missing or unknown answer counts as
 *   a CV, because a doubt must never cost a person their place in the
 *   pool. The heuristic path never classifies: it cannot tell.
 *
 * Then the derived values the schema needs: the dedup fingerprint, the
 * full-text `search_text`, the compact text an embedding is computed
 * from, and the merge of a new reading into an existing candidate.
 */
import { z } from "zod";

import type { ModelConfig } from "./config.js";
import { completeJson, type Usage } from "./model.js";
import {
  CONFIDENCE_FIELDS,
  type CandidateEducation,
  type CandidateExperience,
  type CandidateLanguage,
  type CandidateLink,
  type CandidateRow,
  type ConfidenceField,
  type ConfidenceMap,
  type DocumentKind,
} from "./types.js";

export interface Profile {
  full_name: string | null;
  email: string | null;
  phone: string | null;
  headline: string | null;
  location: string | null;
  years_experience: number | null;
  availability: string | null;
  summary: string | null;
  skills: string[];
  languages: CandidateLanguage[];
  experiences: CandidateExperience[];
  education: CandidateEducation[];
  links: CandidateLink[];
  tags: string[];
  confidence: ConfidenceMap;
}

export const SCALAR_FIELDS = [
  "full_name",
  "email",
  "phone",
  "headline",
  "location",
  "years_experience",
  "availability",
  "summary",
] as const;

export type ScalarField = (typeof SCALAR_FIELDS)[number];

export function emptyProfile(): Profile {
  return {
    full_name: null,
    email: null,
    phone: null,
    headline: null,
    location: null,
    years_experience: null,
    availability: null,
    summary: null,
    skills: [],
    languages: [],
    experiences: [],
    education: [],
    links: [],
    tags: [],
    confidence: {},
  };
}

// ---------------------------------------------------------------------
// small normalisers shared by both paths
// ---------------------------------------------------------------------

/** A trimmed single-line string capped at `max`, or null when empty or not text. */
export function cleanString(value: unknown, max: number): string | null {
  const raw =
    typeof value === "number" && Number.isFinite(value)
      ? String(value)
      : typeof value === "string"
        ? value
        : null;
  if (raw === null) return null;
  const trimmed = raw.replace(/\s+/g, " ").trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

/** Keeps the first occurrence of each label, case-insensitively, up to `max`. */
export function dedupeLabels(labels: Array<string | null | undefined>, max: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const label of labels) {
    if (!label) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(label);
    if (out.length >= max) break;
  }
  return out;
}

/** Lowercases a skill label except its acronyms ("SQL", "C++", "AWS lambda"). */
export function normaliseSkill(value: unknown): string | null {
  const label = cleanString(value, 60);
  if (!label) return null;
  return label
    .split(" ")
    .map((word) => (/^[A-Z0-9][A-Z0-9+#.&/-]*$/.test(word) && /[A-Z]/.test(word) ? word : word.toLowerCase()))
    .join(" ");
}

/** "YYYY-MM" or "YYYY" from a date as written; an ongoing marker or nothing usable is null. */
export function normaliseDate(value: unknown): string | null {
  const text = cleanString(value, 40);
  if (!text) return null;
  if (/^(present|current|now|today|ongoing|aujourd'hui|en cours|actuel(?:le)?(?:ment)?|à ce jour)$/i.test(text)) {
    return null;
  }
  const yearFirst = /(\d{4})(?:[-/.](\d{1,2}))?/.exec(text);
  const monthFirst = /^(\d{1,2})[-/.](\d{4})$/.exec(text);
  let year: string | undefined;
  let month: string | undefined;
  if (monthFirst) {
    month = monthFirst[1];
    year = monthFirst[2];
  } else if (yearFirst) {
    year = yearFirst[1];
    month = yearFirst[2];
  }
  if (!year) return null;
  const y = Number(year);
  if (y < 1950 || y > 2100) return null;
  if (month) {
    const m = Number(month);
    if (m >= 1 && m <= 12) return `${year}-${String(m).padStart(2, "0")}`;
  }
  return year;
}

export function normaliseYears(value: unknown): number | null {
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseFloat(value.replace(",", "."))
        : Number.NaN;
  if (!Number.isFinite(n) || n < 0 || n > 70) return null;
  return Math.round(n * 10) / 10;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Skills kept from one reading: the prompt asks for 8 to 20, the most
 * central first, so the first eight the interface shows are the ones a
 * recruiter would name. A candidate read before this rule keeps the long
 * list their row holds (the merge unions, it never trims).
 */
export const MAX_SKILLS = 24;

function toSkills(items: unknown[] | null | undefined): string[] {
  return dedupeLabels((items ?? []).map(normaliseSkill), MAX_SKILLS);
}

function toTags(items: unknown[] | null | undefined): string[] {
  return dedupeLabels(
    (items ?? []).map((item) => cleanString(item, 40)),
    30,
  );
}

function toLanguages(items: unknown[] | null | undefined): CandidateLanguage[] {
  const out: CandidateLanguage[] = [];
  const seen = new Set<string>();
  for (const item of items ?? []) {
    let name: string | null = null;
    let level: string | null = null;
    const object = record(item);
    if (typeof item === "string") name = cleanString(item, 40);
    else if (object) {
      name = cleanString(object["name"] ?? object["language"], 40);
      level = cleanString(object["level"], 40);
    }
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, level });
    if (out.length >= 20) break;
  }
  return out;
}

function toExperiences(items: unknown[] | null | undefined): CandidateExperience[] {
  const out: CandidateExperience[] = [];
  for (const item of items ?? []) {
    const object = record(item);
    if (!object) continue;
    const title = cleanString(object["title"] ?? object["role"] ?? object["position"], 160);
    if (!title) continue;
    out.push({
      title,
      company: cleanString(
        object["company"] ?? object["employer"] ?? object["organisation"] ?? object["organization"],
        160,
      ),
      start: normaliseDate(object["start"] ?? object["start_date"] ?? object["from"]),
      end: normaliseDate(object["end"] ?? object["end_date"] ?? object["to"]),
      description: cleanString(object["description"], 2000),
    });
    if (out.length >= 40) break;
  }
  return out;
}

function toEducation(items: unknown[] | null | undefined): CandidateEducation[] {
  const out: CandidateEducation[] = [];
  for (const item of items ?? []) {
    const object = record(item);
    if (!object) continue;
    const degree = cleanString(object["degree"] ?? object["title"] ?? object["diploma"], 200);
    if (!degree) continue;
    out.push({
      degree,
      school: cleanString(object["school"] ?? object["institution"] ?? object["university"], 160),
      year: normaliseDate(object["year"] ?? object["end"] ?? object["date"]),
    });
    if (out.length >= 20) break;
  }
  return out;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "link";
  }
}

function toLinks(items: unknown[] | null | undefined): CandidateLink[] {
  const out: CandidateLink[] = [];
  const seen = new Set<string>();
  for (const item of items ?? []) {
    let url: string | null = null;
    let label: string | null = null;
    const object = record(item);
    if (typeof item === "string") url = cleanString(item, 500);
    else if (object) {
      url = cleanString(object["url"] ?? object["href"], 500);
      label = cleanString(object["label"] ?? object["name"], 60);
    }
    if (!url) continue;
    if (!/^https?:\/\//i.test(url)) {
      if (!/^[\w.-]+\.[a-z]{2,}(?:\/|$)/i.test(url)) continue;
      url = `https://${url}`;
    }
    const key = url.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ label: label ?? hostOf(url), url });
    if (out.length >= 10) break;
  }
  return out;
}

function toConfidence(value: Record<string, unknown> | null | undefined): ConfidenceMap {
  const out: ConfidenceMap = {};
  if (!value) return out;
  for (const field of CONFIDENCE_FIELDS) {
    const raw = value[field];
    const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : Number.NaN;
    if (Number.isFinite(n)) out[field] = Math.min(1, Math.max(0, Math.round(n * 100) / 100));
  }
  return out;
}

// ---------------------------------------------------------------------
// (1) heuristic profile: regexes only, low confidence
// ---------------------------------------------------------------------

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/;
/** Digits with spaces, dots, dashes or brackets between them, on one line; a leading + or 00. */
const PHONE_RE = /(?:\+|00)?\d(?:[\d \t().-]{6,20})\d/g;
const NAME_WORD_RE = /^[\p{L}][\p{L}'’.-]*$/u;
const NOT_A_NAME_RE =
  /curriculum|vitae|\bcv\b|r[ée]sum[ée]|\bprofil\b|\bprofile\b|contact|adresse|address|t[ée]l[ée]?phone|\bt[ée]l\b|\bphone\b|\bmobile\b|e-?mail|\bborn\b|\bn[ée]e? le\b|portfolio|linkedin|github|\bpage\b/i;

export function findEmail(text: string): string | null {
  const match = EMAIL_RE.exec(text);
  return match ? match[0].slice(0, 254) : null;
}

/** The first plausible phone number: 9 to 15 digits, kept as digits, spaces and a leading "+". */
export function findPhone(text: string): string | null {
  for (const match of text.matchAll(PHONE_RE)) {
    const raw = match[0].trim();
    const digits = raw.replace(/\D/g, "");
    if (digits.length < 9 || digits.length > 15) continue;
    // A year range ("2019 - 2021 2023") or a date, not a number to call.
    if (/^(?:19|20)\d{2}\b/.test(raw) && !/^\+|^00/.test(raw)) continue;
    const cleaned = raw
      .replace(/^00/, "+")
      .replace(/[^\d+]/g, " ")
      .replace(/(?!^)\+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (cleaned) return cleaned.slice(0, 40);
  }
  return null;
}

/** The first line of 2..5 words (letters only) within the first 12 non-empty lines. */
export function findName(text: string): string | null {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, 12);
  for (const line of lines) {
    if (line.length > 60 || /[\d@]/.test(line)) continue;
    const words = line.split(/\s+/);
    if (words.length < 2 || words.length > 5) continue;
    if (!words.every((word) => NAME_WORD_RE.test(word))) continue;
    if (NOT_A_NAME_RE.test(line)) continue;
    return words.join(" ");
  }
  return null;
}

/** The file name without its extension, separators as spaces, "cv"-like tokens dropped. */
export function nameFromFileName(fileName: string): string | null {
  const base = fileName.replace(/\.[A-Za-z0-9]{1,5}$/, "");
  const words = base
    .replace(/[_\-.+()[\]]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter((word) => word.length > 0 && !/^(?:cv|resume|r[ée]sum[ée]|curriculum|vitae)$/i.test(word));
  const name = words.join(" ").trim();
  return name.length >= 2 ? name.slice(0, 120) : null;
}

export function heuristicProfile(text: string, fileName: string): Profile {
  const profile = emptyProfile();
  const email = findEmail(text);
  const phone = findPhone(text);
  const name = findName(text) ?? nameFromFileName(fileName);
  profile.email = email;
  profile.phone = phone;
  profile.full_name = name;
  const confidence: ConfidenceMap = {};
  if (email) confidence.email = 0.9;
  if (phone) confidence.phone = 0.6;
  if (name) confidence.full_name = 0.3;
  profile.confidence = confidence;
  return profile;
}

// ---------------------------------------------------------------------
// (2) model profile: one JSON completion, validated
// ---------------------------------------------------------------------

/** What the model reads: the start of the CV, where the identity and the latest positions are. */
export const MODEL_INPUT_CHARS = 14_000;

export const STRUCTURE_SYSTEM_PROMPT = `You extract a structured profile from the text of one document that should be a CV (résumé). Answer with a single JSON object and nothing else.

First say what the document is:
- "document_kind": "cv" when the text presents one person's professional background: identity or contact details together with experiences, education or skills. "other" for a cover letter alone, a diploma or certificate, an identity document, an invoice, a job offer, a company brochure, a form, a list of several people, or text that is not about a person.
- "kind_reason": one short sentence saying why.
- When the document is "other", still fill the profile fields with what the text states (they may stay null or empty).

Rules:
- Extract ONLY what is written in the text. Never guess, infer or complete a field. When a field is not stated, answer null (or an empty list).
- Give a "confidence" object with a number from 0 to 1 per field you filled (keys: full_name, email, phone, headline, location, years_experience, availability, summary, skills, languages, experiences, education). Omit the key of a field you did not read.
- "summary": 2 to 3 factual sentences in the CV's own language, restating what the CV says (role, domain, seniority); no opinion, no praise.
- "headline": the current or most recent title as written, or null.
- "location": the city or region as written, or null.
- "skills": the 8 to 20 skills that define the profile, from the most central to the least, as a recruiter would list them: domains of expertise, tools, methods, certifications. Never document names, never generic words like "communication", "teamwork" or "motivation" unless the CV insists on them. Short deduplicated labels, lowercase except acronyms and proper names (e.g. "gestion de projet", "SQL", "Excel").
- "languages": [{ "name", "level" }] with the CEFR level (A1..C2) when stated, "native" when stated as such, else the level as written or null.
- "experiences": newest first, [{ "title", "company", "start", "end", "description" }]; "start" and "end" are "YYYY-MM" or "YYYY" as written, null when unknown; an ongoing position ("present", "current", "aujourd'hui") has "end": null. Do not infer availability from an ongoing position: "availability" is only what the CV states (a date, a notice period, "immediate").
- "education": [{ "degree", "school", "year" }].
- "links": [{ "label", "url" }] for the URLs written in the CV (LinkedIn, GitHub, portfolio).
- "years_experience": a number only when the CV states it or it can be computed from dated experiences; else null.
- "tags": [].
- Do NOT extract or infer age, date of birth, gender, nationality, origin, photo, marital or family status, number of children, health or disability, religion, union membership or political opinions. If the CV states any of these, leave them out of every field, including the summary.

JSON shape:
{ "document_kind": "cv"|"other", "kind_reason": string, "full_name": string|null, "email": string|null, "phone": string|null, "headline": string|null, "location": string|null, "years_experience": number|null, "availability": string|null, "summary": string|null, "skills": string[], "languages": [{ "name": string, "level": string|null }], "experiences": [{ "title": string, "company": string|null, "start": string|null, "end": string|null, "description": string|null }], "education": [{ "degree": string, "school": string|null, "year": string|null }], "links": [{ "label": string, "url": string }], "tags": [], "confidence": { "<field>": number } }`;

const scalar = (max: number) =>
  z
    .union([z.string(), z.number(), z.null()])
    .optional()
    .transform((value): string | null => cleanString(value, max));

const list = z.array(z.unknown()).nullable().optional();

/** "other" only when the model says so; anything else, missing included, is a CV (a doubt never sets a document aside). */
export function toDocumentKind(value: unknown): DocumentKind {
  return typeof value === "string" && value.trim().toLowerCase() === "other" ? "other" : "cv";
}

/** The model's answer: scalars may be text, numbers or null; lists must be lists; the rest is normalised. */
export const ModelProfileSchema = z.object({
  document_kind: z.unknown().optional().transform((value): DocumentKind => toDocumentKind(value)),
  kind_reason: scalar(300),
  full_name: scalar(160),
  email: scalar(254),
  phone: scalar(40),
  headline: scalar(200),
  location: scalar(160),
  years_experience: z
    .union([z.number(), z.string(), z.null()])
    .optional()
    .transform((value): number | null => normaliseYears(value)),
  availability: scalar(200),
  summary: scalar(1500),
  skills: list.transform((items): string[] => toSkills(items)),
  languages: list.transform((items): CandidateLanguage[] => toLanguages(items)),
  experiences: list.transform((items): CandidateExperience[] => toExperiences(items)),
  education: list.transform((items): CandidateEducation[] => toEducation(items)),
  links: list.transform((items): CandidateLink[] => toLinks(items)),
  tags: list.transform((items): string[] => toTags(items)),
  confidence: z
    .record(z.string(), z.unknown())
    .nullable()
    .optional()
    .transform((value): ConfidenceMap => toConfidence(value)),
});

export type ModelProfile = z.output<typeof ModelProfileSchema>;

/** What the model said the document is, next to the profile it read. */
export interface DocumentClassification {
  kind: DocumentKind;
  /** The model's one sentence; logged, never stored on the row. */
  reason: string | null;
}

export interface StructuredAnswer {
  profile: Profile;
  usage: Usage;
  classification: DocumentClassification;
}

export function classificationOfModelAnswer(value: ModelProfile): DocumentClassification {
  return { kind: value.document_kind, reason: value.kind_reason };
}

export function profileOfModelAnswer(value: ModelProfile): Profile {
  return {
    full_name: value.full_name,
    email: value.email,
    phone: value.phone,
    headline: value.headline,
    location: value.location,
    years_experience: value.years_experience,
    availability: value.availability,
    summary: value.summary,
    skills: value.skills,
    languages: value.languages,
    experiences: value.experiences,
    education: value.education,
    links: value.links,
    tags: value.tags,
    confidence: value.confidence,
  };
}

export async function modelProfile(text: string, config: ModelConfig): Promise<StructuredAnswer> {
  const input =
    text.length > MODEL_INPUT_CHARS
      ? `${text.slice(0, MODEL_INPUT_CHARS)}\n\n[text truncated]`
      : text;
  const answer = await completeJson({
    system: STRUCTURE_SYSTEM_PROMPT,
    user: `CV text:\n\n${input}`,
    schema: ModelProfileSchema,
    temperature: 0.1,
    maxTokens: 3000,
    config,
  });
  return {
    profile: profileOfModelAnswer(answer.value),
    usage: answer.usage,
    classification: classificationOfModelAnswer(answer.value),
  };
}

/**
 * The model may leave an email or a phone null that a regex finds written
 * in the text: both are literally in the CV, so they are filled in with
 * the heuristic's confidence, never above the model's own reading.
 */
export function backfillContacts(profile: Profile, heuristic: Profile): Profile {
  const next: Profile = { ...profile, confidence: { ...profile.confidence } };
  if (!next.email && heuristic.email) {
    next.email = heuristic.email;
    next.confidence.email = heuristic.confidence.email ?? 0.5;
  }
  if (!next.phone && heuristic.phone) {
    next.phone = heuristic.phone;
    next.confidence.phone = heuristic.confidence.phone ?? 0.5;
  }
  return next;
}

// ---------------------------------------------------------------------
// (3) fingerprint, (4) search text, (5) embedding text
// ---------------------------------------------------------------------

/** NFD, diacritics stripped, lowercase, punctuation as spaces, spaces collapsed. */
export function normaliseName(name: string | null | undefined): string {
  if (!name) return "";
  return name
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Fewer phone digits than this make no key: a partial number is not a number. */
const FINGERPRINT_MIN_PHONE_DIGITS = 6;

/**
 * The organisation that anchors a name when there is no contact detail:
 * the latest experience's company (the model answers newest first), else
 * the first school; normalised like a name.
 */
export function anchorOrganisationOf(
  profile: Pick<Profile, "experiences" | "education">,
): string | null {
  const company = normaliseName(profile.experiences[0]?.company);
  if (company) return company;
  const school = normaliseName(profile.education[0]?.school);
  return school || null;
}

/**
 * The dedup key: the email, else name + phone digits, else name + the
 * company of the latest experience (or the first school), else null. A
 * name alone never makes a key: two people may share one, and no key
 * means no merge.
 */
export function fingerprintOf(
  profile: Pick<Profile, "email" | "full_name" | "phone" | "experiences" | "education">,
): string | null {
  const email = profile.email?.trim().toLowerCase() ?? "";
  if (email) return email.slice(0, 254);
  const name = normaliseName(profile.full_name);
  if (!name) return null;
  const digits = (profile.phone ?? "").replace(/\D/g, "");
  if (digits.length >= FINGERPRINT_MIN_PHONE_DIGITS) return `${name}|${digits}`;
  const organisation = anchorOrganisationOf(profile);
  if (organisation) return `${name}|${organisation}`;
  return null;
}

export const SEARCH_TEXT_MAX = 50_000;

/** Everything the full-text index reads, each part once, one per line. */
export function searchTextOf(profile: Profile): string {
  const parts: string[] = [];
  const push = (value: string | null | undefined) => {
    const trimmed = value?.trim();
    if (trimmed) parts.push(trimmed);
  };
  push(profile.full_name);
  push(profile.headline);
  push(profile.location);
  push(profile.summary);
  for (const skill of profile.skills) push(skill);
  for (const language of profile.languages) push(language.name);
  for (const experience of profile.experiences) {
    push(experience.title);
    push(experience.company);
    push(experience.description);
  }
  for (const education of profile.education) {
    push(education.degree);
    push(education.school);
  }
  for (const tag of profile.tags) push(tag);
  return dedupeLabels(parts, 5000).join("\n").slice(0, SEARCH_TEXT_MAX);
}

export const EMBEDDING_TEXT_MAX = 4_000;

/** A compact text for the embedding: headline, summary, skills, positions, location. */
export function embeddingTextOf(profile: Profile): string {
  const lines: string[] = [];
  if (profile.headline) lines.push(profile.headline);
  if (profile.summary) lines.push(profile.summary);
  if (profile.skills.length) lines.push(`Skills: ${profile.skills.join(", ")}`);
  for (const experience of profile.experiences.slice(0, 15)) {
    lines.push(experience.company ? `${experience.title} — ${experience.company}` : experience.title);
  }
  if (profile.location) lines.push(profile.location);
  return lines.join("\n").slice(0, EMBEDDING_TEXT_MAX);
}

// ---------------------------------------------------------------------
// (6) merge into an existing candidate
// ---------------------------------------------------------------------

export function profileOfRow(row: CandidateRow): Profile {
  return {
    full_name: row.full_name,
    email: row.email,
    phone: row.phone,
    headline: row.headline,
    location: row.location,
    years_experience: row.years_experience === null ? null : normaliseYears(row.years_experience),
    availability: row.availability,
    summary: row.summary,
    skills: Array.isArray(row.skills) ? row.skills : [],
    languages: Array.isArray(row.languages) ? row.languages : [],
    experiences: Array.isArray(row.experiences) ? row.experiences : [],
    education: Array.isArray(row.education) ? row.education : [],
    links: Array.isArray(row.links) ? row.links : [],
    tags: Array.isArray(row.tags) ? row.tags : [],
    confidence: row.confidence && typeof row.confidence === "object" ? row.confidence : {},
  };
}

/** Replace a scalar only when nothing is there, or the new reading is sure (>= 0.7) and at least as sure. */
const REPLACE_THRESHOLD = 0.7;

function chooseScalar<K extends ScalarField>(field: K, existing: Profile, incoming: Profile): Profile[K] {
  const current = existing[field];
  const next = incoming[field];
  if (next === null) return current;
  if (current === null) return next;
  const incomingConfidence = incoming.confidence[field] ?? 0;
  const existingConfidence = existing.confidence[field] ?? 0;
  return incomingConfidence >= REPLACE_THRESHOLD && incomingConfidence >= existingConfidence
    ? next
    : current;
}

type ListField = "experiences" | "education" | "languages";

function chooseList<F extends ListField>(field: F, existing: Profile, incoming: Profile): Profile[F] {
  if (incoming[field].length === 0) return existing[field];
  if (existing[field].length === 0) return incoming[field];
  return (incoming.confidence[field] ?? 0) >= (existing.confidence[field] ?? 0)
    ? incoming[field]
    : existing[field];
}

function unionLinks(existing: CandidateLink[], incoming: CandidateLink[]): CandidateLink[] {
  const seen = new Set<string>();
  const out: CandidateLink[] = [];
  for (const link of [...existing, ...incoming]) {
    const key = link.url.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(link);
  }
  return out.slice(0, 20);
}

export function mergeProfiles(existing: Profile, incoming: Profile): Profile {
  const confidence: ConfidenceMap = {};
  for (const field of CONFIDENCE_FIELDS as readonly ConfidenceField[]) {
    const a = existing.confidence[field];
    const b = incoming.confidence[field];
    if (a === undefined && b === undefined) continue;
    confidence[field] = Math.max(a ?? 0, b ?? 0);
  }
  return {
    full_name: chooseScalar("full_name", existing, incoming),
    email: chooseScalar("email", existing, incoming),
    phone: chooseScalar("phone", existing, incoming),
    headline: chooseScalar("headline", existing, incoming),
    location: chooseScalar("location", existing, incoming),
    years_experience: chooseScalar("years_experience", existing, incoming),
    availability: chooseScalar("availability", existing, incoming),
    summary: chooseScalar("summary", existing, incoming),
    skills: dedupeLabels([...existing.skills, ...incoming.skills], 150),
    languages: chooseList("languages", existing, incoming),
    experiences: chooseList("experiences", existing, incoming),
    education: chooseList("education", existing, incoming),
    links: unionLinks(existing.links, incoming.links),
    tags: dedupeLabels([...existing.tags, ...incoming.tags], 50),
    confidence,
  };
}
