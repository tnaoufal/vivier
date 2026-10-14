/** The two working languages as chips, one of them on: for an organisation, an account, a new organisation. */
import { LOCALES, useT, type Locale } from "@/lib/i18n";

import { FilterChip } from "./filter-chip";

export function LocaleChips({
  value,
  onChange,
  disabled = false,
}: {
  value: Locale;
  onChange: (locale: Locale) => void;
  disabled?: boolean;
}) {
  const t = useT();
  return (
    <ul className="flex flex-wrap gap-2">
      {LOCALES.map((locale) => (
        <li key={locale}>
          <FilterChip
            active={value === locale}
            onClick={() => onChange(locale)}
            disabled={disabled}
          >
            {t(`common.locale.${locale}`)}
          </FilterChip>
        </li>
      ))}
    </ul>
  );
}
