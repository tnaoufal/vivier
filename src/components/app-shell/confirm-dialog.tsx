/**
 * A yes/no question before something hard to undo: a small dialog with
 * the question as its title, one sentence of consequence, cancel on the
 * left and the one confirming button. A destructive one is the same ink
 * fill: this dialog and its words are the safety, not a colour.
 */
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useT } from "@/lib/i18n";

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  text,
  confirmLabel,
  destructive = false,
  busy = false,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  text?: ReactNode;
  confirmLabel?: ReactNode;
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => void | Promise<void>;
}) {
  const t = useT();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {text ? <DialogDescription>{text}</DialogDescription> : null}
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button
            variant={destructive ? "destructive" : "primary"}
            onClick={() => void onConfirm()}
            disabled={busy}
          >
            {confirmLabel ?? t("common.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
