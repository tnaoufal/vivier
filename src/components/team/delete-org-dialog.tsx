/**
 * The confirmation before deleting an organisation: the person types its
 * name, and only an exact match enables the button. Everything the
 * organisation holds goes with it, so the sentence says so.
 */
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useT } from "@/lib/i18n";

export function DeleteOrgDialog({
  open,
  onOpenChange,
  orgName,
  busy,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgName: string;
  busy: boolean;
  onConfirm: () => Promise<void>;
}) {
  const t = useT();
  const [typed, setTyped] = useState("");
  useEffect(() => {
    if (!open) setTyped("");
  }, [open]);
  const matches = typed.trim() === orgName.trim();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("settings.delete.title", { org: orgName })}</DialogTitle>
          <DialogDescription>{t("settings.danger.text")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="delete-org-name">{t("settings.delete.text")}</Label>
          <Input
            id="delete-org-name"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={orgName}
            autoComplete="off"
            disabled={busy}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button variant="destructive" onClick={() => void onConfirm()} disabled={busy || !matches}>
            {t("settings.delete")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
