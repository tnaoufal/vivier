/**
 * The sheets of a dossier before the team edits them, built here so they
 * can be read and tested without the database or the model: the plain
 * draft from the profiles and the analysis the team saw on the shortlist
 * (the requirement table from the assessment or the deterministic
 * verdicts, the score and the decision, strengths and points of
 * attention read off that table), the snapshot of the brief the cover
 * shows, the system prompt and compact payload of the one model call
 * that refines the summaries, the schema of its answer and the merge
 * back into the draft (never into the requirement table), and the
 * clean-up every item goes through before it is stored.
 */
import { z } from "zod";

import { parseCriteria } from "@/lib/briefs/criteria";
import type {
  AssessmentDecision,
  BriefCriterion,
  CandidateLanguage,
  CandidateRow,
  CriterionResult,
  CriterionVerdict,
  Locale,
  MatchResult,
  RequirementAssessment,
  RequirementMet,
  ShareBrief,
  ShareItem,
  ShareRequirement,
} from "@/lib/db/types";

export const SHARE_ITEMS_MAX = 30;
export const NAME_MAX = 200;
export const HEADLINE_MAX = 300;
export const SUMMARY_MAX = 1500;
export const POINT_MAX = 300;
/** The most points one list keeps after clean-up (the server refuses more). */
export const POINTS_MAX = 8;
/** Requirements met copied into strengths, and not met into attention points, when no model drafts them. */
export const STRENGTHS_FROM_REQUIREMENTS = 5;
export const ATTENTION_FROM_REQUIREMENTS = 5;
/** Skills copied into strengths when the shortlist holds no analysis at all. */
export const STRENGTHS_FROM_SKILLS = 5;
/** An evidence this short is written after the label of an attention point. */
export const EVIDENCE_IN_POINT_MAX = 90;
export const MODEL_STRENGTHS_MAX = 4;
export const MODEL_ATTENTION_MAX = 3;
export const LOCATION_MAX = 200;
export const AVAILABILITY_MAX = 200;
export const YEARS_MAX = 80;
/** The skills a sheet shows, and the most the server accepts. */
export const SKILLS_SHOWN = 8;
export const SKILLS_MAX = 12;
export const SKILL_MAX = 60;
export const LANGUAGES_MAX = 10;
export const LANGUAGE_MAX = 60;
export const REQUIREMENTS_MAX = 40;
export const REQUIREMENT_LABEL_MAX = 160;
export const EVIDENCE_MAX = 200;
export const BRIEF_TITLE_MAX = 200;
export const BRIEF_SUMMARY_MAX = 1500;

export const FALLBACK_NAME: Record<Locale, string> = { fr: "Candidat", en: "Candidate" };

/** Tuples, so the server's schema (z.enum) reads them as literals. */
export const MET_VALUES = ["yes", "partial", "no", "unknown"] as const satisfies readonly RequirementMet[];
export const DECISIONS = ["fit", "borderline", "no_fit"] as const satisfies readonly AssessmentDecision[];

export function isMet(value: unknown): value is RequirementMet {
  return typeof value === "string" && (MET_VALUES as readonly string[]).includes(value);
}

export function isDecision(value: unknown): value is AssessmentDecision {
  return typeof value === "string" && (DECISIONS as readonly string[]).includes(value);
}

export const DRAFT_COLUMNS =
  "id,org_id,full_name,headline,summary,skills,languages,location,years_experience,availability";

export type DraftCandidate = Pick<
  CandidateRow,
  | "id"
  | "full_name"
  | "headline"
  | "summary"
  | "skills"
  | "languages"
  | "location"
  | "years_experience"
  | "availability"
>;

/** What the shortlist knows of a candidate: the match the team saw when it ran the analysis. */
export interface MatchPick {
  candidate_id: string;
  match: MatchResult | null;
}

export const MATCH_COLUMNS = "candidate_id,match";

/** Each value once, in the order first seen. */
export function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

/** Blanks collapsed, trimmed, cut at `max`; anything that is not a string reads as empty, so a malformed stored row never throws. */
function clip(value: string | null | undefined, max: number): string {
  return (typeof value === "string" ? value : "").replace(/\s+/g, " ").trim().slice(0, max);
}

/** Like clip, but paragraphs survive: runs of blanks collapse, blank lines stay. */
function clipText(value: string | null | undefined, max: number): string {
  return (value ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[^\S\n]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, max);
}

function cleanPoints(points: readonly string[] | null | undefined, max: number, each: number = POINT_MAX): string[] {
  const out: string[] = [];
  for (const point of points ?? []) {
    const text = clip(point, each);
    if (text && !out.includes(text)) out.push(text);
    if (out.length >= max) break;
  }
  return out;
}

