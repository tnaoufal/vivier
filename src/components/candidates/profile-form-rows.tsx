/**
 * The repeatable parts of the profile form: experiences, education,
 * languages and links as simple rows a person adds and removes. Each
 * editor owns one array of the draft and reports the whole array back.
 */
import { Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  emptyEducation,
  emptyExperience,
  emptyLanguage,
  emptyLink,
  type EducationDraft,
  type ExperienceDraft,
  type LanguageDraft,
  type LinkDraft,
} from "@/lib/candidates/draft";
import { useT } from "@/lib/i18n";

function update<T>(rows: T[], index: number, patch: Partial<T>): T[] {
  return rows.map((row, at) => (at === index ? { ...row, ...patch } : row));
}

function without<T>(rows: T[], index: number): T[] {
  return rows.filter((_, at) => at !== index);
}

function RemoveButton({ onClick, disabled }: { onClick: () => void; disabled: boolean }) {
  const t = useT();
  return (
    <Button
      type="button"
      size="icon"
      variant="ghost"
      onClick={onClick}
      disabled={disabled}
      aria-label={t("candidates.row.remove")}
      title={t("candidates.row.remove")}
      icon={<X />}
      className="shrink-0 text-muted-foreground hover:text-ink"
    />
  );
}

function AddButton({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <Button type="button" variant="outline" icon={<Plus />} onClick={onClick} disabled={disabled}>
      {label}
    </Button>
  );
}

export function ExperienceRows({
  rows,
  onChange,
  disabled,
}: {
  rows: ExperienceDraft[];
  onChange: (rows: ExperienceDraft[]) => void;
  disabled: boolean;
}) {
  const t = useT();
  return (
    <div className="space-y-4">
      {rows.map((row, index) => (
        <div key={index} className="rounded-lg border border-border p-4">
          <div className="flex items-start gap-3">
            <div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-2">
              <Input
                value={row.title}
                onChange={(e) => onChange(update(rows, index, { title: e.target.value }))}
                placeholder={t("candidates.experience.title")}
                maxLength={200}
                disabled={disabled}
                aria-label={t("candidates.experience.title")}
              />
              <Input
                value={row.company}
                onChange={(e) => onChange(update(rows, index, { company: e.target.value }))}
                placeholder={t("candidates.experience.company")}
                maxLength={200}
                disabled={disabled}
                aria-label={t("candidates.experience.company")}
              />
              <Input
                value={row.start}
                onChange={(e) => onChange(update(rows, index, { start: e.target.value }))}
                placeholder={t("candidates.experience.start")}
                maxLength={10}
                disabled={disabled}
                aria-label={t("candidates.experience.start")}
              />
              <Input
                value={row.end}
                onChange={(e) => onChange(update(rows, index, { end: e.target.value }))}
                placeholder={t("candidates.experience.end")}
                maxLength={10}
                disabled={disabled}
                aria-label={t("candidates.experience.end")}
              />
              <Textarea
                value={row.description}
                onChange={(e) => onChange(update(rows, index, { description: e.target.value }))}
                placeholder={t("candidates.experience.description")}
                maxLength={4000}
                rows={3}
                disabled={disabled}
                aria-label={t("candidates.experience.description")}
                className="sm:col-span-2"
              />
            </div>
            <RemoveButton onClick={() => onChange(without(rows, index))} disabled={disabled} />
          </div>
        </div>
      ))}
      <AddButton
        label={t("candidates.experience.add")}
        onClick={() => onChange([...rows, emptyExperience()])}
        disabled={disabled}
      />
    </div>
  );
}

export function EducationRows({
  rows,
  onChange,
  disabled,
}: {
  rows: EducationDraft[];
  onChange: (rows: EducationDraft[]) => void;
  disabled: boolean;
}) {
  const t = useT();
  return (
    <div className="space-y-3">
      {rows.map((row, index) => (
        <div key={index} className="flex items-start gap-3">
          <div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-[2fr_2fr_1fr]">
            <Input
              value={row.degree}
              onChange={(e) => onChange(update(rows, index, { degree: e.target.value }))}
              placeholder={t("candidates.education.degree")}
              maxLength={200}
              disabled={disabled}
              aria-label={t("candidates.education.degree")}
            />
            <Input
              value={row.school}
              onChange={(e) => onChange(update(rows, index, { school: e.target.value }))}
              placeholder={t("candidates.education.school")}
              maxLength={200}
              disabled={disabled}
              aria-label={t("candidates.education.school")}
            />
            <Input
              value={row.year}
              onChange={(e) => onChange(update(rows, index, { year: e.target.value }))}
              placeholder={t("candidates.education.year")}
              maxLength={10}
              disabled={disabled}
              aria-label={t("candidates.education.year")}
            />
          </div>
          <RemoveButton onClick={() => onChange(without(rows, index))} disabled={disabled} />
        </div>
      ))}
      <AddButton
        label={t("candidates.education.add")}
        onClick={() => onChange([...rows, emptyEducation()])}
        disabled={disabled}
      />
    </div>
  );
}

export function LanguageRows({
  rows,
  onChange,
  disabled,
}: {
  rows: LanguageDraft[];
  onChange: (rows: LanguageDraft[]) => void;
  disabled: boolean;
}) {
  const t = useT();
  return (
    <div className="space-y-3">
      {rows.map((row, index) => (
        <div key={index} className="flex items-start gap-3">
          <div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-[2fr_1fr]">
            <Input
              value={row.name}
              onChange={(e) => onChange(update(rows, index, { name: e.target.value }))}
              placeholder={t("candidates.language.name")}
              maxLength={80}
              disabled={disabled}
              aria-label={t("candidates.language.name")}
            />
            <Input
              value={row.level}
              onChange={(e) => onChange(update(rows, index, { level: e.target.value }))}
              placeholder={t("candidates.language.level")}
              maxLength={40}
              disabled={disabled}
              aria-label={t("candidates.language.level")}
            />
          </div>
          <RemoveButton onClick={() => onChange(without(rows, index))} disabled={disabled} />
        </div>
      ))}
      <AddButton
        label={t("candidates.language.add")}
        onClick={() => onChange([...rows, emptyLanguage()])}
        disabled={disabled}
      />
    </div>
  );
}

export function LinkRows({
  rows,
  onChange,
  disabled,
}: {
  rows: LinkDraft[];
  onChange: (rows: LinkDraft[]) => void;
  disabled: boolean;
}) {
  const t = useT();
  return (
    <div className="space-y-3">
      {rows.map((row, index) => (
        <div key={index} className="flex items-start gap-3">
          <div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-[1fr_2fr]">
            <Input
              value={row.label}
              onChange={(e) => onChange(update(rows, index, { label: e.target.value }))}
              placeholder={t("candidates.link.label")}
              maxLength={80}
              disabled={disabled}
              aria-label={t("candidates.link.label")}
            />
            <Input
              value={row.url}
              onChange={(e) => onChange(update(rows, index, { url: e.target.value }))}
              placeholder={t("candidates.link.url")}
              type="url"
              maxLength={2000}
              disabled={disabled}
              aria-label={t("candidates.link.url")}
            />
          </div>
          <RemoveButton onClick={() => onChange(without(rows, index))} disabled={disabled} />
        </div>
      ))}
      <AddButton
        label={t("candidates.link.add")}
        onClick={() => onChange([...rows, emptyLink()])}
        disabled={disabled}
      />
    </div>
  );
}
