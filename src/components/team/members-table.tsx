/**
 * The members of the organisation as rows in one card: the avatar, the
 * name and the email, when they joined, the role (a Select when the
 * viewer may change it, a pill otherwise) and the remove button (leave,
 * for oneself). Rows rise in once. Decisions and confirmations belong
 * to the page; this only renders and reports clicks.
 */
import { LogOut, Trash2 } from "lucide-react";

import { Avatar } from "@/components/app-shell/avatar";
import { EmptyState } from "@/components/app-shell/empty-state";
import { Pill, type PillTone } from "@/components/app-shell/pill";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
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
  if (members.length === 0) return <EmptyState title={t("members.empty")} compact />;
  return (
    <ul className="sheet stagger overflow-hidden">
      {members.map((member) => {
        const self = member.userId === currentUserId;
        const name = memberName(
          member.profile ?? undefined,
          member.profile?.email ?? member.userId.slice(0, 8),
        );
        const roles = assignableRoles(actorRole, member.role);
        const busy = busyUserId === member.userId;
        const removeLabel = self ? t("members.leave") : t("members.remove");
        const email = member.profile?.email ?? "";
        return (
          <li key={member.userId} className="sheet-row rise-in flex-wrap">
            <Avatar name={name} size="md" />
            <div className="min-w-[10rem] flex-1">
              <p className="truncate text-sm font-semibold text-ink">
                {name}
                {self ? (
                  <span className="ml-1.5 font-normal text-muted-foreground">
                    ({t("common.you")})
                  </span>
                ) : null}
              </p>
              <p className="truncate text-meta text-muted-foreground">
                {email ? <span>{email}</span> : null}
                {email ? <span aria-hidden="true"> · </span> : null}
                <span className="tabular-nums">
                  {t("members.joined", { date: formatDate(locale, member.joinedAt) })}
                </span>
              </p>
            </div>
            <div className="ml-13 flex shrink-0 items-center gap-2 sm:ml-0">
              {roles.length ? (
                <Select
                  value={member.role}
                  onValueChange={(value) => onRoleChange(member, value as OrgRole)}
                  disabled={busy}
                >
                  <SelectTrigger className="w-40 text-meta" aria-label={t("common.role")}>
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
              {self || roles.length ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => onRemove(member)}
                      disabled={busy}
                      className="text-muted-foreground hover:text-negative"
                      aria-label={removeLabel}
                    >
                      {self ? <LogOut /> : <Trash2 />}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{removeLabel}</TooltipContent>
                </Tooltip>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
