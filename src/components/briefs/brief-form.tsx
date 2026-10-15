/**
 * The consultant's brief, edited in a drawer: the title, the text and
 * the status, saved as one update under RLS. The form starts from the
 * row it was opened on; a save answers whether the text changed (an
 * analysis then reads the brief again) and hands back to the page. Laid
 * out for a `SheetContent` column: the fields scroll, the two buttons
 * stay at the bottom.
 */
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SheetBody, SheetFooter } from "@/components/ui/sheet";
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
  onSaved,
  onCancel,
}: {
  brief: BriefRow;
  /** Called once the row is written; `textChanged` when the title or the need changed (the analysis reads the brief again). */
  onSaved: (saved: { textChanged: boolean }) => Promise<void> | void;
  onCancel: () => void;
}) {
  const t = useT();
  const [title, setTitle] = useState(brief.title);
  const [description, setDescription] = useState(brief.description);
  const [status, setStatus] = useState<BriefStatus>(brief.status);
  const [busy, setBusy] = useState(false);

  const dirty =
    title !== brief.title || description !== brief.description || status !== brief.status;
  const valid = title.trim().length > 0;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || !dirty || !valid) return;
    setBusy(true);
    try {
      const patch = {
        title: title.trim().slice(0, TITLE_MAX),
        description: description.trim().slice(0, DESCRIPTION_MAX),
        status,
      };
      await updateBrief(await requireSupabase(), brief.org_id, brief.id, patch);
      toast.success(t("common.saved"));
      await onSaved({
        textChanged: patch.title !== brief.title || patch.description !== brief.description,
      });
    } catch (error) {
      console.error(error);
      toast.error(t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={(event) => void submit(event)}
      className="flex min-h-0 flex-1 flex-col gap-6 overflow-hidden"
    >
      <SheetBody className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="brief-title">{t("briefs.form.title")}</Label>
          <Input
            id="brief-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={t("briefs.form.title.placeholder")}
            maxLength={TITLE_MAX}
            disabled={busy}
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
            rows={12}
            disabled={busy}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="brief-status">{t("briefs.form.status")}</Label>
          <Select
            value={status}
            onValueChange={(value) => {
              if (isStatus(value)) setStatus(value);
            }}
            disabled={busy}
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
      </SheetBody>
      <SheetFooter className="shrink-0">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
          {t("common.cancel")}
        </Button>
        <Button
          type="submit"
          variant="primary"
          disabled={busy || !dirty || !valid}
          aria-busy={busy || undefined}
        >
          {t("common.save")}
        </Button>
      </SheetFooter>
    </form>
  );
}
