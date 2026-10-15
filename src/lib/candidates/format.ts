/**
 * Pure formatting for the talent pool: confidence tones, file sizes,
 * experience date ranges and durations, years of experience, the
 * position held today and the one-line summaries a list row, a sheet's
 * head and its sticky header show (the seniority always first). No
 * React, no data access; every rule is tested in format.test.ts. Words
 * for a locale live here the way formatRelative() keeps them in
 * src/lib/i18n: short and the same for every caller.
 */
import type {
  CandidateExperience,
  CandidateLanguage,
  CandidateRow,
  ConfidenceMap,
  DocumentStatus,
  Locale,
} from "@/lib/db/types";

export type ConfidenceTone = "none" | "caution" | "negative";

/** At or above this, the structuring was sure: no hint. */
export const CONFIDENCE_SURE = 0.8;
/** Between this and CONFIDENCE_SURE the field is to be checked; below it, uncertain. */
export const CONFIDENCE_DOUBTFUL = 0.5;

/** The hint a field deserves; "none" when the field was typed or never read (no key). */
export function confidenceTone(value: number | null | undefined): ConfidenceTone {
  if (typeof value !== "number" || Number.isNaN(value)) return "none";
  if (value >= CONFIDENCE_SURE) return "none";
  if (value >= CONFIDENCE_DOUBTFUL) return "caution";
  return "negative";
}

const UNITS: Record<Locale, readonly string[]> = {
  fr: ["o", "Ko", "Mo", "Go"],
  en: ["B", "KB", "MB", "GB"],
};

function numberFormat(locale: Locale, maximumFractionDigits: number): Intl.NumberFormat {
  return new Intl.NumberFormat(locale === "fr" ? "fr-FR" : "en-GB", { maximumFractionDigits });
}

/** "10 000" / "10,000": a count with the locale's thousands separator, for counters. */
export function formatCount(locale: Locale, value: number): string {
  return numberFormat(locale, 0).format(Number.isFinite(value) ? Math.max(0, value) : 0);
}

/** "1,2 Mo" / "1.2 MB", in powers of 1024 so the 25 MB limit reads as 25. */
export function formatBytes(bytes: number, locale: Locale): string {
  const units = UNITS[locale];
  let value = Math.max(0, Number.isFinite(bytes) ? bytes : 0);
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  const digits = index === 0 ? 0 : value < 10 ? 1 : 0;
  return `${numberFormat(locale, digits).format(value)} ${units[index] ?? ""}`.trim();
}

/** The year of a "YYYY-MM" / "YYYY" value, else the value as written; null when empty. */
export function yearOf(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const match = /^(\d{4})/.exec(trimmed);
  return match?.[1] ?? trimmed;
}

/** "2019 – 2023", "depuis 2021" / "since 2021", "jusqu'en 2023" / "until 2023", "" when nothing. */
export function formatDateRange(
  locale: Locale,
  start: string | null | undefined,
  end: string | null | undefined,
): string {
  const from = yearOf(start);
  const to = yearOf(end);
  if (from && to) return from === to ? from : `${from} – ${to}`;
  if (from) return locale === "fr" ? `depuis ${from}` : `since ${from}`;
  if (to) return locale === "fr" ? `jusqu'en ${to}` : `until ${to}`;
  return "";
}

/**
 * "3 ans" / "3 years", "1 an" / "1 year", "2,5 ans"; "" when not stated.
 * Rounded to one decimal first, and the noun agrees with the figure shown
 * (1.96 reads "2 ans", 1.04 "1 year").
 */
export function yearsLabel(locale: Locale, years: number | null | undefined): string {
  if (typeof years !== "number" || !Number.isFinite(years)) return "";
  const shown = Math.round(years * 10) / 10;
  const number = numberFormat(locale, 1).format(shown);
  if (locale === "fr") return `${number} ${shown < 2 ? "an" : "ans"}`;
  return `${number} ${shown === 1 ? "year" : "years"}`;
}

/** The name to show, or the fallback ("Sans nom") when none was read. */
export function displayName(row: Pick<CandidateRow, "full_name">, fallback: string): string {
  const name = row.full_name?.trim();
  return name ? name : fallback;
}

/** "Anglais (C1), Espagnol": names with their level when one was read. */
export function languagesLine(languages: readonly CandidateLanguage[] | null | undefined): string {
  if (!languages?.length) return "";
  return languages
    .filter((language) => language && typeof language.name === "string" && language.name.trim())
    .map((language) => {
      const level = language.level?.trim();
      return level ? `${language.name.trim()} (${level})` : language.name.trim();
    })
    .join(", ");
}

