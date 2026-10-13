/** Pending invitations as a table that scrolls inside its card: the address, the role, when the link expires, a revoke button. */
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
    return <EmptyState icon={<Mail />} title={t("members.invitations.empty")} className="py-10" />;
  }
  return (
    <div className="sheet overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[36rem] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left">
              <th scope="col" className="label-caps px-6 py-3">
                {t("common.email")}
              </th>
              <th scope="col" className="label-caps px-6 py-3">
                {t("common.role")}
              </th>
              <th scope="col" className="label-caps px-6 py-3">
                {t("members.invitations.expiry")}
              </th>
              <th scope="col" className="px-6 py-3">
                <span className="sr-only">{t("common.actions")}</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {invitations.map((invitation) => {
              const expired = isInvitationExpired(invitation);
              return (
                <tr key={invitation.id}>
                  <td className="px-6 py-4">
                    <p className="max-w-64 truncate font-medium text-ink">{invitation.email}</p>
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-muted-foreground">{t(`role.${invitation.role}`)}</td>
                  <td className="whitespace-nowrap px-6 py-4">
                    {expired ? (
                      <Pill tone="caution" dot>
                        {t("members.invitations.expired")}
                      </Pill>
                    ) : (
                      <span className="text-muted-foreground">
                        {t("members.invitations.expires", { date: formatDate(locale, invitation.expires_at) })}
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onRevoke(invitation)}
                      disabled={busyId === invitation.id}
                      className="text-negative hover:text-negative"
                    >
                      <Trash2 />
                      {t("members.invitations.revoke")}
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
