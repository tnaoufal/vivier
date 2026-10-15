/**
 * Inviting a colleague, in a small dialog: an address and a role, sent
 * to the server function that writes the invitation and emails it. A
 * malformed address is refused under the field before any call; what a
 * role may do and how long a link lasts sit behind info icons, not under
 * the fields. When no email went out (Resend not set up, or the send
 * failed) the link is shown once with a copy button so the inviter can
 * pass it on themselves; the dialog then closes on "Fermer". Every
 * field starts clean when the dialog opens again.
 */
import { useEffect, useId, useState, type FormEvent } from "react";
import { CircleAlert, Copy, UserPlus } from "lucide-react";

import { InfoTip } from "@/components/app-shell/info-tip";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useI18n, type TranslationKey } from "@/lib/i18n";
import { errorMessage, withToken } from "@/lib/platform/call";
import { errorSays } from "@/lib/team/team";
import { inviteMember } from "@/lib/team/team.functions";
import { toast } from "@/lib/toast";

type InviteRole = "admin" | "member" | "viewer";
const INVITE_ROLES: readonly InviteRole[] = ["admin", "member", "viewer"];

/** The same shape the database checks; refused here before any call. */
const EMAIL_SHAPE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function roleHelpKey(role: InviteRole): TranslationKey {
  return `role.${role}.help`;
}

export function InviteDialog({
  open,
  onOpenChange,
  orgId,
  onInvited,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgId: string;
  onInvited: () => void;
}) {
  const { t, locale } = useI18n();
  const formId = useId();
  const errorId = useId();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<InviteRole>("member");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingLink, setPendingLink] = useState<{ email: string; link: string } | null>(null);

  useEffect(() => {
    if (open) return;
    setEmail("");
    setRole("member");
    setError(null);
    setPendingLink(null);
  }, [open]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const address = email.trim().toLowerCase();
    if (busy) return;
    if (!EMAIL_SHAPE.test(address)) {
      setError(t("team.invite.invalidEmail"));
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const result = await inviteMember({
        data: { ...(await withToken()), orgId, email: address, role },
      });
      onInvited();
      if (result.emailed) {
        toast.success(t("team.invite.sent", { email: address }));
        onOpenChange(false);
      } else {
        setPendingLink({ email: address, link: result.link });
        toast.success(t("team.invite.created", { email: address }));
      }
    } catch (caught) {
      console.error(caught);
      if (errorSays(caught, "TEAM:duplicate")) setError(t("team.invite.duplicate"));
      else if (errorSays(caught, "TEAM:already_member")) setError(t("team.invite.alreadyMember"));
      else setError(errorMessage(locale, caught, { "ORG:seats": t("team.invite.seats") }));
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    if (!pendingLink) return;
    try {
      await navigator.clipboard.writeText(pendingLink.link);
      toast(t("common.copied"));
    } catch (caught) {
      console.error(caught);
      toast.error(t("common.error"));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm" aria-describedby={undefined}>
        <DialogHeader>
          <div className="flex items-center gap-2">
            <DialogTitle>{t("team.invite.title")}</DialogTitle>
            <InfoTip label={t("team.invite.title")}>{t("team.invite.text")}</InfoTip>
          </div>
        </DialogHeader>
        <DialogBody>
          {pendingLink ? (
            <div className="fade-in space-y-3">
              <p className="text-sm text-ink">{t("team.invite.notEmailed")}</p>
              <div className="flex flex-wrap items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-sm bg-muted px-3 py-2 text-xs text-ink">
                  {pendingLink.link}
                </code>
                <Button
                  type="button"
                  variant="outline"
                  icon={<Copy />}
                  onClick={() => void copyLink()}
                >
                  {t("team.invite.copyLink")}
                </Button>
              </div>
            </div>
          ) : (
            <form id={formId} onSubmit={submit} className="space-y-5" noValidate>
              <div className="space-y-2">
                <Label htmlFor="invite-email">{t("auth.email")}</Label>
                <Input
                  id="invite-email"
                  type="email"
                  autoComplete="off"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (error) setError(null);
                  }}
                  disabled={busy}
                  maxLength={254}
                  required
                  autoFocus
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? errorId : undefined}
                />
                {error ? (
                  <p
                    id={errorId}
                    role="alert"
                    className="flex items-start gap-1.5 text-meta text-ink"
                  >
                    <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                    {error}
                  </p>
                ) : null}
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label htmlFor="invite-role">{t("common.role")}</Label>
                  <InfoTip label={t("common.role")}>
                    <dl className="space-y-2">
                      {INVITE_ROLES.map((value) => (
                        <div key={value}>
                          <dt className="font-semibold">{t(`role.${value}`)}</dt>
                          <dd className="text-muted-foreground">{t(roleHelpKey(value))}</dd>
                        </div>
                      ))}
                    </dl>
                  </InfoTip>
                </div>
                <Select
                  value={role}
                  onValueChange={(value) => setRole(value as InviteRole)}
                  disabled={busy}
                >
                  <SelectTrigger id="invite-role">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {INVITE_ROLES.map((value) => (
                      <SelectItem key={value} value={value}>
                        {t(`role.${value}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </form>
          )}
        </DialogBody>
        <DialogFooter>
          {pendingLink ? (
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("common.close")}
            </Button>
          ) : (
            <>
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
                icon={<UserPlus />}
                disabled={busy || !email.trim()}
              >
                {t("team.invite.send")}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