/** A whole number of years 0..80, or null when the CV gave none. */
function cleanYears(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(YEARS_MAX, Math.round(value)));
}

/** A whole score 0..100, or null when no model assessed the profile. */
export function cleanScore(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, Math.round(value)));
}

/** "Anglais (C1)", "Français (native)", or the name alone. */
export function languageLabel(language: CandidateLanguage): string {
  const name = clip(language.name, LANGUAGE_MAX);
  const level = clip(language.level, 40);
  if (!name) return "";
  return level ? `${name} (${level})` : name;
}

export function languageLabels(languages: readonly CandidateLanguage[] | null | undefined, max: number = LANGUAGES_MAX): string[] {
  return cleanPoints((languages ?? []).map(languageLabel), max, LANGUAGE_MAX);
}

// ---------------------------------------------------------------------
// the requirement table
// ---------------------------------------------------------------------

const VERDICT_TO_MET: Record<CriterionVerdict, RequirementMet> = {
  match: "yes",
  partial: "partial",
  missing: "no",
  not_stated: "unknown",
};

const VERDICTS = ["match", "partial", "missing", "not_stated"] as const satisfies readonly CriterionVerdict[];

function isVerdict(value: unknown): value is CriterionVerdict {
  return typeof value === "string" && (VERDICTS as readonly string[]).includes(value);
}

/** A verdict the schema does not know is not read as a lack. */
function verdictToMet(value: unknown): RequirementMet {
  return isVerdict(value) ? VERDICT_TO_MET[value] : "unknown";
}

function cleanEvidence(value: unknown): string | null {
  const text = typeof value === "string" ? clip(value, EVIDENCE_MAX) : "";
  return text || null;
}

/**
 * The stored JSON read as an array, else nothing: the match column is
 * trusted nowhere, so one malformed row costs that candidate its table,
 * never the whole dossier.
 */
function asArray<T>(value: readonly T[] | null | undefined): readonly T[] {
  return Array.isArray(value) ? value : [];
}

/** The rows keyed by criterion, the first one per criterion kept, rows without a criterion id dropped. */
function byCriterion<T extends { criterionId: string }>(rows: readonly T[]): Map<string, T> {
  const map = new Map<string, T>();
  for (const row of rows) {
    if (row && typeof row.criterionId === "string" && !map.has(row.criterionId)) map.set(row.criterionId, row);
  }
  return map;
}

/**
 * One row per criterion the analysis checked, read the way the
 * shortlist board reads it (lib/shortlists/requirements.ts) so the
 * dossier never disagrees with what the team saw. The criteria are the
 * match's own when it carries them (the search's, as they were when the
 * analysis ran), else the brief's as given; a criterion neither the
 * assessment nor the verdicts speak about was never checked and gets no
 * row (a "not stated" would read as the CV's silence, which it is not).
 * Each row is the assessment's answer when the model gave one, else the
 * deterministic verdict (found → yes, in part → partial, absent → no,
 * not stated → unknown). A criterion with neither label nor value is
 * left out, as the cover leaves it out. Nothing at all when neither the
 * assessment nor the verdicts say anything: the dossier then says so
 * instead of showing an empty table.
 */
export function requirementsOf(criteria: readonly BriefCriterion[], match: MatchResult | null | undefined): ShareRequirement[] {
  if (!match) return [];
  const assessed = byCriterion<RequirementAssessment>(asArray(match.assessment?.requirements));
  const verdicts = byCriterion<CriterionResult>(asArray(match.verdicts));
  if (!assessed.size && !verdicts.size) return [];
  const own = parseCriteria(match.criteria);
  return (own.length ? own : criteria)
    .flatMap((criterion): ShareRequirement[] => {
      const label = clip(criterion.label, REQUIREMENT_LABEL_MAX) || clip(criterion.value, REQUIREMENT_LABEL_MAX);
      const required = criterion.required === true;
      const answer = assessed.get(criterion.id);
      if (answer) {
        return [{ label, required, met: isMet(answer.met) ? answer.met : "unknown", evidence: cleanEvidence(answer.evidence) }];
      }
      const verdict = verdicts.get(criterion.id);
      if (!verdict) return [];
      return [{ label, required, met: verdictToMet(verdict.verdict), evidence: cleanEvidence(verdict.evidence) }];
    })
    .filter((row) => row.label.length > 0)
    .slice(0, REQUIREMENTS_MAX);
}

