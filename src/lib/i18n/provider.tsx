import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import type { Locale } from "@/lib/db/types";
import {
  DEFAULT_LOCALE,
  I18nContext,
  LOCALE_STORAGE_KEY,
  detectLocale,
  translate,
  type Params,
  type TranslationKey,
} from "./index";

/**
 * Holds the locale for the whole tree. Starts on French for a
 * hydration-safe first paint, then takes the browser's remembered choice
 * before the first interaction; `setLocale` remembers the new choice.
 */
export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);

  useEffect(() => {
    const detected = detectLocale();
    setLocaleState(detected);
    document.documentElement.lang = detected;
  }, []);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    document.documentElement.lang = next;
    try {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, next);
    } catch {
      // A blocked storage API must not block the change for this session.
    }
  }, []);

  const t = useCallback(
    (key: TranslationKey, params?: Params) => translate(locale, key, params),
    [locale],
  );

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
