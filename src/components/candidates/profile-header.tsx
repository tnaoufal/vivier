/**
 * The head of a CV, under the page's sticky header: the photo (when the
 * organisation shows photos and the CV had one; the initials otherwise,
 * square-rounded), the name, editable in place by a member, the position
 * held today, where and for how long and when available, the languages
 * with their level. The page title, the status pills and the actions
 * live in the PageHeader above, so the name here is a card title, not a
 * second h1. "Not stated" in muted text where the CV said nothing.
 */
import { useEffect, useState, type FormEvent } from "react";
import { Check, Pencil, X } from "lucide-react";

import { Avatar } from "@/components/app-shell/avatar";
import { Pill } from "@/components/app-shell/pill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { currentPosition, displayName, metaLine } from "@/lib/candidates/format";
import { usePhotoUrl } from "@/lib/candidates/use-photo-url";
import type { CandidateRow } from "@/lib/db/types";
import { useI18n } from "@/lib/i18n";

import { ConfidenceHint } from "./confidence-pill";

export function ProfileHeader({
  candidate,
  canEdit,
  showPhotos,
  onRename,
}: {
  candidate: CandidateRow;
  canEdit: boolean;
  /** The organisation's choice: a team that practises anonymous CVs turns photos off. */
  showPhotos: boolean;
  onRename: (name: string | null) => Promise<void>;
}) {
  const { t, locale } = useI18n();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(candidate.full_name ?? "");
  const [busy, setBusy] = useState(false);
  const name = displayName(candidate, t("candidates.noName"));
  const photoUrl = usePhotoUrl(candidate.photo_path, showPhotos);
  const position = currentPosition(candidate);
  const meta = metaLine(locale, candidate);
  const languages = (candidate.languages ?? []).filter((language) => language?.name?.trim());

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

  return (
    <section className="sheet mb-8 p-6 sm:p-8" aria-label={name}>
      <div className="flex items-start gap-5">
        <Avatar name={name} size="xl" variant="profile" photoUrl={photoUrl} />
        <div className="min-w-0 flex-1">
        {editing ? (
          <form onSubmit={(event) => void submit(event)} className="flex flex-wrap items-center gap-2">
            <Input
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder={t("candidates.name.placeholder")}
              aria-label={t("candidates.field.full_name")}
              maxLength={200}
              autoFocus
              disabled={busy}
              className="max-w-sm"
            />
            <Button type="submit" size="sm" variant="outline" icon={<Check />} disabled={busy}>
              {t("common.save")}
            </Button>
            <Button type="button" size="sm" variant="ghost" icon={<X />} onClick={() => setEditing(false)} disabled={busy}>
              {t("common.cancel")}
            </Button>
          </form>
        ) : (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <p className="min-w-0 break-words text-xl font-semibold text-ink">{name}</p>
            <ConfidenceHint value={candidate.confidence.full_name} />
            {canEdit ? (
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                icon={<Pencil />}
                onClick={() => setEditing(true)}
                aria-label={t("candidates.name.edit")}
                className="text-muted-foreground hover:text-ink"
              />
            ) : null}
          </div>
        )}
        <p className="mt-1 text-body text-ink">
          {position ? (
            <>
              <span className="font-medium text-ink">{position.title}</span>
              {position.company ? <span className="text-muted-foreground"> @ {position.company}</span> : null}
            </>
          ) : (
            <span className="text-muted-foreground">{t("common.unknown")}</span>
          )}
          {position ? (
            <>
              {" "}
              <ConfidenceHint value={candidate.confidence.headline} />
            </>
          ) : null}
        </p>
        <p className="mt-1 text-sm text-muted-foreground tabular-nums">{meta || t("common.unknown")}</p>
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {languages.length ? (
            <ul className="contents" aria-label={t("candidates.field.languages")}>
              {languages.map((language, index) => (
                <li key={`${language.name}-${index}`} className="min-w-0">
                  <Pill size="sm">
                    {language.name.trim()}
                    {language.level?.trim() ? ` · ${language.level.trim()}` : ""}
                  </Pill>
                </li>
              ))}
            </ul>
          ) : (
            <span className="text-meta text-muted-foreground">
              {t("candidates.field.languages")} · {t("common.unknown")}
            </span>
          )}
          <ConfidenceHint value={candidate.confidence.languages} />
        </div>
        </div>
      </div>
    </section>
  );
}