/** The labels of the requirements met, the brief's order, up to `max`. */
export function strengthsFrom(requirements: readonly ShareRequirement[], max: number = STRENGTHS_FROM_REQUIREMENTS): string[] {
  return cleanPoints(
    requirements.filter((row) => row.met === "yes").map((row) => row.label),
    max,
  );
}

/**
 * The requirements not met, then those met in part, as points: the
 * label, with the evidence after a dash when it is short enough to read
 * as one line. A requirement the CV says nothing about is never a point:
 * silence is not a lack, and the table already says "not stated".
 */
export function attentionFrom(requirements: readonly ShareRequirement[], max: number = ATTENTION_FROM_REQUIREMENTS): string[] {
  const point = (row: ShareRequirement) =>
    row.evidence && row.evidence.length <= EVIDENCE_IN_POINT_MAX ? `${row.label} — ${row.evidence}` : row.label;
  return cleanPoints(
    [...requirements.filter((row) => row.met === "no"), ...requirements.filter((row) => row.met === "partial")].map(point),
    max,
  );
}

/** How many of the rows are met outright, for the overview's "6 / 8". */
export function metCount(requirements: readonly ShareRequirement[]): number {
  return requirements.filter((row) => row.met === "yes").length;
}

// ---------------------------------------------------------------------
// the plain draft
// ---------------------------------------------------------------------

export interface ItemSource {
  candidate: DraftCandidate;
  /** The latest processed CV of the candidate, null when none. */
  documentId: string | null;
  /** The shortlist's match for the candidate, null when the analysis never ran. */
  match: MatchResult | null;
}

/**
 * One sheet from the profile and the analysis alone, nothing drafted:
 * the facts the CV states, the requirement table, the score and the
 * decision when a model assessed the profile, the synthesis as the
 * board shows it (the assessment's summary, else the search's reading
 * of the match, else the profile's own summary), strengths and
 * attention points read off the table (the first skills as strengths
 * only when there is no table at all).
 */
export function plainItem(source: ItemSource, criteria: readonly BriefCriterion[], locale: Locale): ShareItem {
  const { candidate, match } = source;
  const headline = clip(candidate.headline, HEADLINE_MAX);
  const location = clip(candidate.location, LOCATION_MAX);
  const availability = clip(candidate.availability, AVAILABILITY_MAX);
  const assessment = match?.assessment;
  const requirements = requirementsOf(criteria, match);
  const summary =
    clip(assessment?.summary, SUMMARY_MAX) || clip(match?.why, SUMMARY_MAX) || clip(candidate.summary, SUMMARY_MAX);
  return {
    candidateId: candidate.id,
    name: clip(candidate.full_name, NAME_MAX) || FALLBACK_NAME[locale],
    headline: headline || null,
    location: location || null,
    yearsExperience: cleanYears(candidate.years_experience),
    availability: availability || null,
    skills: cleanPoints(candidate.skills, SKILLS_SHOWN, SKILL_MAX),
    languages: languageLabels(candidate.languages),
    summary,
    strengths: requirements.length ? strengthsFrom(requirements) : cleanPoints(candidate.skills, STRENGTHS_FROM_SKILLS, SKILL_MAX),
    attention: attentionFrom(requirements),
    score: assessment ? cleanScore(assessment.score) : null,
    decision: assessment && isDecision(assessment.decision) ? assessment.decision : null,
    requirements,
    documentId: source.documentId,
  };
}

/** The rows in the order the ids were given, each once, unknown ids skipped. */
export function orderedCandidates<T extends { id: string }>(ids: readonly string[], rows: readonly T[]): T[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const out: T[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    const row = byId.get(id);
    if (row && !seen.has(id)) {
      seen.add(id);
      out.push(row);
    }
  }
  return out;
}

export interface DocumentPick {
  id: string;
  candidate_id: string | null;
}

/** Rows come newest first; the first one per candidate wins. */
export function latestDocumentByCandidate(rows: readonly DocumentPick[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of rows) {
    if (row.candidate_id && !map.has(row.candidate_id)) map.set(row.candidate_id, row.id);
  }
  return map;
}

/** The match per candidate; a candidate on the shortlist twice keeps the first row's. */
export function matchByCandidate(rows: readonly MatchPick[]): Map<string, MatchResult | null> {
  const map = new Map<string, MatchResult | null>();
  for (const row of rows) {
    if (!map.has(row.candidate_id)) map.set(row.candidate_id, row.match ?? null);
  }
  return map;
}

