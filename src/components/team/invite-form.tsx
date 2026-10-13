/**
 * Inviting a colleague: an address and a role, sent to the server
 * function that writes the invitation and emails it. When no email went
 * out (Resend not set up, or the send failed) the link is shown once with
 * a copy button so the inviter can pass it on themselves.
 */
import { useState, type FormEvent } from "react";
import { Copy, UserPlus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useI18n } from "@/lib/i18n";
import { errorMessage, withToken } from "@/lib/server/call";
import { errorSays } from "@/lib/team/team";
import { inviteMember } from "@/lib/team/team.functions";
import { toast } from "@/lib/toast";

type InviteRole = "admin" | "member" | "viewer";
const INVITE_ROLES: readonly InviteRole[] = ["admin", "member", "viewer"];

/** The same shape the database checks; refused here before any call. */
const EMAIL_SHAPE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function InviteForm({
  orgId,
  disabled,
  onInvited,
}: {
  orgId: string;
  /** True when no seat is left: the form explains instead of trying. */
  disabled: boolean;
  onInvited: () => void;
}) {
  const { t, locale } = useI18n();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<InviteRole>("member");
  const [busy, setBusy] = useState(false);
  const [pendingLink, setPendingLink] = useState<{ email: string; link: string } | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const address = email.trim().toLowerCase();
    if (busy || disabled) return;
    if (!EMAIL_SHAPE.test(address)) {
      toast.error(t("team.invite.invalidEmail"));
      return;
    }
    setBusy(true);
    try {
      const result = await inviteMember({ data: { ...(await withToken()), orgId, email: address, role } });
      setEmail("");
      if (result.emailed) {
        setPendingLink(null);
        toast.success(t("team.invite.sent", { email: address }));
      } else {
        setPendingLink({ email: address, link: result.link });
        toast.success(t("team.invite.created", { email: address }));
      }
      onInvited();
    } catch (error) {
      console.error(error);
      if (errorSays(error, "TEAM:duplicate")) toast.error(t("team.invite.duplicate"));
      else if (errorSays(error, "TEAM:already_member")) toast.error(t("team.invite.alreadyMember"));
      else toast.error(errorMessage(locale, error, { "ORG:seats": t("team.invite.seats") }));
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    if (!pendingLink) return;
    try {
      await navigator.clipboard.writeText(pendingLink.link);
      toast(t("common.copied"));
    } catch (error) {
      console.error(error);
      toast.error(t("common.error"));
    }
  }

  return (
    <form onSubmit={submit} className="sheet p-4 sm:p-5">
      <h2 className="font-display text-lg text-ink">{t("team.invite.title")}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{t("team.invite.text")}</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_11rem_auto] sm:items-end">
        <div className="space-y-1.5">
          <Label htmlFor="invite-email">{t("auth.email")}</Label>
          <Input
            id="invite-email"
            type="email"
            autoComplete="off"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={busy || disabled}
            maxLength={254}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="invite-role">{t("common.role")}</Label>
          <Select value={role} onValueChange={(value) => setRole(value as InviteRole)} disabled={busy || disabled}>
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
        <Button type="submit" disabled={busy || disabled || !email.trim()} className="gap-2">
          <UserPlus />
          {t("team.invite.send")}
        </Button>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">{t(`role.${role}.help`)}</p>
      {disabled ? <p className="mt-3 text-sm text-caution">{t("members.seatsFull")}</p> : null}
      {pendingLink ? (
        <div className="mt-4 rounded-xl border border-caution/40 bg-caution/10 p-3 text-sm">
          <p className="text-ink">{t("team.invite.notEmailed")}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-md bg-background px-2 py-1 text-xs">{pendingLink.link}</code>
            <Button type="button" size="sm" variant="outline" onClick={() => void copyLink()} className="gap-1.5">
              <Copy />
              {t("team.invite.copyLink")}
            </Button>
          </div>
        </div>
      ) : null}
    </form>
  );
}
