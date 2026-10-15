/**
 * The profile in edit mode, in a drawer from the right so the sheet
 * stays where it is: the same structure as the sections it corrects
 * (identity, summary, career, education, languages, contact and
 * links), the repeatable parts as rows a person adds and removes, and a
 * footer that stays in place with cancel and the one filled
 * "Enregistrer". The parent owns the draft (draft.ts) and saves the
 * patch; this component only renders and reports changes. Skills, tags,
 * consent and status are edited in place elsewhere and stay out of this
 * form.
 */
import { useId, type FormEvent, type ReactNode } from "react";
import { Check, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
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

/** One section of the form, titled like the sheet's; the drawer's title is the heading above them. */
function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="py-6 first:pt-0 last:pb-0">
      <h3 className="mb-4 text-base font-semibold leading-6 text-ink">{title}</h3>
      {children}
    </section>
  );
}

export function ProfileForm({
  open,
  onOpenChange,
  draft,
  onChange,
  onSubmit,
  busy,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The draft being edited; null before the first opening. */
  draft: CandidateDraft | null;
  onChange: (draft: CandidateDraft) => void;
  onSubmit: () => Promise<void>;
  busy: boolean;
}) {
  const t = useT();
  const formId = useId();

  function set<K extends keyof CandidateDraft>(key: K, value: CandidateDraft[K]) {
    if (draft) onChange({ ...draft, [key]: value });
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!busy) void onSubmit();
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!busy) onOpenChange(next);
      }}
    >
      <SheetContent
        side="right"
        size="lg"
        className="flex flex-col gap-6 overflow-hidden"
        aria-describedby={undefined}
      >
        <SheetHeader>
          <SheetTitle>{t("common.edit")}</SheetTitle>
        </SheetHeader>
        <SheetBody>
          {draft ? (
            <form id={formId} onSubmit={submit} className="divide-y divide-border">
              <Block title={t("candidates.field.identity")}>
                <div className="grid gap-5 sm:grid-cols-2">
                  <Field id="cand-name" label={t("candidates.field.full_name")}>
                    <Input
                      id="cand-name"
                      value={draft.full_name}
                      onChange={(e) => set("full_name", e.target.value)}
                      maxLength={200}
                      disabled={busy}
                    />
                  </Field>
                  <Field id="cand-headline" label={t("candidates.field.headline")}>
                    <Input
                      id="cand-headline"
                      value={draft.headline}
                      onChange={(e) => set("headline", e.target.value)}
                      maxLength={200}
                      disabled={busy}
                    />
                  </Field>
                  <Field id="cand-location" label={t("candidates.field.location")}>
                    <Input
                      id="cand-location"
                      value={draft.location}
                      onChange={(e) => set("location", e.target.value)}
                      maxLength={200}
                      disabled={busy}
                    />
                  </Field>
                  <Field id="cand-years" label={t("candidates.field.years")}>
                    <Input
                      id="cand-years"
                      inputMode="decimal"
                      value={draft.years_experience}
                      onChange={(e) => set("years_experience", e.target.value)}
                      maxLength={5}
                      disabled={busy}
                      className="tabular-nums"
                    />
                  </Field>
                  <Field id="cand-availability" label={t("candidates.field.availability")}>
                    <Input
                      id="cand-availability"
                      value={draft.availability}
                      onChange={(e) => set("availability", e.target.value)}
                      maxLength={200}
                      disabled={busy}
                    />
                  </Field>
                </div>
              </Block>

              <Block title={t("candidates.field.summary")}>
                <Textarea
                  id="cand-summary"
                  value={draft.summary}
                  onChange={(e) => set("summary", e.target.value)}
                  rows={5}
                  maxLength={8000}
                  disabled={busy}
                  aria-label={t("candidates.field.summary")}
                />
              </Block>

              <Block title={t("candidates.field.career")}>
                <ExperienceRows
                  rows={draft.experiences}
                  onChange={(rows) => set("experiences", rows)}
                  disabled={busy}
                />
              </Block>

              <Block title={t("candidates.field.education")}>
                <EducationRows
                  rows={draft.education}
                  onChange={(rows) => set("education", rows)}
                  disabled={busy}
                />
              </Block>

              <Block title={t("candidates.field.languages")}>
                <LanguageRows
                  rows={draft.languages}
                  onChange={(rows) => set("languages", rows)}
                  disabled={busy}
                />
              </Block>

              <Block title={t("candidates.field.contactLinks")}>
                <div className="grid gap-5 sm:grid-cols-2">
                  <Field id="cand-email" label={t("common.email")}>
                    <Input
                      id="cand-email"
                      type="email"
                      value={draft.email}
                      onChange={(e) => set("email", e.target.value)}
                      maxLength={200}
                      disabled={busy}
                    />
                  </Field>
                  <Field id="cand-phone" label={t("candidates.field.phone")}>
                    <Input
                      id="cand-phone"
                      type="tel"
                      value={draft.phone}
                      onChange={(e) => set("phone", e.target.value)}
                      maxLength={60}
                      disabled={busy}
                    />
                  </Field>
                </div>
                <div className="mt-5">
                  <LinkRows
                    rows={draft.links}
                    onChange={(rows) => set("links", rows)}
                    disabled={busy}
                  />
                </div>
              </Block>
            </form>
          ) : null}
        </SheetBody>
        <SheetFooter className="shrink-0 border-t border-border pt-4">
          <Button
            type="button"
            variant="outline"
            icon={<X />}
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            {t("common.cancel")}
          </Button>
          <Button type="submit" form={formId} icon={<Check />} disabled={busy || !draft}>
            {t("common.save")}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
