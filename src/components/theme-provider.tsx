import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import { THEME_STORAGE_KEY, ThemeContext, type AppTheme } from "./theme-context";

export { THEME_STORAGE_KEY, type AppTheme } from "./theme-context";

let themeSwitchSequence = 0;

interface ViewTransitionHandle {
  finished: Promise<void>;
}

type ViewTransitionDocument = Document & {
  startViewTransition?: (update: () => void) => ViewTransitionHandle;
};

function applyTheme(theme: AppTheme) {
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  root.style.colorScheme = theme;
}

function applyThemeSmoothly(theme: AppTheme) {
  const root = document.documentElement;
  const sequence = ++themeSwitchSequence;
  const documentWithTransitions = document as ViewTransitionDocument;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Theme changes used to animate every descendant independently. On a large
  // results grid that means hundreds of concurrent color/border transitions.
  // Freeze component-level transitions while the browser composites one
  // viewport snapshot instead.
  root.classList.add("theme-switching");

  const cleanup = () => {
    if (sequence === themeSwitchSequence) {
      root.classList.remove("theme-switching");
    }
  };

  if (!reducedMotion && documentWithTransitions.startViewTransition) {
    try {
      const transition = documentWithTransitions.startViewTransition(() => {
        applyTheme(theme);
      });
      void transition.finished.finally(cleanup);
      return;
    } catch {
      // Fall through to the zero-cost immediate path below.
    }
  }

  applyTheme(theme);
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(cleanup);
  });
}

function storedTheme(): AppTheme {
  try {
    return window.localStorage.getItem(THEME_STORAGE_KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Light is the product default (HR teams work on documents in daylight).
  // The pre-hydration script in the root shell applies a saved dark
  // preference before CSS paints, so this default remains hydration-safe.
  const [theme, setThemeState] = useState<AppTheme>("light");

  useEffect(() => {
    const initial = storedTheme();
    setThemeState(initial);
    applyTheme(initial);
  }, []);

  const setTheme = useCallback((next: AppTheme) => {
    setThemeState(next);
    applyThemeSmoothly(next);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // A blocked storage API should not prevent the theme from changing for
      // the current session.
    }
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(theme === "dark" ? "light" : "dark");
  }, [setTheme, theme]);

  const value = useMemo(() => ({ theme, setTheme, toggleTheme }), [setTheme, theme, toggleTheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
