/**
 * The members of the organisation: avatar, name, email, role (a Select
 * when the viewer may change it, a pill otherwise), joining date, and
 * the remove button (leave, for oneself). Decisions and confirmations
 * belong to the page; this only renders and reports clicks.
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
    <ul className="sheet divide-y divide-border">
      {members.map((member) => {
        const self = member.userId === currentUserId;
        const name = memberName(member.profile ?? undefined, member.profile?.email ?? member.userId.slice(0, 8));
        const roles = assignableRoles(actorRole, member.role);
        const busy = busyUserId === member.userId;
        return (
          <li key={member.userId} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <Avatar name={name} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-ink">
                {name}
                {self ? <span className="ml-1.5 text-xs font-normal text-muted-foreground">({t("common.you")})</span> : null}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {member.profile?.email ?? ""}
                {member.profile?.email ? " · " : ""}
                {t("members.joined", { date: formatDate(locale, member.joinedAt) })}
              </p>
            </div>
            <div className="flex w-full items-center justify-between gap-2 sm:w-auto sm:justify-end">
              {roles.length ? (
                <Select value={member.role} onValueChange={(value) => onRoleChange(member, value as OrgRole)} disabled={busy}>
                  <SelectTrigger className="h-8 w-40 text-xs" aria-label={t("common.role")}>
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
                <Pill tone={ROLE_TONES[member.role]}>{t(`role.${member.role}`)}</Pill>
              )}
              {self || roles.length ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onRemove(member)}
                  disabled={busy}
                  className="gap-1.5 text-negative hover:text-negative"
                  aria-label={self ? t("members.leave") : t("members.remove")}
                  title={self ? t("members.leave") : t("members.remove")}
                >
                  {self ? <LogOut /> : <Trash2 />}
                  <span className="hidden sm:inline">{self ? t("members.leave") : t("common.remove")}</span>
                </Button>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