export function plainDraft(
  candidates: readonly DraftCandidate[],
  documents: Map<string, string>,
  matches: Map<string, MatchResult | null>,
  criteria: readonly BriefCriterion[],
  locale: Locale,
): ShareItem[] {
  return candidates.slice(0, SHARE_ITEMS_MAX).map((candidate) =>
    plainItem(
      { candidate, documentId: documents.get(candidate.id) ?? null, match: matches.get(candidate.id) ?? null },
      criteria,
      locale,
    ),
  );
}

// ---------------------------------------------------------------------
// the brief's snapshot
// ---------------------------------------------------------------------

export interface DraftBrief {
  title: string;
  description: string;
  criteria: BriefCriterion[];
}

/** The brief as the cover shows it, frozen at creation: the title, the description clipped, the requirements. */
export function briefSnapshot(brief: DraftBrief): ShareBrief {
  return {
    title: clip(brief.title, BRIEF_TITLE_MAX),
    summary: clipText(brief.description, BRIEF_SUMMARY_MAX),
    requirements: (brief.criteria ?? [])
      .map((criterion) => ({
        label: clip(criterion.label, REQUIREMENT_LABEL_MAX) || clip(criterion.value, REQUIREMENT_LABEL_MAX),
        required: criterion.required === true,
      }))
      .filter((row) => row.label.length > 0)
      .slice(0, REQUIREMENTS_MAX),
  };
}

// ---------------------------------------------------------------------
// the model's draft
// ---------------------------------------------------------------------

const LANGUAGE: Record<Locale, string> = { fr: "French", en: "English" };

export function summarySystemPrompt(locale: Locale): string {
  return [
    "You write, for a hiring manager, a short factual presentation of each candidate profile an HR team selected for a job brief. The team selected them and decides; you only describe.",
    'Answer with JSON only: {"items":[{"candidateId":"...","summary":"...","strengths":["..."],"attention":["..."]}]}, one entry per candidate given, with the candidateId exactly as given.',
    "Rules:",
    `- summary: two or three factual sentences in ${LANGUAGE[locale]} stating what the profile says that relates to the brief.`,
    `- strengths: up to ${MODEL_STRENGTHS_MAX} short factual points taken from the profile (skills, experience, languages, location, availability) that answer the brief.`,
    `- attention: up to ${MODEL_ATTENTION_MAX} short factual points on what the brief asks that the profile does not state or does not meet; say that the CV does not state it when it is silent, never treat silence as a lack.`,
    "- When a candidate comes with an assessment (decision, score, requirements with met/partial/no/unknown and the evidence quoted from the CV), rest on it: the requirement table is fixed and is shown as is; your sentences must agree with it, never contradict it, never restate it row by row.",
    "- Rest only on the profile and the assessment given. No praise, no speculation, no advice, no ranking between candidates, no recommendation to hire or reject, nothing the profile does not say.",
    "- Never mention or infer age, gender, origin, nationality, family situation, health, religion, politics or any other protected characteristic.",
    "- Plain sentences, no markdown, at most 500 characters per summary and 120 per point.",
  ].join("\n");
}

const DESCRIPTION_MAX = 3000;
const PROFILE_SUMMARY_MAX = 800;
const PAYLOAD_SKILLS_MAX = 30;
const PAYLOAD_LANGUAGES_MAX = 10;

export interface SummaryPayload {
  brief: {
    title: string;
    description: string;
    requirements: { label: string; value: string; required: boolean; weight: number }[];
  };
  candidates: Record<string, unknown>[];
}

/**
 * Compact profiles: only the fields the CV gave, so the model cannot
 * invent the rest, and the assessment the team saw (with the
 * requirements named by their label) for the candidates that have one.
 */
export function summaryPayload(
  brief: DraftBrief,
  candidates: readonly DraftCandidate[],
  matches: Map<string, MatchResult | null> = new Map(),
): SummaryPayload {
  const criteria = brief.criteria ?? [];
  return {
    brief: {
      title: brief.title,
      description: clip(brief.description, DESCRIPTION_MAX),
      requirements: criteria.map((c) => ({ label: c.label, value: c.value, required: c.required, weight: c.weight })),
    },
    candidates: candidates.map((candidate) => {
      const profile: Record<string, unknown> = { candidateId: candidate.id };
      const headline = clip(candidate.headline, HEADLINE_MAX);
      if (headline) profile["headline"] = headline;
      const summary = clip(candidate.summary, PROFILE_SUMMARY_MAX);
      if (summary) profile["summary"] = summary;
      const skills = cleanPoints(candidate.skills, PAYLOAD_SKILLS_MAX);
      if (skills.length) profile["skills"] = skills;
      const languages = languageLabels(candidate.languages, PAYLOAD_LANGUAGES_MAX);
      if (languages.length) profile["languages"] = languages;
      const location = clip(candidate.location, LOCATION_MAX);
      if (location) profile["location"] = location;
      if (typeof candidate.years_experience === "number") profile["yearsExperience"] = candidate.years_experience;
      const availability = clip(candidate.availability, AVAILABILITY_MAX);
      if (availability) profile["availability"] = availability;
      const match = matches.get(candidate.id) ?? null;
      const assessment = match?.assessment;
      if (assessment) {
        profile["assessment"] = {
          decision: assessment.decision,
          score: assessment.score,
          summary: clip(assessment.summary, SUMMARY_MAX),
          requirements: requirementsOf(criteria, match),
        };
      }
      return profile;
    }),
  };
}

