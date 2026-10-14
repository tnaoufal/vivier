/**
 * An editable list of short points (strengths, points of attention, the
 * interview questions) on the review step: one input per point with a
 * remove button, and a button to add one, up to the number the server
 * accepts for that list (`max`, the points' cap unless given).
 */
import { Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useT } from "@/lib/i18n";
import { POINT_MAX, POINTS_MAX } from "@/lib/shares/draft";

export function PointsEditor({
  id,
  label,
  help,
  points,
  max = POINTS_MAX,
  disabled = false,
  onChange,
  onAdd,
  onRemove,
}: {
  id: string;
  label: string;
  /** One muted sentence under the label, when the list needs saying where it comes from. */
  help?: string | undefined;
  points: string[];
  /** The most points this list may hold: the add button stops there. */
  max?: number;
  disabled?: boolean;
  onChange: (at: number, value: string) => void;
  onAdd: () => void;
  onRemove: (at: number) => void;
}) {
  const t = useT();
  return (
    <div className="space-y-2">
      <div>
        <Label htmlFor={points.length ? `${id}-0` : undefined}>{label}</Label>
        {help ? <p className="text-meta text-muted-foreground">{help}</p> : null}
      </div>
      {points.map((point, at) => (
        <div key={at} className="flex items-center gap-1.5">
          <Input
            id={`${id}-${at}`}
            value={point}
            maxLength={POINT_MAX}
            disabled={disabled}
            onChange={(event) => onChange(at, event.target.value)}
            aria-label={`${label} ${at + 1}`}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={disabled}
            onClick={() => onRemove(at)}
            aria-label={t("shares.review.removePoint")}
            title={t("shares.review.removePoint")}
            className="text-muted-foreground"
          >
            <X />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        icon={<Plus />}
        disabled={disabled || points.length >= max}
        onClick={onAdd}
      >
        {t("shares.review.addPoint")}
      </Button>
    </div>
  );
}
