/**
 * Theme context and hook, kept apart from the provider component so the
 * provider file only exports a component (React Fast Refresh boundary).
 */
import { createContext, useContext } from "react";

export type AppTheme = "dark" | "light";

export const THEME_STORAGE_KEY = "vivier-theme";

export interface ThemeContextValue {
  theme: AppTheme;
  setTheme: (theme: AppTheme) => void;
  toggleTheme: () => void;
}

export const ThemeContext = createContext<ThemeContextValue | null>(null);

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used inside ThemeProvider");
  return context;
}
