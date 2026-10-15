/**
 * GDPR on one card, folded by default behind one line that says what
 * matters ("Consentement inconnu · suppression le 14 oct. 2028"): the
 * consent (unknown, given, withdrawn), the last contact (the rule it
 * drives, so many months after it, behind the field's info icon) and
 * the date the hourly purge deletes the profile, read from
 * retention_due_at() and never computed in the browser. Withdrawing
 * consent is confirmed first, because the purge then deletes the
 * profile at once.
 */
import { useEffect, useId, useState } from "react";
import { ChevronDown, CircleAlert } from "lucide-react";

import { ConfirmDialog } from "@/components/app-shell/confirm-dialog";
import { InfoTip } from "@/components/app-shell/info-tip";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { dateInputToIso, dateInputValue } from "@/lib/candidates/format";
import type { CandidateRow, ConsentStatus } from "@/lib/db/types";
import { formatDate, useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const CONSENT_OPTIONS: readonly ConsentStatus[] = ["unknown", "given", "withdrawn"];

/** A type alias (not an interface) so it can travel as a Record<string, unknown> to the update. */
export type ConsentPatch = {
  consent_status?: ConsentStatus;
  consent_at?: string | null;
  last_contact_at?: string | null;
};

export function ConsentCard({
  candidate,
  retentionDueAt,
  retentionMonths,
  canEdit,
  onSave,
}: {
  candidate: CandidateRow;
  /** From retention_due_at(); null while loading or when it could not be read. */
  retentionDueAt: string | null;
  retentionMonths: number;
  canEdit: boolean;
  onSave: (patch: ConsentPatch) => Promise<void>;
}) {
  const { t, locale } = useI18n();
  const bodyId = useId();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);
  const [lastContact, setLastContact] = useState(dateInputValue(candidate.last_contact_at));

  useEffect(() => {
    setLastContact(dateInputValue(candidate.last_contact_at));
  }, [candidate.last_contact_at]);

  async function save(patch: ConsentPatch) {
    if (busy) return;
    setBusy(true);
    try {
      await onSave(patch);
    } finally {
      setBusy(false);
    }
  }

  function changeConsent(value: string) {
    const next = CONSENT_OPTIONS.find((option) => option === value);
    if (!next || next === candidate.consent_status) return;
    if (next === "withdrawn") {
      setConfirmWithdraw(true);
      return;
    }
    void save({
      consent_status: next,
      consent_at: next === "given" ? new Date().toISOString() : null,
    });
  }

  async function withdraw() {
    await save({ consent_status: "withdrawn" });
    setConfirmWithdraw(false);
  }

  function commitLastContact() {
    const iso = lastContact.trim() ? dateInputToIso(lastContact) : null;
    if (lastContact.trim() && !iso) {
      setLastContact(dateInputValue(candidate.last_contact_at));
      return;
    }
    if (iso === candidate.last_contact_at) return;
    void save({ last_contact_at: iso });
  }

  const consent = t(`candidates.consent.${candidate.consent_status}`);
  const summary = retentionDueAt
    ? t("candidates.consent.summary", { consent, date: formatDate(locale, retentionDueAt) })
    : t("candidates.consent.summaryUnknown", { consent });

  return (
    <section className="sheet">
      <h2 className="text-base font-semibold text-ink">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-controls={bodyId}
          className="flex w-full cursor-pointer items-start justify-between gap-3 rounded-lg p-6 text-left transition-colors duration-fast hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        >
          <span className="min-w-0 flex-1">
            <span className="block">{t("candidates.consent.title")}</span>
            <span className="mt-1 block text-meta font-normal text-muted-foreground">
              {summary}
            </span>
          </span>
          <ChevronDown
            className={cn(
              "mt-1 size-4 shrink-0 text-muted-foreground transition-transform duration-base ease-out-soft",
              open && "rotate-180",
            )}
            aria-hidden="true"
          />
          <span className="sr-only">
            {open ? t("candidates.section.collapse") : t("candidates.section.expand")}
          </span>
        </button>
      </h2>
      {open ? (
        <div id={bodyId} className="fade-in space-y-4 border-t border-border p-6">
          <div className="space-y-2">
            <Label htmlFor="consent-status">{t("candidates.consent.status")}</Label>
            <Select
              value={candidate.consent_status}
              onValueChange={changeConsent}
              disabled={!canEdit || busy}
            >
              <SelectTrigger id="consent-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CONSENT_OPTIONS.map((option) => (
                  <SelectItem key={option} value={option}>
                    {t(`candidates.consent.option.${option}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {candidate.consent_status === "given" && candidate.consent_at ? (
              <p className="text-meta text-muted-foreground">
                {t("candidates.consent.givenAt", {
                  date: formatDate(locale, candidate.consent_at),
                })}
              </p>
            ) : null}
            {candidate.consent_status === "withdrawn" ? (
              <p className="flex items-start gap-1.5 text-meta text-ink">
                <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                <span className="min-w-0">{t("candidates.consent.withdrawn.note")}</span>
              </p>
            ) : null}
          </div>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Label htmlFor="last-contact">{t("candidates.consent.lastContact")}</Label>
              {/* The rule this date drives, on demand; the summary above already says the date it gives. */}
              <InfoTip label={t("candidates.consent.lastContact")}>
                {retentionMonths === 1
                  ? t("candidates.consent.retention.one")
                  : t("candidates.consent.retention", { months: retentionMonths })}
              </InfoTip>
            </div>
            <Input
              id="last-contact"
              type="date"
              value={lastContact}
              onChange={(event) => setLastContact(event.target.value)}
              onBlur={commitLastContact}
              disabled={!canEdit || busy}
            />
          </div>
        </div>
      ) : null}
      <ConfirmDialog
        open={confirmWithdraw}
        onOpenChange={(open) => {
          if (!busy) setConfirmWithdraw(open);
        }}
        title={t("candidates.consent.withdrawTitle")}
        text={t("candidates.consent.withdrawText")}
        confirmLabel={t("candidates.consent.option.withdrawn")}
        destructive
        busy={busy}
        onConfirm={withdraw}
      />
    </section>
  );
}
