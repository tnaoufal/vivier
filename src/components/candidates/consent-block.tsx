/**
 * GDPR in one block, folded by default behind the line that says what
 * matters ("Consentement non renseigné · suppression le 14 oct. 2028"):
 * the consent (unknown, given, withdrawn), the last contact (the rule it
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

import { Block, type BlockHeading } from "./block";

const CONSENT_OPTIONS: readonly ConsentStatus[] = ["unknown", "given", "withdrawn"];

/** A type alias (not an interface) so it can travel as a Record<string, unknown> to the update. */
export type ConsentPatch = {
  consent_status?: ConsentStatus;
  consent_at?: string | null;
  last_contact_at?: string | null;
};

export function ConsentBlock({
  candidate,
  retentionDueAt,
  retentionMonths,
  canEdit,
  as,
  onSave,
}: {
  candidate: CandidateRow;
  /** From retention_due_at(); null while loading or when it could not be read. */
  retentionDueAt: string | null;
  retentionMonths: number;
  canEdit: boolean;
  as: BlockHeading;
  onSave: (patch: ConsentPatch) => Promise<void>;
}) {
  const { t, locale } = useI18n();
  const ids = useId();
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
    <Block as={as} title={t("candidates.consent.title")}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={`${ids}-body`}
        className="flex min-h-10 w-full cursor-pointer items-center gap-2 rounded-sm text-left text-meta text-muted-foreground transition-colors duration-fast hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="min-w-0 flex-1 break-words tabular-nums">{summary}</span>
        <ChevronDown
          className={cn(
            "size-4 shrink-0 transition-transform duration-base ease-out-soft",
            open && "rotate-180",
          )}
          aria-hidden="true"
        />
        <span className="sr-only">
          {open ? t("candidates.section.collapse") : t("candidates.section.expand")}
        </span>
      </button>
      {open ? (
        <div id={`${ids}-body`} className="fade-in space-y-4 pt-1">
          <div className="space-y-2">
            <Label htmlFor={`${ids}-status`}>{t("candidates.consent.status")}</Label>
            <Select
              value={candidate.consent_status}
              onValueChange={changeConsent}
              disabled={!canEdit || busy}
            >
              <SelectTrigger id={`${ids}-status`}>
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
              <Label htmlFor={`${ids}-contact`}>{t("candidates.consent.lastContact")}</Label>
              {/* The rule this date drives, on demand; the folded line already says the date it gives. */}
              <InfoTip label={t("candidates.consent.lastContact")}>
                {retentionMonths === 1
                  ? t("candidates.consent.retention.one")
                  : t("candidates.consent.retention", { months: retentionMonths })}
              </InfoTip>
            </div>
            <Input
              id={`${ids}-contact`}
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
        onOpenChange={(next) => {
          if (!busy) setConfirmWithdraw(next);
        }}
        title={t("candidates.consent.withdrawTitle")}
        text={t("candidates.consent.withdrawText")}
        confirmLabel={t("candidates.consent.option.withdrawn")}
        destructive
        busy={busy}
        onConfirm={withdraw}
      />
    </Block>
  );
}
