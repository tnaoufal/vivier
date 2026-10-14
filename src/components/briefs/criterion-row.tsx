/**
 * One criterion of a brief as an editable row: its kind, its label (what
 * the requirement row says), its value (what is looked for in a
 * profile; for the role, the job's definition in a few lines), whether
 * it is required (a profile that does not meet it is set aside by the
 * analysis), and its weight as three buttons. A row that becomes the
 * role starts required and essential. A row about a protected
 * characteristic says under itself that it will not be saved (the
 * clean-up leaves it out). The editor wraps the row in the list item
 * that carries the hairline.
 */
import { Check, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  CRITERION_KINDS,
  isCriterionKind,
  kindKey,
  LABEL_MAX,
  protectedCriterion,
  ROLE_REQUIRED,
  ROLE_WEIGHT,
  VALUE_MAX,
  WEIGHTS,
  weightKey,
} from "@/lib/briefs/criteria";
import type { BriefCriterion } from "@/lib/db/types";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export function CriterionRow({
  criterion,
  canEdit,
  disabled = false,
  onChange,
  onRemove,
}: {
  criterion: BriefCriterion;
  canEdit: boolean;
  disabled?: boolean;
  onChange: (next: BriefCriterion) => void;
  onRemove: () => void;
}) {
  const t = useT();
  const locked = !canEdit || disabled;
  const placeholderKey = `briefs.criteria.value.placeholder.${criterion.kind}` as const;
  const isProtected = protectedCriterion(criterion.label, criterion.value, criterion.kind);
  const isRole = criterion.kind === "role";
  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
        <Select
          value={criterion.kind}
          onValueChange={(value) => {
            if (!isCriterionKind(value)) return;
            // The job itself is required and essential unless the team says otherwise.
            if (value === "role") onChange({ ...criterion, kind: value, required: ROLE_REQUIRED, weight: ROLE_WEIGHT });
            else onChange({ ...criterion, kind: value });
          }}
          disabled={locked}
        >
          <SelectTrigger aria-label={t("briefs.criteria.kind")} className="sm:w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CRITERION_KINDS.map((kind) => (
              <SelectItem key={kind} value={kind}>
                {t(kindKey(kind))}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          value={criterion.label}
          onChange={(event) => onChange({ ...criterion, label: event.target.value })}
          placeholder={t("briefs.criteria.label.placeholder")}
          aria-label={t("briefs.criteria.label")}
          maxLength={LABEL_MAX}
          disabled={locked}
          className="sm:flex-1"
        />
        {isRole ? (
          <Textarea
            value={criterion.value}
            onChange={(event) => onChange({ ...criterion, value: event.target.value })}
            placeholder={t(placeholderKey)}
            aria-label={t("briefs.criteria.value.role")}
            maxLength={VALUE_MAX}
            rows={3}
            disabled={locked}
            className="min-h-0 sm:flex-1"
          />
        ) : (
          <Input
            value={criterion.value}
            onChange={(event) => onChange({ ...criterion, value: event.target.value })}
            placeholder={t(placeholderKey)}
            aria-label={t("briefs.criteria.value")}
            maxLength={VALUE_MAX}
            disabled={locked}
            className="sm:flex-1"
          />
        )}
      </div>
      {isProtected ? <p className="text-[13px] leading-5 text-negative">{t("briefs.criteria.protected")}</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant={criterion.required ? "default" : "outline"}
          aria-pressed={criterion.required}
          onClick={() => onChange({ ...criterion, required: !criterion.required })}
          disabled={locked}
          className="gap-1"
        >
          {criterion.required ? <Check /> : null}
          {t("briefs.criteria.required")}
        </Button>
        <div className="inline-flex rounded-full border border-input p-0.5" role="group" aria-label={t("briefs.criteria.weight")}>
          {WEIGHTS.map((weight) => (
            <button
              key={weight}
              type="button"
              onClick={() => onChange({ ...criterion, weight })}
              disabled={locked}
              aria-pressed={criterion.weight === weight}
              className={cn(
                "h-7 rounded-full px-2.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                criterion.weight === weight ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent",
              )}
            >
              {t(weightKey(weight))}
            </button>
          ))}
        </div>
        {canEdit ? (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            onClick={onRemove}
            disabled={disabled}
            aria-label={t("briefs.criteria.remove")}
            title={t("briefs.criteria.remove")}
            className="ml-auto h-8 w-8"
          >
            <X />
          </Button>
        ) : null}
      </div>
    </div>
  );
}
