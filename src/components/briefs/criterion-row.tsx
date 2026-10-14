/**
 * One criterion of a brief as an editable row: its kind as a muted
 * prefix before the label (what the requirement row says), its value
 * under them (what is looked for in a profile; for the role, the job's
 * definition in a few lines), then whether it is required (a switch: a
 * profile that does not meet it is set aside by the analysis) and its
 * weight as a segmented control. A row that becomes the role starts
 * required and essential. When the brief has a role profile, the role's
 * definition is the profile's: shown read-only with a word saying so,
 * since the team edits the profile, not the row. A row about a
 * protected characteristic says under itself that it will not be saved
 * (the clean-up leaves it out). The editor wraps the row in the list
 * item that carries the hairline.
 */
import { TriangleAlert, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Segmented } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  CRITERION_KINDS,
  isCriterionKind,
  kindKey,
  LABEL_MAX,
  protectedCriterion,
  ROLE_REQUIRED,
  ROLE_WEIGHT,
  toWeight,
  VALUE_MAX,
  WEIGHTS,
  weightKey,
} from "@/lib/briefs/criteria";
import type { BriefCriterion } from "@/lib/db/types";
import { useT } from "@/lib/i18n";

import { ToggleSwitch } from "./toggle-switch";

export function CriterionRow({
  criterion,
  canEdit,
  disabled = false,
  roleDefinition = null,
  onChange,
  onRemove,
}: {
  criterion: BriefCriterion;
  canEdit: boolean;
  disabled?: boolean;
  /** For the role row of a brief with a profile: the definition read off the profile, shown instead of the editable value. */
  roleDefinition?: string | null;
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
      <div className="flex items-center gap-2">
        <Select
          value={criterion.kind}
          onValueChange={(value) => {
            if (!isCriterionKind(value)) return;
            // The job itself is required and essential unless the team says otherwise.
            if (value === "role")
              onChange({ ...criterion, kind: value, required: ROLE_REQUIRED, weight: ROLE_WEIGHT });
            else onChange({ ...criterion, kind: value });
          }}
          disabled={locked}
        >
          {/* The kind reads as a muted prefix of the label: no border, no field look, its one chevron. */}
          <SelectTrigger
            aria-label={t("briefs.criteria.kind")}
            className="h-8 w-auto shrink-0 border-transparent bg-transparent px-2.5 text-meta font-medium text-muted-foreground shadow-none hover:border-transparent hover:bg-accent hover:text-ink"
          >
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
          className="min-w-0 flex-1"
        />
      </div>
      {isRole && roleDefinition ? (
        <div className="min-w-0 space-y-1 pl-2.5">
          <p className="text-body text-ink">{roleDefinition}</p>
          <p className="text-meta text-muted-foreground">{t("briefs.criteria.role.fromProfile")}</p>
        </div>
      ) : isRole ? (
        <Textarea
          value={criterion.value}
          onChange={(event) => onChange({ ...criterion, value: event.target.value })}
          placeholder={t(placeholderKey)}
          aria-label={t("briefs.criteria.value.role")}
          maxLength={VALUE_MAX}
          rows={3}
          disabled={locked}
          className="min-h-0"
        />
      ) : (
        <Input
          value={criterion.value}
          onChange={(event) => onChange({ ...criterion, value: event.target.value })}
          placeholder={t(placeholderKey)}
          aria-label={t("briefs.criteria.value")}
          maxLength={VALUE_MAX}
          disabled={locked}
        />
      )}
      {isProtected ? (
        <p className="flex items-start gap-2 text-meta text-negative">
          <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span className="min-w-0">{t("briefs.criteria.protected")}</span>
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <ToggleSwitch
          checked={criterion.required}
          onCheckedChange={(required) => onChange({ ...criterion, required })}
          label={t("briefs.criteria.required")}
          disabled={locked}
        />
        <Segmented
          size="sm"
          aria-label={t("briefs.criteria.weight")}
          value={String(criterion.weight)}
          onChange={(value) => onChange({ ...criterion, weight: toWeight(Number(value)) })}
          options={WEIGHTS.map((weight) => ({
            value: String(weight),
            label: t(weightKey(weight)),
            disabled: locked,
          }))}
        />
        {canEdit ? (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            onClick={onRemove}
            disabled={disabled}
            aria-label={t("briefs.criteria.remove")}
            title={t("briefs.criteria.remove")}
            className="ml-auto text-muted-foreground hover:text-ink"
          >
            <X />
          </Button>
        ) : null}
      </div>
    </div>
  );
}