/** "Français C2 · Anglais B2": the languages as a sheet's head reads them, the level after the name when one was read; "" when none. */
export function languagesSummary(
  languages: readonly CandidateLanguage[] | null | undefined,
): string {
  if (!languages?.length) return "";
  return languages
    .filter((language) => language && typeof language.name === "string" && language.name.trim())
    .map((language) => {
      const level = language.level?.trim();
      return level ? `${language.name.trim()} ${level}` : language.name.trim();
    })
    .join(" · ");
}

/** The first `count` skills, trimmed and without empties. */
export function topSkills(skills: readonly string[] | null | undefined, count: number): string[] {
  if (!skills?.length) return [];
  return skills
    .filter((skill) => typeof skill === "string" && skill.trim())
    .map((skill) => skill.trim())
    .slice(0, Math.max(0, count));
}

/** How many skills a list row shows: the first of the ordered list, the ones the CV put first. */
export const KEY_SKILLS = 3;

/** The skills that tell a row apart: the first three as the CV orders them. */
export function keySkills(
  skills: readonly string[] | null | undefined,
  count: number = KEY_SKILLS,
): string[] {
  return topSkills(skills, count);
}

/** The position held today, as a row or a header says it: "Title @ Company". */
export interface CurrentPosition {
  title: string;
  company: string | null;
}

/**
 * The position held today: the first experience without an end (the CV
 * lists them newest first), else the headline alone; null when the CV
 * states neither. Only an end that is null or empty reads as "ongoing":
 * a value that is not a date is still a value the CV wrote.
 */
export function currentPosition(
  row: Pick<CandidateRow, "headline"> & {
    experiences?: readonly CandidateExperience[] | null | undefined;
  },
): CurrentPosition | null {
  for (const experience of row.experiences ?? []) {
    if (!experience || typeof experience !== "object") continue;
    const title = typeof experience.title === "string" ? experience.title.trim() : "";
    const end = typeof experience.end === "string" ? experience.end.trim() : "";
    if (!title || end) continue;
    const company = typeof experience.company === "string" ? experience.company.trim() : "";
    return { title, company: company || null };
  }
  const headline = row.headline?.trim();
  return headline ? { title: headline, company: null } : null;
}

/** The parts a CV states, in the order given, as one line; "" when it states none of them. */
function joinStated(parts: readonly (string | null | undefined)[]): string {
  return parts
    .filter((part): part is string => typeof part === "string" && part.length > 0)
    .join(" · ");
}

/** "6 ans · Paris · Disponible en janvier": the years, the location and the availability the CV states, the seniority first; "" when none. */
export function metaLine(
  locale: Locale,
  row: Pick<CandidateRow, "location" | "years_experience" | "availability">,
): string {
  return joinStated([
    yearsLabel(locale, row.years_experience),
    row.location?.trim(),
    row.availability?.trim(),
  ]);
}

/**
 * "12 ans · Casablanca · Python, SAP, MS Project": the second line of a
 * list row: the seniority first, then the location, then the three
 * skills the CV put first. A fact the CV does not state is simply
 * absent; "" when it states none of them.
 */
export function listLine(
  locale: Locale,
  row: Pick<CandidateRow, "location" | "years_experience"> & {
    skills?: readonly string[] | null | undefined;
  },
): string {
  const skills = keySkills(row.skills);
  return joinStated([
    yearsLabel(locale, row.years_experience),
    row.location?.trim(),
    skills.length ? skills.join(", ") : null,
  ]);
}

/** "Lead designer · 12 ans · Casablanca": the sticky header's reminder under the name: the position held today, the years, the location; "" when the CV states none. */
export function headerLine(
  locale: Locale,
  row: Pick<CandidateRow, "headline" | "location" | "years_experience"> & {
    experiences?: readonly CandidateExperience[] | null | undefined;
  },
): string {
  return joinStated([
    currentPosition(row)?.title,
    yearsLabel(locale, row.years_experience),
    row.location?.trim(),
  ]);
}

/**
 * A "YYYY-MM" / "YYYY" value as a month index (year × 12 + month − 1),
 * null when it is not one. A year alone reads as its first month at the
 * start of a period and as its last at the end, so "2019" to "2019" is
 * a whole year.
 */
