/**
 * The profile form's state and its way back to a row: every field is a
 * string while it is edited, and becomes null (never a guess) when left
 * empty. Only the columns the browser may update are produced
 * (candidates UPDATE grant in the migration). Tested in draft.test.ts.
 */
import type { CandidateRow } from "@/lib/db/types";

export interface LanguageDraft {
  name: string;
  level: string;
}

export interface ExperienceDraft {
  title: string;
  company: string;
  start: string;
  end: string;
  description: string;
}

export interface EducationDraft {
  degree: string;
  school: string;
  year: string;
}

export interface LinkDraft {
  label: string;
  url: string;
}

export interface CandidateDraft {
  full_name: string;
  email: string;
  phone: string;
  headline: string;
  location: string;
  years_experience: string;
  availability: string;
  summary: string;
  languages: LanguageDraft[];
  experiences: ExperienceDraft[];
  education: EducationDraft[];
  links: LinkDraft[];
}

/** The columns the form saves; skills, tags, consent and status are saved on their own. */
export type CandidatePatch = Pick<
  CandidateRow,
  | "full_name"
  | "email"
  | "phone"
  | "headline"
  | "location"
  | "years_experience"
  | "availability"
  | "summary"
  | "languages"
  | "experiences"
  | "education"
  | "links"
>;

export const YEARS_MAX = 70;

const text = (value: string | null | undefined): string => (typeof value === "string" ? value : "");

export function emptyLanguage(): LanguageDraft {
  return { name: "", level: "" };
}

export function emptyExperience(): ExperienceDraft {
  return { title: "", company: "", start: "", end: "", description: "" };
}

export function emptyEducation(): EducationDraft {
  return { degree: "", school: "", year: "" };
}

export function emptyLink(): LinkDraft {
  return { label: "", url: "" };
}

/** The form's starting state from a row: what was read, as text. */
export function toDraft(row: CandidateRow): CandidateDraft {
  return {
    full_name: text(row.full_name),
    email: text(row.email),
    phone: text(row.phone),
    headline: text(row.headline),
    location: text(row.location),
    years_experience: typeof row.years_experience === "number" ? String(row.years_experience) : "",
    availability: text(row.availability),
    summary: text(row.summary),
    languages: (row.languages ?? []).map((l) => ({ name: text(l.name), level: text(l.level) })),
    experiences: (row.experiences ?? []).map((e) => ({
      title: text(e.title),
      company: text(e.company),
      start: text(e.start),
      end: text(e.end),
      description: text(e.description),
    })),
    education: (row.education ?? []).map((e) => ({
      degree: text(e.degree),
      school: text(e.school),
      year: text(e.year),
    })),
    links: (row.links ?? []).map((l) => ({ label: text(l.label), url: text(l.url) })),
  };
}

/** "" -> null, " 3,5 " -> 3.5; "invalid" when not a number within 0..70. */
export function parseYears(value: string): number | null | "invalid" {
  const trimmed = value.trim().replace(",", ".");
  if (!trimmed) return null;
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(trimmed)) return "invalid";
  const parsed = Math.round(Number.parseFloat(trimmed) * 10) / 10;
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > YEARS_MAX) return "invalid";
  return parsed;
}

const nullable = (value: string): string | null => {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

/** The update to send, or the field that is invalid. Empty rows are dropped. */
export function toPatch(draft: CandidateDraft): { patch: CandidatePatch } | { invalid: "years_experience" } {
  const years = parseYears(draft.years_experience);
  if (years === "invalid") return { invalid: "years_experience" };
  return {
    patch: {
      full_name: nullable(draft.full_name),
      email: nullable(draft.email)?.toLowerCase() ?? null,
      phone: nullable(draft.phone),
      headline: nullable(draft.headline),
      location: nullable(draft.location),
      years_experience: years,
      availability: nullable(draft.availability),
      summary: nullable(draft.summary),
      languages: draft.languages
        .filter((l) => l.name.trim())
        .map((l) => ({ name: l.name.trim(), level: nullable(l.level) })),
      experiences: draft.experiences
        .filter((e) => e.title.trim() || e.company.trim())
        .map((e) => ({
          title: e.title.trim(),
          company: nullable(e.company),
          start: nullable(e.start),
          end: nullable(e.end),
          description: nullable(e.description),
        })),
      education: draft.education
        .filter((e) => e.degree.trim() || e.school.trim())
        .map((e) => ({ degree: e.degree.trim(), school: nullable(e.school), year: nullable(e.year) })),
      links: draft.links
        .filter((l) => l.url.trim())
        .map((l) => ({ label: l.label.trim() || l.url.trim(), url: l.url.trim() })),
    },
  };
}

export const CHIP_MAX_LENGTH = 60;

/** Skills and tags: trimmed, no empties, no case-insensitive repeats, one line each. */
export function normalizeChips(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const value = (typeof raw === "string" ? raw : "").replace(/\s+/g, " ").trim().slice(0, CHIP_MAX_LENGTH);
    const key = value.toLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

/** The list with one chip added (typed text may hold several, comma-separated). */
export function addChips(values: readonly string[], typed: string): string[] {
  return normalizeChips([...values, ...typed.split(/[,;\n]/)]);
}

export function removeChip(values: readonly string[], chip: string): string[] {
  return values.filter((value) => value !== chip);
}
