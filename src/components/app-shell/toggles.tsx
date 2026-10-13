import { Languages, Moon, Sun } from "lucide-react";

import { useTheme } from "@/components/theme-context";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const { t } = useI18n();
  const label = theme === "dark" ? t("common.theme.light") : t("common.theme.dark");
  return (
    <Button variant="ghost" size="icon" onClick={toggleTheme} aria-label={label} title={label}>
      {theme === "dark" ? <Sun /> : <Moon />}
    </Button>
  );
}

export function LocaleToggle() {
  const { locale, setLocale, t } = useI18n();
  const next = locale === "fr" ? "en" : "fr";
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => setLocale(next)}
      aria-label={t("common.language")}
      title={t("common.language")}
      className="gap-1.5 uppercase"
    >
      <Languages />
      {next}
    </Button>
  );
}
