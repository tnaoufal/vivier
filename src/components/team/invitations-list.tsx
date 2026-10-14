/**
 * Pending invitations as rows in one card: the address, the role, when
 * the link expires (a caution pill once it has), and the revoke button.
 * Rows rise in once.
 */
import { Mail, Trash2 } from "lucide-react";

import { EmptyState } from "@/components/app-shell/empty-state";
import { Pill } from "@/components/app-shell/pill";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
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
    return <EmptyState icon={<Mail />} title={t("members.invitations.empty")} compact />;
  }
  return (
    <ul className="sheet stagger overflow-hidden">
      {invitations.map((invitation) => {
        const expired = isInvitationExpired(invitation);
        const revokeLabel = t("members.invitations.revoke");
        return (
          <li key={invitation.id} className="sheet-row rise-in">
            <span
              aria-hidden="true"
              className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground [&_svg]:size-4"
            >
              <Mail />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-ink">{invitation.email}</p>
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-meta text-muted-foreground">
                <span>{t(`role.${invitation.role}`)}</span>
                <span aria-hidden="true">·</span>
                {expired ? (
                  <Pill tone="caution" size="sm" dot>
                    {t("members.invitations.expired")}
                  </Pill>
                ) : (
                  <span className="tabular-nums">
                    {t("members.invitations.expires", { date: formatDate(locale, invitation.expires_at) })}
                  </span>
                )}
              </p>
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => onRevoke(invitation)}
                  disabled={busyId === invitation.id}
                  className="text-muted-foreground hover:text-negative"
                  aria-label={revokeLabel}
                >
                  <Trash2 />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{revokeLabel}</TooltipContent>
            </Tooltip>
          </li>
        );
      })}
    </ul>
  );
}
