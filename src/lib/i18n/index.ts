/**
 * Translation without a library: a dictionary per language
 * (messages.ts, plus one file per feature under ./features), a locale
 * context, and `t()`. The locale is the organisation's working language
 * by default, overridable per person (profiles.locale) and remembered in
 * this browser so the sign-in page already speaks it.
 */
import { createContext, useContext } from "react";

import type { Locale } from "@/lib/db/types";
import { en, fr, type MessageKey } from "./messages";
import { featureMessages, type FeatureMessageKey } from "./features";

export type { Locale };
export type TranslationKey = MessageKey | FeatureMessageKey;

export const LOCALES: readonly Locale[] = ["fr", "en"];
export const DEFAULT_LOCALE: Locale = "fr";
export const LOCALE_STORAGE_KEY = "vivier-locale";

const DICTIONARIES: Record<Locale, Record<string, string>> = {
  fr: { ...fr, ...featureMessages.fr },
  en: { ...en, ...featureMessages.en },
};

export type Params = Record<string, string | number>;

export function isLocale(value: unknown): value is Locale {
  return value === "fr" || value === "en";
}

/** The sentence for a key in a locale; the key itself when it is unknown (never a crash). */
export function translate(locale: Locale, key: TranslationKey, params?: Params): string {
  const sentence = DICTIONARIES[locale][key] ?? DICTIONARIES[DEFAULT_LOCALE][key] ?? key;
  if (!params) return sentence;
  return sentence.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}

export interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: TranslationKey, params?: Params) => string;
}

export const I18nContext = createContext<I18nContextValue | null>(null);

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  if (!context) throw new Error("useI18n must be used inside I18nProvider");
  return context;
}

/** `t` alone, the common case in components. */
export function useT(): I18nContextValue["t"] {
  return useI18n().t;
}

/** The browser's remembered locale, else its language, else French. */
export function detectLocale(): Locale {
  if (typeof window === "undefined") return DEFAULT_LOCALE;
  try {
    const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    if (isLocale(stored)) return stored;
  } catch {
    // Storage may be blocked.
  }
  const language = window.navigator?.language?.toLowerCase() ?? "";
  return language.startsWith("en") ? "en" : DEFAULT_LOCALE;
}

/** Dates in the person's language, short ("13 oct. 2026"). */
export function formatDate(locale: Locale, iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(locale === "fr" ? "fr-FR" : "en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

export function formatDateTime(locale: Locale, iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(locale === "fr" ? "fr-FR" : "en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

/** "il y a 3 min" / "3 min ago", for activity feeds. */
export function formatRelative(locale: Locale, iso: string, now: number = Date.now()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const seconds = Math.round((then - now) / 1000);
  const rtf = new Intl.RelativeTimeFormat(locale === "fr" ? "fr" : "en", { numeric: "auto" });
  const abs = Math.abs(seconds);
  if (abs < 60) return rtf.format(seconds, "second");
  if (abs < 3600) return rtf.format(Math.round(seconds / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(seconds / 3600), "hour");
  if (abs < 86400 * 30) return rtf.format(Math.round(seconds / 86400), "day");
  return formatDate(locale, iso);
}
