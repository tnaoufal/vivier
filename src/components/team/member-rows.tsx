/**
 * The members of the space as rows: the avatar, the name (and "vous"
 * for the person reading) over the email, then, beside the row, the
 * role (a Select when the reader may change it, muted text otherwise)
 * and the remove button for the members the reader manages. Leaving
 * oneself lives in the settings' danger zone, not here. Rows rise in
 * once. Decisions and confirmations belong to the page; this only
 * renders and reports clicks.
 */
import { Fragment } from "react";
import { Trash2, UsersRound } from "lucide-react";

import { Avatar } from "@/components/app-shell/avatar";
import { EmptyState } from "@/components/app-shell/empty-state";
import { Row, RowText } from "@/components/app-shell/row";
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
import { useT } from "@/lib/i18n";
import { memberName } from "@/lib/org/org-context";
import { assignableRoles, type TeamMember } from "@/lib/team/team";

export function MemberRows({
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
  const t = useT();
  if (members.length === 0) {
    return <EmptyState quiet icon={<UsersRound />} title={t("members.empty")} />;
  }
  return (
    <ol className="stagger">
      {members.map((member) => {
        const self = member.userId === currentUserId;
        const name = memberName(
          member.profile ?? undefined,
          member.profile?.email ?? member.userId.slice(0, 8),
        );
        const roles = assignableRoles(actorRole, member.role);
        const busy = busyUserId === member.userId;
        const removeLabel = t("members.remove");
        const email = member.profile?.email ?? "";
        return (
          <Fragment key={member.userId}>
            <Row
              height="lg"
              className="rise-in"
              leading={<Avatar name={name} size="md" decorative />}
              trailing={
                <>
                  {roles.length ? (
                    <Select
                      value={member.role}
                      onValueChange={(value) => onRoleChange(member, value as OrgRole)}
                      disabled={busy}
                    >
                      <SelectTrigger
                        className="w-34 text-meta sm:w-40"
                        aria-label={t("common.role")}
                      >
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
                    <span className="px-2 text-meta text-muted-foreground">
                      {t(`role.${member.role}`)}
                    </span>
                  )}
                  {!self && roles.length ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => onRemove(member)}
                          disabled={busy}
                          className="text-muted-foreground hover:text-ink"
                          aria-label={removeLabel}
                        >
                          <Trash2 />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{removeLabel}</TooltipContent>
                    </Tooltip>
                  ) : null}
                </>
              }
            >
              <RowText
                title={
                  <>
                    {name}
                    {self ? (
                      <span className="ml-1.5 font-normal text-muted-foreground">
                        ({t("common.you")})
                      </span>
                    ) : null}
                  </>
                }
                line={email || undefined}
              />
            </Row>
          </Fragment>
        );
      })}
    </ol>
  );
}
