/**
 * An editable list of short points (strengths, points of attention) on
 * the review step: one input per point with a remove button, and a
 * button to add one, up to the number the server accepts.
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
  points,
  disabled = false,
  onChange,
  onAdd,
  onRemove,
}: {
  id: string;
  label: string;
  points: string[];
  disabled?: boolean;
  onChange: (at: number, value: string) => void;
  onAdd: () => void;
  onRemove: (at: number) => void;
}) {
  const t = useT();
  return (
    <div className="space-y-1.5">
      <Label htmlFor={points.length ? `${id}-0` : undefined}>{label}</Label>
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
          >
            <X />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="gap-1.5"
        disabled={disabled || points.length >= POINTS_MAX}
        onClick={onAdd}
      >
        <Plus />
        {t("shares.review.addPoint")}
      </Button>
    </div>
  );
}
