/**
 * The items of a presentation before the team edits them, built here so
 * they can be read and tested without the database or the model: the
 * plain draft from the profiles (name, headline, summary, top skills as
 * strengths, no attention point, the latest processed CV), the system
 * prompt and compact payload of the one model call that drafts the
 * summaries, the schema of its answer and the merge back into the
 * draft, and the clean-up every item goes through before it is stored.
 */
import { z } from "zod";

import type { BriefCriterion, CandidateRow, Locale, ShareItem } from "@/lib/db/types";

export const SHARE_ITEMS_MAX = 30;
export const NAME_MAX = 200;
export const HEADLINE_MAX = 300;
export const SUMMARY_MAX = 1500;
export const POINT_MAX = 300;
/** The most points one list keeps after clean-up (the server refuses more). */
export const POINTS_MAX = 8;
/** Skills copied into strengths when no model drafts them. */
export const STRENGTHS_FROM_SKILLS = 5;
export const MODEL_STRENGTHS_MAX = 4;
export const MODEL_ATTENTION_MAX = 3;

export const FALLBACK_NAME: Record<Locale, string> = { fr: "Candidat", en: "Candidate" };

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

function clip(value: string | null | undefined, max: number): string {
  return (value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function cleanPoints(points: readonly string[] | null | undefined, max: number): string[] {
  const out: string[] = [];
  for (const point of points ?? []) {
    const text = clip(point, POINT_MAX);
    if (text && !out.includes(text)) out.push(text);
    if (out.length >= max) break;
  }
  return out;
}

/** One item from a profile alone: what the CV said, nothing drafted. */
export function plainItem(candidate: DraftCandidate, documentId: string | null, locale: Locale): ShareItem {
  const headline = clip(candidate.headline, HEADLINE_MAX);
  return {
    candidateId: candidate.id,
    name: clip(candidate.full_name, NAME_MAX) || FALLBACK_NAME[locale],
    headline: headline || null,
    summary: clip(candidate.summary, SUMMARY_MAX),
    strengths: cleanPoints(candidate.skills, STRENGTHS_FROM_SKILLS),
    attention: [],
    documentId,
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

export function plainDraft(
  candidates: readonly DraftCandidate[],
  documents: Map<string, string>,
  locale: Locale,
): ShareItem[] {
  return candidates.slice(0, SHARE_ITEMS_MAX).map((candidate) => plainItem(candidate, documents.get(candidate.id) ?? null, locale));
}

// ---------------------------------------------------------------------
// the model's draft
// ---------------------------------------------------------------------

export interface DraftBrief {
  title: string;
  description: string;
  criteria: BriefCriterion[];
}

const LANGUAGE: Record<Locale, string> = { fr: "French", en: "English" };

export function summarySystemPrompt(locale: Locale): string {
  return [
    "You write, for a hiring manager, a short factual presentation of each candidate profile an HR team selected for a job brief. The team selected them and decides; you only describe.",
    'Answer with JSON only: {"items":[{"candidateId":"...","summary":"...","strengths":["..."],"attention":["..."]}]}, one entry per candidate given, with the candidateId exactly as given.',
    "Rules:",
    `- summary: two or three factual sentences in ${LANGUAGE[locale]} stating what the profile says that relates to the brief.`,
    `- strengths: up to ${MODEL_STRENGTHS_MAX} short factual points taken from the profile (skills, experience, languages, location, availability) that answer the brief.`,
    `- attention: up to ${MODEL_ATTENTION_MAX} short factual points on what the brief asks that the profile does not state or does not meet; say that the CV does not state it when it is silent, never treat silence as a lack.`,
    "- Rest only on the profile given. No praise, no speculation, no advice, no ranking between candidates, no recommendation to hire or reject, nothing the profile does not say.",
    "- Never mention or infer age, gender, origin, nationality, family situation, health, religion, politics or any other protected characteristic.",
    "- Plain sentences, no markdown, at most 500 characters per summary and 120 per point.",
  ].join("\n");
}

const DESCRIPTION_MAX = 3000;
const PROFILE_SUMMARY_MAX = 800;
const SKILLS_MAX = 30;
const LANGUAGES_MAX = 10;

export interface SummaryPayload {
  brief: { title: string; description: string; criteria: { label: string; value: string; required: boolean; weight: number }[] };
  candidates: Record<string, unknown>[];
}

/** Compact profiles: only the fields the CV gave, so the model cannot invent the rest. */
export function summaryPayload(brief: DraftBrief, candidates: readonly DraftCandidate[]): SummaryPayload {
  return {
    brief: {
      title: brief.title,
      description: clip(brief.description, DESCRIPTION_MAX),
      criteria: (brief.criteria ?? []).map((c) => ({ label: c.label, value: c.value, required: c.required, weight: c.weight })),
    },
    candidates: candidates.map((candidate) => {
      const profile: Record<string, unknown> = { candidateId: candidate.id };
      const headline = clip(candidate.headline, HEADLINE_MAX);
      if (headline) profile["headline"] = headline;
      const summary = clip(candidate.summary, PROFILE_SUMMARY_MAX);
      if (summary) profile["summary"] = summary;
      const skills = cleanPoints(candidate.skills, SKILLS_MAX);
      if (skills.length) profile["skills"] = skills;
      const languages = (candidate.languages ?? [])
        .map((l) => (l.level ? `${l.name} (${l.level})` : l.name))
        .filter((l) => l.trim().length > 0)
        .slice(0, LANGUAGES_MAX);
      if (languages.length) profile["languages"] = languages;
      const location = clip(candidate.location, 200);
      if (location) profile["location"] = location;
      if (typeof candidate.years_experience === "number") profile["yearsExperience"] = candidate.years_experience;
      const availability = clip(candidate.availability, 200);
      if (availability) profile["availability"] = availability;
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

export type SummaryAnswer = z.infer<typeof summaryAnswer>;

/** The tokens the answer may need: a short block per candidate, bounded. */
export function summaryMaxTokens(candidateCount: number): number {
  return Math.min(8000, 600 + 260 * Math.max(1, candidateCount));
}

/**
 * The model's words written into the draft, per candidate it answered
 * for: a non-empty summary replaces the profile's, non-empty strengths
 * replace the skills, attention points are taken as given. An item the
 * model skipped keeps its plain draft.
 */
export function mergeDraft(items: readonly ShareItem[], answer: SummaryAnswer): ShareItem[] {
  const byId = new Map(answer.items.map((item) => [item.candidateId, item]));
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

/** Trimmed, clipped, empty points dropped, nameless items dropped; what gets stored. */
export function cleanItems(items: readonly ShareItem[]): ShareItem[] {
  return items
    .slice(0, SHARE_ITEMS_MAX)
    .map((item) => {
      const headline = clip(item.headline, HEADLINE_MAX);
      return {
        candidateId: item.candidateId,
        name: clip(item.name, NAME_MAX),
        headline: headline || null,
        summary: item.summary.trim().slice(0, SUMMARY_MAX),
        strengths: cleanPoints(item.strengths, POINTS_MAX),
        attention: cleanPoints(item.attention, POINTS_MAX),
        documentId: item.documentId,
      };
    })
    .filter((item) => item.name.length > 0);
}
