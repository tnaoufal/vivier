/**
 * GDPR on one card: the consent (unknown, given, withdrawn), the last
 * contact, and the date the hourly purge deletes the profile, read from
 * retention_due_at() and never computed in the browser. Withdrawing
 * consent is confirmed first, because the purge then deletes the
 * profile at once.
 */
import { useEffect, useState } from "react";

import { ConfirmDialog } from "@/components/app-shell/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { dateInputToIso, dateInputValue } from "@/lib/candidates/format";
import type { CandidateRow, ConsentStatus } from "@/lib/db/types";
import { formatDate, useI18n } from "@/lib/i18n";

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

  return (
    <section className="sheet space-y-4 p-4 sm:p-5">
      <h2 className="label-caps">{t("candidates.consent.title")}</h2>
      <div className="space-y-1.5">
        <Label htmlFor="consent-status">{t("candidates.consent.status")}</Label>
        <Select value={candidate.consent_status} onValueChange={changeConsent} disabled={!canEdit || busy}>
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
          <p className="text-xs text-muted-foreground">
            {t("candidates.consent.givenAt", { date: formatDate(locale, candidate.consent_at) })}
          </p>
        ) : null}
        {candidate.consent_status === "withdrawn" ? (
          <p className="text-xs text-negative">{t("candidates.consent.withdrawn.note")}</p>
        ) : null}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="last-contact">{t("candidates.consent.lastContact")}</Label>
        <Input
          id="last-contact"
          type="date"
          value={lastContact}
          onChange={(event) => setLastContact(event.target.value)}
          onBlur={commitLastContact}
          disabled={!canEdit || busy}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        {retentionDueAt
          ? t("candidates.consent.retention", {
              date: formatDate(locale, retentionDueAt),
              months: retentionMonths,
            })
          : t("candidates.consent.retentionUnknown")}
      </p>
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
