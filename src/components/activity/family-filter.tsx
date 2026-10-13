/** A row of chips to keep one family of activities (shortlists, comments…) or all of them. */
import { Button } from "@/components/ui/button";
import { ACTIVITY_FAMILIES, type ActivityFamily } from "@/lib/activity/describe";
import { useT } from "@/lib/i18n";

export function FamilyFilter({
  value,
  onChange,
}: {
  value: ActivityFamily | null;
  onChange: (family: ActivityFamily | null) => void;
}) {
  const t = useT();
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label={t("common.filter")}>
      <Button type="button" size="sm" variant={value === null ? "default" : "outline"} onClick={() => onChange(null)}>
        {t("activity.allKinds")}
      </Button>
      {ACTIVITY_FAMILIES.map((family) => (
        <Button
          key={family}
          type="button"
          size="sm"
          variant={value === family ? "default" : "outline"}
          onClick={() => onChange(family)}
          aria-pressed={value === family}
        >
          {t(`activity.family.${family}`)}
        </Button>
      ))}
    </div>
  );
}
