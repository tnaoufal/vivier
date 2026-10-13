/** Pending invitations: the address, the role, when the link expires, and a revoke button. */
import { Mail, Trash2 } from "lucide-react";

import { EmptyState } from "@/components/app-shell/empty-state";
import { Pill } from "@/components/app-shell/pill";
import { Button } from "@/components/ui/button";
import type { InvitationRow } from "@/lib/db/types";
import { formatDate, useI18n } from "@/lib/i18n";

export function isInvitationExpired(invitation: InvitationRow, now: number = Date.now()): boolean {
  return new Date(invitation.expires_at).getTime() < now;
}

export function InvitationsList({
  invitations,
  busyId,
  onRevoke,
}: {
  invitations: InvitationRow[];
  busyId: string | null;
  onRevoke: (invitation: InvitationRow) => void;
}) {
  const { locale, t } = useI18n();
  if (invitations.length === 0) {
    return <EmptyState icon={<Mail />} title={t("members.invitations.empty")} className="py-8" />;
  }
  return (
    <ul className="sheet divide-y divide-border">
      {invitations.map((invitation) => {
        const expired = isInvitationExpired(invitation);
        return (
          <li key={invitation.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-ink">{invitation.email}</p>
              <p className="text-xs text-muted-foreground">
                {t(`role.${invitation.role}`)}
                {" · "}
                {expired
                  ? t("members.invitations.expired")
                  : t("members.invitations.expires", { date: formatDate(locale, invitation.expires_at) })}
              </p>
            </div>
            {expired ? <Pill tone="caution">{t("members.invitations.expired")}</Pill> : null}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onRevoke(invitation)}
              disabled={busyId === invitation.id}
              className="gap-1.5 text-negative hover:text-negative"
            >
              <Trash2 />
              {t("members.invitations.revoke")}
            </Button>
          </li>
        );
      })}
    </ul>
  );
}