export function monthIndex(value: string | null | undefined, edge: "start" | "end"): number | null {
  if (!value) return null;
  const match = /^(\d{4})(?:-(\d{1,2}))?(?!\d)/.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = match[2] !== undefined ? Number(match[2]) : edge === "start" ? 1 : 12;
  if (month < 1 || month > 12) return null;
  return year * 12 + (month - 1);
}

/**
 * How many months an experience lasted, both ends counted (January to
 * December is twelve); an empty end counts to `now`. Null when the start
 * is not a date, when the end is a value that is not one, or when the
 * end comes before the start: nothing is estimated.
 */
export function durationMonths(
  start: string | null | undefined,
  end: string | null | undefined,
  now: Date = new Date(),
): number | null {
  const from = monthIndex(start, "start");
  if (from === null) return null;
  const to = end?.trim() ? monthIndex(end, "end") : now.getFullYear() * 12 + now.getMonth();
  if (to === null || to < from) return null;
  return to - from + 1;
}

/** "3 mois", "1 an", "2 ans 4 mois" / "3 months", "1 year", "2 years 4 months"; "" for nothing. */
export function durationLabel(locale: Locale, months: number | null | undefined): string {
  if (typeof months !== "number" || !Number.isFinite(months) || months < 1) return "";
  const whole = Math.floor(months);
  const years = Math.floor(whole / 12);
  const rest = whole % 12;
  const parts: string[] = [];
  if (years > 0) {
    parts.push(
      locale === "fr"
        ? `${years} ${years === 1 ? "an" : "ans"}`
        : `${years} ${years === 1 ? "year" : "years"}`,
    );
  }
  if (rest > 0) {
    parts.push(locale === "fr" ? `${rest} mois` : `${rest} ${rest === 1 ? "month" : "months"}`);
  }
  return parts.join(" ");
}

/** The duration of an experience in words, "" when it cannot be computed. */
export function formatDuration(
  locale: Locale,
  start: string | null | undefined,
  end: string | null | undefined,
  now: Date = new Date(),
): string {
  return durationLabel(locale, durationMonths(start, end, now));
}

export type PillToneName = "neutral" | "positive" | "caution" | "negative" | "primary";

/** The pill tone of a document status: processed is good, failed is bad, the rest is on its way. */
export function documentTone(status: DocumentStatus): PillToneName {
  switch (status) {
    case "processed":
      return "positive";
    case "failed":
      return "negative";
    case "needs_ocr":
      return "caution";
    case "processing":
      return "primary";
    case "queued":
      return "neutral";
    case "rejected":
      // Not a failure of the service: the file was read and is not a CV.
      return "neutral";
    default:
      return "neutral";
  }
}

/** The dictionary key of a document status ("candidates.documents.status.queued"...). */
export function documentStatusKey(
  status: DocumentStatus,
): `candidates.documents.status.${DocumentStatus}` {
  return `candidates.documents.status.${status}`;
}

/** The distinct tags of a page of rows, in order of first appearance. */
export function distinctTags(rows: readonly Pick<CandidateRow, "tags">[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const row of rows) {
    for (const tag of row.tags ?? []) {
      const clean = typeof tag === "string" ? tag.trim() : "";
      if (clean && !seen.has(clean)) {
        seen.add(clean);
        out.push(clean);
      }
    }
  }
  return out;
}

/** The "years min" filter as typed: a whole number of years from 1 to 70, else null (nothing typed, or nothing a filter can use). */
export function parseYearsMin(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d{1,2}$/.test(trimmed)) return null;
  const years = Number(trimmed);
  return years >= 1 && years <= 70 ? years : null;
}

/** The distinct skills of a page of rows, in order of first appearance: the suggestions of the skill filter. */
export function distinctSkills(rows: readonly Pick<CandidateRow, "skills">[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const row of rows) {
    for (const skill of row.skills ?? []) {
      const clean = typeof skill === "string" ? skill.trim() : "";
      if (clean && !seen.has(clean)) {
        seen.add(clean);
        out.push(clean);
      }
    }
  }
  return out;
}

/** A value for a date input ("YYYY-MM-DD") from an ISO timestamp, "" when none. */
export function dateInputValue(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

/** An ISO timestamp (midday UTC, so every time zone reads the same day) from a date input, null when empty. */
export function dateInputToIso(value: string): string | null {
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  const date = new Date(`${trimmed}T12:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
