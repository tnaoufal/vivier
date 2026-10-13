/**
 * The members of the organisation as a table that scrolls inside its
 * card: avatar, name and email, the role (a Select when the viewer may
 * change it, a pill otherwise), the joining date, and the remove button
 * (leave, for oneself). Decisions and confirmations belong to the page;
 * this only renders and reports clicks.
 */
import { LogOut, Trash2 } from "lucide-react";

import { Avatar } from "@/components/app-shell/avatar";
import { EmptyState } from "@/components/app-shell/empty-state";
import { Pill, type PillTone } from "@/components/app-shell/pill";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { OrgRole } from "@/lib/db/types";
import { formatDate, useI18n } from "@/lib/i18n";
import { memberName } from "@/lib/org/org-context";
import { assignableRoles, type TeamMember } from "@/lib/team/team";

const ROLE_TONES: Record<OrgRole, PillTone> = {
  owner: "primary",
  admin: "positive",
  member: "neutral",
  viewer: "neutral",
};

export function MembersTable({
  members,
  currentUserId,
  actorRole,
  busyUserId,
  onRoleChange,
  onRemove,
}: {
  members: TeamMember[];
  currentUserId: string;
  actorRole: OrgRole;
  /** The member a change is running for; their controls are disabled. */
  busyUserId: string | null;
  onRoleChange: (member: TeamMember, role: OrgRole) => void;
  onRemove: (member: TeamMember) => void;
}) {
  const { locale, t } = useI18n();
  if (members.length === 0) return <EmptyState title={t("members.empty")} />;
  return (
    <div className="sheet overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[40rem] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left">
              <th scope="col" className="label-caps px-6 py-3">
                {t("members.table.member")}
              </th>
              <th scope="col" className="label-caps px-6 py-3">
                {t("common.role")}
              </th>
              <th scope="col" className="label-caps px-6 py-3">
                {t("members.table.since")}
              </th>
              <th scope="col" className="px-6 py-3">
                <span className="sr-only">{t("common.actions")}</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {members.map((member) => {
              const self = member.userId === currentUserId;
              const name = memberName(member.profile ?? undefined, member.profile?.email ?? member.userId.slice(0, 8));
              const roles = assignableRoles(actorRole, member.role);
              const busy = busyUserId === member.userId;
              const removeLabel = self ? t("members.leave") : t("members.remove");
              return (
                <tr key={member.userId}>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <Avatar name={name} />
                      <div className="min-w-0 max-w-64">
                        <p className="truncate font-medium text-ink">
                          {name}
                          {self ? <span className="ml-1.5 text-[13px] font-normal text-muted-foreground">({t("common.you")})</span> : null}
                        </p>
                        <p className="truncate text-[13px] leading-5 text-muted-foreground">{member.profile?.email ?? ""}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    {roles.length ? (
                      <Select value={member.role} onValueChange={(value) => onRoleChange(member, value as OrgRole)} disabled={busy}>
                        <SelectTrigger className="w-44 text-[13px]" aria-label={t("common.role")}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {roles.map((role) => (
                            <SelectItem key={role} value={role}>
                              {t(`role.${role}`)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Pill tone={ROLE_TONES[member.role]} dot>
                        {t(`role.${member.role}`)}
                      </Pill>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-muted-foreground tabular-nums">{formatDate(locale, member.joinedAt)}</td>
                  <td className="px-6 py-4 text-right">
                    {self || roles.length ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onRemove(member)}
                        disabled={busy}
                        className="text-negative hover:text-negative"
                        aria-label={removeLabel}
                        title={removeLabel}
                      >
                        {self ? <LogOut /> : <Trash2 />}
                        {self ? t("members.leave") : t("common.remove")}
                      </Button>
                    ) : null}
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
