/**
 * The profile in edit mode: the same sections as inputs and textareas,
 * experiences, education, languages and links as repeatable rows. The
 * parent owns the draft (draft.ts) and saves the patch; this component
 * only renders and reports changes. Skills, tags, consent and status
 * are edited in place elsewhere and stay out of this form.
 */
import type { FormEvent, ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { CandidateDraft } from "@/lib/candidates/draft";
import { useT } from "@/lib/i18n";

import { EducationRows, ExperienceRows, LanguageRows, LinkRows } from "./profile-form-rows";

function Field({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="sheet p-4 sm:p-5">
      <h2 className="label-caps mb-3">{title}</h2>
      {children}
    </section>
  );
}

export function ProfileForm({
  draft,
  onChange,
  onSubmit,
  onCancel,
  busy,
}: {
  draft: CandidateDraft;
  onChange: (draft: CandidateDraft) => void;
  onSubmit: () => Promise<void>;
  onCancel: () => void;
  busy: boolean;
}) {
  const t = useT();

  function set<K extends keyof CandidateDraft>(key: K, value: CandidateDraft[K]) {
    onChange({ ...draft, [key]: value });
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!busy) void onSubmit();
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Block title={t("candidates.field.contact")}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="cand-name" label={t("candidates.field.full_name")}>
            <Input id="cand-name" value={draft.full_name} onChange={(e) => set("full_name", e.target.value)} maxLength={200} disabled={busy} />
          </Field>
          <Field id="cand-headline" label={t("candidates.field.headline")}>
            <Input id="cand-headline" value={draft.headline} onChange={(e) => set("headline", e.target.value)} maxLength={200} disabled={busy} />
          </Field>
          <Field id="cand-email" label={t("common.email")}>
            <Input id="cand-email" type="email" value={draft.email} onChange={(e) => set("email", e.target.value)} maxLength={200} disabled={busy} />
          </Field>
          <Field id="cand-phone" label={t("candidates.field.phone")}>
            <Input id="cand-phone" type="tel" value={draft.phone} onChange={(e) => set("phone", e.target.value)} maxLength={60} disabled={busy} />
          </Field>
          <Field id="cand-location" label={t("candidates.field.location")}>
            <Input id="cand-location" value={draft.location} onChange={(e) => set("location", e.target.value)} maxLength={200} disabled={busy} />
          </Field>
          <Field id="cand-years" label={t("candidates.field.years")}>
            <Input id="cand-years" inputMode="decimal" value={draft.years_experience} onChange={(e) => set("years_experience", e.target.value)} maxLength={5} disabled={busy} />
          </Field>
          <Field id="cand-availability" label={t("candidates.field.availability")}>
            <Input id="cand-availability" value={draft.availability} onChange={(e) => set("availability", e.target.value)} maxLength={200} disabled={busy} />
          </Field>
        </div>
      </Block>

      <Block title={t("candidates.field.summary")}>
        <Textarea id="cand-summary" value={draft.summary} onChange={(e) => set("summary", e.target.value)} rows={5} maxLength={8000} disabled={busy} aria-label={t("candidates.field.summary")} />
      </Block>

      <Block title={t("candidates.field.languages")}>
        <LanguageRows rows={draft.languages} onChange={(rows) => set("languages", rows)} disabled={busy} />
      </Block>

      <Block title={t("candidates.field.experiences")}>
        <ExperienceRows rows={draft.experiences} onChange={(rows) => set("experiences", rows)} disabled={busy} />
      </Block>

      <Block title={t("candidates.field.education")}>
        <EducationRows rows={draft.education} onChange={(rows) => set("education", rows)} disabled={busy} />
      </Block>

      <Block title={t("candidates.field.links")}>
        <LinkRows rows={draft.links} onChange={(rows) => set("links", rows)} disabled={busy} />
      </Block>

      <div className="sticky bottom-0 flex justify-end gap-2 border-t border-border bg-background/90 py-3 backdrop-blur">
        <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" disabled={busy}>
          {t("common.save")}
        </Button>
      </div>
    </form>
  );
}
