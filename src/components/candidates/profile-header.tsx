/**
 * The top of a profile, shaped like every page header: the name,
 * editable in place by a member, the headline and location under it,
 * pills for the status, the consent and the source, and the page's
 * actions on the right (under the title on phones). "Not stated" where
 * nothing was read.
 */
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Check, Pencil, X } from "lucide-react";

import { Avatar } from "@/components/app-shell/avatar";
import { Pill } from "@/components/app-shell/pill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { displayName } from "@/lib/candidates/format";
import type { CandidateRow } from "@/lib/db/types";
import { useT } from "@/lib/i18n";

import { ConfidenceHint } from "./confidence-pill";

export function ProfileHeader({
  candidate,
  canEdit,
  actions,
  onRename,
}: {
  candidate: CandidateRow;
  canEdit: boolean;
  /** The page's buttons: one primary at most, the rest outline or ghost. */
  actions?: ReactNode;
  onRename: (name: string | null) => Promise<void>;
}) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(candidate.full_name ?? "");
  const [busy, setBusy] = useState(false);
  const name = displayName(candidate, t("candidates.noName"));

  useEffect(() => {
    if (!editing) setValue(candidate.full_name ?? "");
  }, [candidate.full_name, editing]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const next = value.trim() || null;
    if (next === (candidate.full_name ?? null)) {
      setEditing(false);
      return;
    }
    setBusy(true);
    try {
      await onRename(next);
      setEditing(false);
    } finally {
      setBusy(false);
    }
  }

  const line = [candidate.headline, candidate.location].filter((part) => part && part.trim()).join(" · ");

  return (
    <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
      <div className="flex min-w-0 shrink grow basis-80 items-start gap-4">
        <Avatar name={name} size="lg" className="mt-1" />
        <div className="min-w-0 flex-1">
          {editing ? (
            <form onSubmit={(event) => void submit(event)} className="flex flex-wrap items-center gap-2">
              <Input
                value={value}
                onChange={(event) => setValue(event.target.value)}
                placeholder={t("candidates.name.placeholder")}
                maxLength={200}
                autoFocus
                disabled={busy}
                className="max-w-sm"
              />
              <Button type="submit" size="sm" variant="outline" disabled={busy} className="gap-1.5">
                <Check />
                {t("common.save")}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={busy} className="gap-1.5">
                <X />
                {t("common.cancel")}
              </Button>
            </form>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="min-w-0 break-words font-display text-2xl text-ink sm:text-3xl">{name}</h1>
              <ConfidenceHint value={candidate.confidence.full_name} />
              {canEdit ? (
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  onClick={() => setEditing(true)}
                  aria-label={t("candidates.name.edit")}
                  title={t("candidates.name.edit")}
                >
                  <Pencil />
                </Button>
              ) : null}
            </div>
          )}
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            {line || t("common.unknown")}
            {line ? (
              <>
                {" "}
                <ConfidenceHint value={candidate.confidence.headline} />
              </>
            ) : null}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Pill tone={candidate.status === "active" ? "positive" : "neutral"} dot>
              {t(`candidates.status.${candidate.status}`)}
            </Pill>
            <Pill
              tone={
                candidate.consent_status === "given"
                  ? "positive"
                  : candidate.consent_status === "withdrawn"
                    ? "negative"
                    : "neutral"
              }
              dot
            >
              {t(`candidates.consent.${candidate.consent_status}`)}
            </Pill>
            <Pill dot>{t(`candidates.source.${candidate.source}`)}</Pill>
          </div>
        </div>
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
