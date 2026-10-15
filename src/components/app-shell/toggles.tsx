/**
 * The two toggles of the product's frames: the theme (one icon, named
 * for what it switches to; `rail` is the 44px square of the rail) and
 * the language (the code of the other language, as the dictionary
 * writes it, next to one icon), both 40px high elsewhere.
 */
import { Languages, Moon, Sun } from "lucide-react";

import { useTheme } from "@/components/theme-context";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export function ThemeToggle({
  rail = false,
  className,
}: {
  /** The rail's 44px square with a 20px icon. */
  rail?: boolean | undefined;
  className?: string | undefined;
}) {
  const { theme, toggleTheme } = useTheme();
  const { t } = useI18n();
  const label = theme === "dark" ? t("common.theme.light") : t("common.theme.dark");
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggleTheme}
      aria-label={label}
      title={label}
      className={cn(
        rail && "size-11 rounded-[10px] text-muted-foreground hover:bg-muted hover:text-ink [&_svg]:size-5",
        className,
      )}
    >
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
      size="md"
      icon={<Languages />}
      onClick={() => setLocale(next)}
      aria-label={`${t("common.language")} · ${t(`common.locale.${next}`)}`}
      title={t(`common.locale.${next}`)}
      className="px-3"
    >
      {t(`common.locale.code.${next}`)}
    </Button>
  );
}
