/**
 * Pending invitations as rows: the address over the role and when the
 * link expires (a caution pill once it has), the revoke button beside
 * the row. Rows rise in once; nothing when there is none but one quiet
 * line.
 */
import { Fragment } from "react";
import { Mail, Trash2 } from "lucide-react";

import { EmptyState } from "@/components/app-shell/empty-state";
import { Pill } from "@/components/app-shell/pill";
import { Row, RowText } from "@/components/app-shell/row";
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
    return (
      <EmptyState quiet icon={<Mail />} title={t("members.invitations.empty")} className="py-6" />
    );
  }
  const revokeLabel = t("members.invitations.revoke");
  return (
    <ol className="stagger">
      {invitations.map((invitation) => {
        const expired = isInvitationExpired(invitation);
        return (
          <Fragment key={invitation.id}>
            <Row
              className="rise-in"
              trailing={
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => onRevoke(invitation)}
                      disabled={busyId === invitation.id}
                      className="text-muted-foreground hover:text-ink"
                      aria-label={revokeLabel}
                    >
                      <Trash2 />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{revokeLabel}</TooltipContent>
                </Tooltip>
              }
            >
              <RowText
                title={invitation.email}
                line={
                  <>
                    {t(`role.${invitation.role}`)}
                    <span aria-hidden="true"> · </span>
                    {expired ? (
                      <Pill tone="caution" size="sm" dot>
                        {t("members.invitations.expired")}
                      </Pill>
                    ) : (
                      t("members.invitations.expires", {
                        date: formatDate(locale, invitation.expires_at),
                      })
                    )}
                  </>
                }
              />
            </Row>
          </Fragment>
        );
      })}
    </ol>
  );
}
