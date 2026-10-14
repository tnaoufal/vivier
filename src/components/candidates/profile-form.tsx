/**
 * The profile in edit mode, in the same structure as the sheet it
 * replaces: one card, its sections divided by hairlines (identity,
 * summary, career, education, languages, contact and links), the
 * repeatable parts as rows a person adds and removes, and a bar that
 * stays at the bottom with cancel and save. The parent owns the draft
 * (draft.ts) and saves the patch; this component only renders and
 * reports changes. Skills, tags, consent and status are edited in place
 * elsewhere and stay out of this form.
 */
import type { FormEvent, ReactNode } from "react";
import { Check, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { CandidateDraft } from "@/lib/candidates/draft";
import { useT } from "@/lib/i18n";

import { EducationRows, ExperienceRows, LanguageRows, LinkRows } from "./profile-form-rows";

function Field({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 space-y-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

/** One section of the card, titled like the sheet's. */
function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="p-6 sm:p-8">
      <h2 className="mb-5 text-base font-semibold leading-6 text-ink">{title}</h2>
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
    <form onSubmit={submit} className="space-y-6">
      <div className="sheet divide-y divide-border">
        <Block title={t("candidates.field.identity")}>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field id="cand-name" label={t("candidates.field.full_name")}>
              <Input id="cand-name" value={draft.full_name} onChange={(e) => set("full_name", e.target.value)} maxLength={200} disabled={busy} />
            </Field>
            <Field id="cand-headline" label={t("candidates.field.headline")}>
              <Input id="cand-headline" value={draft.headline} onChange={(e) => set("headline", e.target.value)} maxLength={200} disabled={busy} />
            </Field>
            <Field id="cand-location" label={t("candidates.field.location")}>
              <Input id="cand-location" value={draft.location} onChange={(e) => set("location", e.target.value)} maxLength={200} disabled={busy} />
            </Field>
            <Field id="cand-years" label={t("candidates.field.years")}>
              <Input id="cand-years" inputMode="decimal" value={draft.years_experience} onChange={(e) => set("years_experience", e.target.value)} maxLength={5} disabled={busy} className="tabular-nums" />
            </Field>
            <Field id="cand-availability" label={t("candidates.field.availability")}>
              <Input id="cand-availability" value={draft.availability} onChange={(e) => set("availability", e.target.value)} maxLength={200} disabled={busy} />
            </Field>
          </div>
        </Block>

        <Block title={t("candidates.field.summary")}>
          <Textarea id="cand-summary" value={draft.summary} onChange={(e) => set("summary", e.target.value)} rows={5} maxLength={8000} disabled={busy} aria-label={t("candidates.field.summary")} />
        </Block>

        <Block title={t("candidates.field.career")}>
          <ExperienceRows rows={draft.experiences} onChange={(rows) => set("experiences", rows)} disabled={busy} />
        </Block>

        <Block title={t("candidates.field.education")}>
          <EducationRows rows={draft.education} onChange={(rows) => set("education", rows)} disabled={busy} />
        </Block>

        <Block title={t("candidates.field.languages")}>
          <LanguageRows rows={draft.languages} onChange={(rows) => set("languages", rows)} disabled={busy} />
        </Block>

        <Block title={t("candidates.field.contactLinks")}>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field id="cand-email" label={t("common.email")}>
              <Input id="cand-email" type="email" value={draft.email} onChange={(e) => set("email", e.target.value)} maxLength={200} disabled={busy} />
            </Field>
            <Field id="cand-phone" label={t("candidates.field.phone")}>
              <Input id="cand-phone" type="tel" value={draft.phone} onChange={(e) => set("phone", e.target.value)} maxLength={60} disabled={busy} />
            </Field>
          </div>
          <div className="mt-5">
            <LinkRows rows={draft.links} onChange={(rows) => set("links", rows)} disabled={busy} />
          </div>
        </Block>
      </div>

      <div className="sticky bottom-0 z-sticky -mx-4 flex flex-wrap justify-end gap-3 border-t border-border bg-background/90 px-4 py-4 backdrop-blur sm:mx-0 sm:px-0">
        <Button type="button" variant="outline" icon={<X />} onClick={onCancel} disabled={busy}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" icon={<Check />} disabled={busy}>
          {t("common.save")}
        </Button>
      </div>
    </form>
  );
}
