/**
 * A new password, typed twice, in a small dialog. `lead` marks the one
 * that follows a reset link: the person came for it, so it opens by
 * itself and its button is the dialog's one filled control either way.
 * Too short or mismatched is a sentence under the fields before any
 * call; a refused update is the page's toast. The fields start clean
 * each time the dialog opens.
 */
import { useEffect, useId, useState, type FormEvent } from "react";
import { CircleAlert, KeyRound } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useT } from "@/lib/i18n";

const PASSWORD_MIN = 8;

export function PasswordDialog({
  open,
  onOpenChange,
  lead,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** True after a reset link: the title says "new password" rather than "change it". */
  lead: boolean;
  /** Saves the password; answers true when it was saved (the dialog then closes). */
  onSubmit: (password: string) => Promise<boolean>;
}) {
  const t = useT();
  const formId = useId();
  const errorId = useId();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) return;
    setPassword("");
    setConfirm("");
    setError(null);
  }, [open]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (password.length < PASSWORD_MIN) {
      setError(t("auth.password.short"));
      return;
    }
    if (password !== confirm) {
      setError(t("account.password.mismatch"));
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const done = await onSubmit(password);
      if (done) onOpenChange(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{lead ? t("auth.newPassword") : t("account.password.change")}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <form id={formId} onSubmit={submit} className="space-y-5" noValidate>
            <div className="space-y-2">
              <Label htmlFor="new-password">{t("auth.newPassword")}</Label>
              <Input
                id="new-password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (error) setError(null);
                }}
                minLength={PASSWORD_MIN}
                required
                autoFocus
                disabled={busy}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? errorId : undefined}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-password">{t("account.password.confirm")}</Label>
              <Input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => {
                  setConfirm(e.target.value);
                  if (error) setError(null);
                }}
                minLength={PASSWORD_MIN}
                required
                disabled={busy}
                aria-invalid={error ? true : undefined}
              />
            </div>
            {error ? (
              <p
                id={errorId}
                role="alert"
                className="fade-in flex items-start gap-1.5 text-meta text-ink"
              >
                <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                {error}
              </p>
            ) : null}
          </form>
        </DialogBody>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            {t("common.cancel")}
          </Button>
          <Button
            type="submit"
            form={formId}
            icon={<KeyRound />}
            disabled={busy || !password || !confirm}
          >
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
