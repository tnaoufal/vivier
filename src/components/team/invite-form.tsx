/**
 * Inviting a colleague: an address and a role, sent to the server
 * function that writes the invitation and emails it. A malformed address
 * is refused inline, under the field, before any call. When no email
 * went out (Resend not set up, or the send failed) the link is shown
 * once with a copy button so the inviter can pass it on themselves.
 */
import { useId, useState, type FormEvent } from "react";
import { Copy, UserPlus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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

export function InviteForm({
  orgId,
  disabled,
  onInvited,
  id,
}: {
  orgId: string;
  /** True when no seat is left: the form explains instead of trying. */
  disabled: boolean;
  onInvited: () => void;
  /** An anchor the page may jump to. */
  id?: string | undefined;
}) {
  const { t, locale } = useI18n();
  const errorId = useId();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<InviteRole>("member");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingLink, setPendingLink] = useState<{ email: string; link: string } | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const address = email.trim().toLowerCase();
    if (busy || disabled) return;
    if (!EMAIL_SHAPE.test(address)) {
      setError(t("team.invite.invalidEmail"));
      return;
    }
    setError(null);
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
    <form id={id} onSubmit={submit} className="sheet scroll-mt-24 p-6" aria-labelledby="invite-form-title">
      <h2 id="invite-form-title" className="font-display text-xl text-ink">
        {t("team.invite.title")}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">{t("team.invite.text")}</p>
      <div className="mt-6 space-y-5">
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
            disabled={busy || disabled}
            maxLength={254}
            required
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
          />
          {error ? (
            <p id={errorId} role="alert" className="text-meta text-negative">
              {error}
            </p>
          ) : null}
        </div>
        <div className="space-y-2">
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
          <p className="text-meta text-muted-foreground">{t(roleHelpKey(role))}</p>
        </div>
      </div>
      {disabled ? <p className="mt-4 text-sm text-caution-foreground dark:text-caution">{t("members.seatsFull")}</p> : null}
      <div className="mt-6">
        <Button type="submit" className="w-full" icon={<UserPlus />} disabled={busy || disabled || !email.trim()}>
          {t("team.invite.send")}
        </Button>
      </div>
      {pendingLink ? (
        <div className="fade-in mt-6 rounded-lg border border-caution/40 bg-caution/10 p-4 text-sm">
          <p className="text-ink">{t("team.invite.notEmailed")}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-sm bg-card px-3 py-2 text-xs">{pendingLink.link}</code>
            <Button type="button" variant="outline" icon={<Copy />} onClick={() => void copyLink()}>
              {t("team.invite.copyLink")}
            </Button>
          </div>
        </div>
      ) : null}
    </form>
  );
}