export const summaryAnswer = z.object({
  items: z
    .array(
      z.object({
        candidateId: z.string(),
        summary: z.string().default(""),
        strengths: z.array(z.string()).max(12).default([]),
        attention: z.array(z.string()).max(12).default([]),
      }),
    )
    .max(SHARE_ITEMS_MAX + 10),
});

/** What the schema lets through, spelled out so the merge reads without the schema's inference. */
export interface SummaryAnswer {
  items: { candidateId: string; summary: string; strengths: string[]; attention: string[] }[];
}

/** The tokens the answer may need: a short block per candidate, bounded. */
export function summaryMaxTokens(candidateCount: number): number {
  return Math.min(8000, 600 + 260 * Math.max(1, candidateCount));
}

/**
 * The model's words written into the draft, per candidate it answered
 * for: a non-empty summary replaces the draft's, non-empty strengths
 * replace the draft's, attention points are taken as given. Everything
 * else (the facts, the requirement table, the score, the decision) is
 * untouched: the model refines the prose, never the assessment. An item
 * the model skipped keeps its plain draft.
 */
export function mergeDraft(items: readonly ShareItem[], answer: SummaryAnswer): ShareItem[] {
  const byId = new Map(answer.items.map((item) => [item.candidateId, item] as const));
  return items.map((item) => {
    const drafted = byId.get(item.candidateId);
    if (!drafted) return item;
    const summary = clip(drafted.summary, SUMMARY_MAX);
    const strengths = cleanPoints(drafted.strengths, MODEL_STRENGTHS_MAX);
    const attention = cleanPoints(drafted.attention, MODEL_ATTENTION_MAX);
    return {
      ...item,
      summary: summary || item.summary,
      strengths: strengths.length ? strengths : item.strengths,
      attention,
    };
  });
}

/** The requirement rows clipped and guarded, malformed ones dropped; at most REQUIREMENTS_MAX. */
export function cleanRequirements(rows: readonly ShareRequirement[] | null | undefined): ShareRequirement[] {
  const out: ShareRequirement[] = [];
  for (const row of rows ?? []) {
    const label = clip(row.label, REQUIREMENT_LABEL_MAX);
    if (!label || !isMet(row.met)) continue;
    out.push({ label, required: row.required === true, met: row.met, evidence: cleanEvidence(row.evidence) });
    if (out.length >= REQUIREMENTS_MAX) break;
  }
  return out;
}

/** Trimmed, clipped, empty points dropped, nameless items dropped; what gets stored. */
export function cleanItems(items: readonly ShareItem[]): ShareItem[] {
  return items
    .slice(0, SHARE_ITEMS_MAX)
    .map((item) => {
      const headline = clip(item.headline, HEADLINE_MAX);
      const location = clip(item.location, LOCATION_MAX);
      const availability = clip(item.availability, AVAILABILITY_MAX);
      return {
        candidateId: item.candidateId,
        name: clip(item.name, NAME_MAX),
        headline: headline || null,
        location: location || null,
        yearsExperience: cleanYears(item.yearsExperience),
        availability: availability || null,
        skills: cleanPoints(item.skills, SKILLS_MAX, SKILL_MAX),
        languages: cleanPoints(item.languages, LANGUAGES_MAX, LANGUAGE_MAX),
        summary: item.summary.trim().slice(0, SUMMARY_MAX),
        strengths: cleanPoints(item.strengths, POINTS_MAX),
        attention: cleanPoints(item.attention, POINTS_MAX),
        score: cleanScore(item.score),
        decision: isDecision(item.decision) ? item.decision : null,
        requirements: cleanRequirements(item.requirements),
        documentId: item.documentId,
      };
    })
    .filter((item) => item.name.length > 0);
}
