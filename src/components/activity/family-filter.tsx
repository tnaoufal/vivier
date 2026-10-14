/** A row of chips, each with its icon, to keep one family of activities (shortlists, comments…) or all of them. */
import { FilterChip } from "@/components/app-shell/filter-chip";
import { ACTIVITY_FAMILIES, type ActivityFamily } from "@/lib/activity/describe";
import { useT } from "@/lib/i18n";

import { FAMILY_ICONS } from "./family-icon";

export function FamilyFilter({
  value,
  onChange,
}: {
  value: ActivityFamily | null;
  onChange: (family: ActivityFamily | null) => void;
}) {
  const t = useT();
  return (
    <ul className="flex flex-wrap gap-2" aria-label={t("activity.filter.label")}>
      <li>
        <FilterChip active={value === null} onClick={() => onChange(null)}>
          {t("activity.allKinds")}
        </FilterChip>
      </li>
      {ACTIVITY_FAMILIES.map((family) => (
        <li key={family}>
          <FilterChip active={value === family} onClick={() => onChange(family)} icon={FAMILY_ICONS[family]}>
            {t(`activity.family.${family}`)}
          </FilterChip>
        </li>
      ))}
    </ul>
  );
}
