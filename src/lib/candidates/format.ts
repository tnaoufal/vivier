/**
 * Pure formatting for the talent pool: confidence tones, file sizes,
 * experience date ranges, years of experience, the one-line summaries a
 * list row shows. No React, no data access; every rule is tested in
 * format.test.ts. Words for a locale live here the way formatRelative()
 * keeps them in src/lib/i18n: short and the same for every caller.
 */
import type {
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
/** Any field below this marks the whole profile "to be checked" in the list. */
export const CONFIDENCE_REVIEW = 0.6;

/** The hint a field deserves; "none" when the field was typed or never read (no key). */
export function confidenceTone(value: number | null | undefined): ConfidenceTone {
  if (typeof value !== "number" || Number.isNaN(value)) return "none";
  if (value >= CONFIDENCE_SURE) return "none";
  if (value >= CONFIDENCE_DOUBTFUL) return "caution";
  return "negative";
}

/** True when any read field sits below CONFIDENCE_REVIEW. */
export function needsReview(confidence: ConfidenceMap | null | undefined): boolean {
  if (!confidence) return false;
  return Object.values(confidence).some(
    (value) => typeof value === "number" && value < CONFIDENCE_REVIEW,
  );
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

/** "3 ans" / "3 years", "1 an" / "1 year", "2,5 ans"; "" when not stated. */
export function yearsLabel(locale: Locale, years: number | null | undefined): string {
  if (typeof years !== "number" || !Number.isFinite(years)) return "";
  const number = numberFormat(locale, 1).format(years);
  if (locale === "fr") return `${number} ${years < 2 ? "an" : "ans"}`;
  return `${number} ${years === 1 ? "year" : "years"}`;
}

/** The name to show, or the fallback ("Sans nom") when none was read. */
export function displayName(
  row: Pick<CandidateRow, "full_name">,
  fallback: string,
): string {
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

/** The first `count` skills, trimmed and without empties. */
export function topSkills(skills: readonly string[] | null | undefined, count: number): string[] {
  if (!skills?.length) return [];
  return skills
    .filter((skill) => typeof skill === "string" && skill.trim())
    .map((skill) => skill.trim())
    .slice(0, Math.max(0, count));
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
export function documentStatusKey(status: DocumentStatus): `candidates.documents.status.${DocumentStatus}` {
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
