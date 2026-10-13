/**
 * The brief itself: title, description and status, edited in place and
 * saved as one update under RLS. The form follows the row it shows
 * until the person starts typing; a save answers with the refreshed row.
 */
import { useEffect, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { requireSupabase } from "@/lib/auth/supabase-client";
import { DESCRIPTION_MAX, TITLE_MAX, updateBrief } from "@/lib/briefs/queries";
import type { BriefRow, BriefStatus } from "@/lib/db/types";
import { useT } from "@/lib/i18n";
import { toast } from "@/lib/toast";

const STATUSES: readonly BriefStatus[] = ["draft", "open", "closed"];

function isStatus(value: string): value is BriefStatus {
  return (STATUSES as readonly string[]).includes(value);
}

export function BriefForm({
  brief,
  canEdit,
  onSaved,
}: {
  brief: BriefRow;
  canEdit: boolean;
  onSaved: () => Promise<void> | void;
}) {
  const t = useT();
  const [title, setTitle] = useState(brief.title);
  const [description, setDescription] = useState(brief.description);
  const [status, setStatus] = useState<BriefStatus>(brief.status);
  const [busy, setBusy] = useState(false);

  // A fresh row (saved here or by a colleague) replaces the form's values.
  useEffect(() => {
    setTitle(brief.title);
    setDescription(brief.description);
    setStatus(brief.status);
  }, [brief.id, brief.updated_at, brief.title, brief.description, brief.status]);

  const dirty = title !== brief.title || description !== brief.description || status !== brief.status;
  const valid = title.trim().length > 0;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!canEdit || busy || !dirty || !valid) return;
    setBusy(true);
    try {
      const supabase = await requireSupabase();
      await updateBrief(supabase, brief.org_id, brief.id, {
        title: title.trim().slice(0, TITLE_MAX),
        description: description.trim().slice(0, DESCRIPTION_MAX),
        status,
      });
      toast.success(t("common.saved"));
      await onSaved();
    } catch (error) {
      console.error(error);
      toast.error(t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="sheet space-y-6 p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-xl text-ink">{t("briefs.part.brief")}</h2>
        {canEdit && dirty ? <span className="text-[13px] text-muted-foreground">{t("briefs.form.unsaved")}</span> : null}
      </div>
      <div className="space-y-2">
        <Label htmlFor="brief-title">{t("briefs.form.title")}</Label>
        <Input
          id="brief-title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder={t("briefs.form.title.placeholder")}
          maxLength={TITLE_MAX}
          disabled={!canEdit || busy}
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="brief-description">{t("briefs.form.description")}</Label>
        <Textarea
          id="brief-description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder={t("briefs.form.description.placeholder")}
          maxLength={DESCRIPTION_MAX}
          rows={8}
          disabled={!canEdit || busy}
        />
        <p className="text-[13px] text-muted-foreground">{t("briefs.form.description.help")}</p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="brief-status">{t("briefs.form.status")}</Label>
        <Select
          value={status}
          onValueChange={(value) => {
            if (isStatus(value)) setStatus(value);
          }}
          disabled={!canEdit || busy}
        >
          <SelectTrigger id="brief-status" className="sm:w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUSES.map((value) => (
              <SelectItem key={value} value={value}>
                {t(`briefs.status.${value}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {canEdit ? (
        <div className="flex justify-end">
          <Button type="submit" variant="outline" disabled={busy || !dirty || !valid}>
            {t("common.save")}
          </Button>
        </div>
      ) : null}
    </form>
  );
}
