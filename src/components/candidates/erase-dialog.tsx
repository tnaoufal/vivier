/**
 * The last question before a candidate is erased for good: the person
 * types the name (or the placeholder shown for a nameless profile) so
 * nothing is erased by a slip. Admins only; the server checks again.
 */
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useT } from "@/lib/i18n";

export function EraseCandidateDialog({
  open,
  onOpenChange,
  name,
  documentCount,
  busy,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
  documentCount: number;
  busy: boolean;
  onConfirm: () => Promise<void>;
}) {
  const t = useT();
  const [typed, setTyped] = useState("");
  const matches = typed.trim().toLowerCase() === name.trim().toLowerCase();

  function handleOpenChange(next: boolean) {
    if (busy) return;
    if (!next) setTyped("");
    onOpenChange(next);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>{t("candidates.erase.title", { name })}</DialogTitle>
          <DialogDescription>{t("candidates.erase.text", { count: documentCount })}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="erase-name">{t("candidates.erase.typeName", { name })}</Label>
          <Input id="erase-name" value={typed} onChange={(event) => setTyped(event.target.value)} autoComplete="off" disabled={busy} />
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button type="button" variant="destructive" onClick={() => void onConfirm()} disabled={busy || !matches}>
            {t("candidates.erase")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
