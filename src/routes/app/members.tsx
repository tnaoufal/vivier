/**
 * The team page, for administrators and owners: seats, the invite form,
 * the members with their roles, the pending invitations. A member or a
 * viewer sees one sentence instead. Every removal is confirmed; the
 * database keeps the last owner.
 */
import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { ConfirmDialog } from "@/components/app-shell/confirm-dialog";
import { PageHeader } from "@/components/app-shell/page-header";
import { Pill } from "@/components/app-shell/pill";
import { Section } from "@/components/app-shell/section";
import { InviteForm } from "@/components/team/invite-form";
import { InvitationsList } from "@/components/team/invitations-list";
import { MembersTable } from "@/components/team/members-table";
import { NotAllowed } from "@/components/team/not-allowed";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/lib/auth/auth-context";
import { requireSupabase } from "@/lib/auth/supabase-client";
import { useQuery } from "@/lib/data/use-query";
import type { InvitationRow, OrgRole } from "@/lib/db/types";
import { useI18n } from "@/lib/i18n";
import { memberName, useCurrentOrg, useOrg } from "@/lib/org/org-context";
import { seatsAvailable } from "@/lib/team/seats";
import {
  changeMemberRole,
  errorSays,
  readMembers,
  readPendingInvitations,
  readSeatsUsed,
  removeMember,
  revokeInvitation,
  type TeamMember,
} from "@/lib/team/team";
import { toast } from "@/lib/toast";

export const Route = createFileRoute("/app/members")({
  component: MembersPage,
});

function TableSkeleton() {
  return (
    <div className="sheet overflow-hidden" aria-busy="true">
      {[0, 1, 2].map((index) => (
        <div key={index} className="sheet-row">
          <Skeleton className="size-9 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}

function MembersPage() {
  const { t } = useI18n();
  const { org, role } = useCurrentOrg();
  const { can, refresh: refreshOrg } = useOrg();
  const { user } = useAuth();
  const navigate = useNavigate();
  const allowed = can("admin");
  const userId = user?.id ?? "";

  const { data, loading, refresh } = useQuery(
    `members:${org.id}`,
    async () => {
      const supabase = await requireSupabase();
      const [members, invitations, seatsUsed] = await Promise.all([
        readMembers(supabase, org.id),
        readPendingInvitations(supabase, org.id),
        readSeatsUsed(supabase, org.id).catch((error: unknown) => {
          console.error(error);
          return null;
        }),
      ]);
      return { members, invitations, seatsUsed };
    },
    allowed,
  );

  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [busyInvitationId, setBusyInvitationId] = useState<string | null>(null);
  const [removing, setRemoving] = useState<TeamMember | null>(null);
  const [revoking, setRevoking] = useState<InvitationRow | null>(null);

  if (!allowed) {
    return (
      <>
        <PageHeader eyebrow={org.name} title={t("nav.members")} description={t("members.subtitle", { org: org.name })} />
        <NotAllowed text={t("members.notAllowed")} />
      </>
    );
  }

  const seatsUsed = data?.seatsUsed ?? null;
  const seatsFull = seatsUsed !== null && !seatsAvailable(seatsUsed, org.seat_limit);

  async function handleRoleChange(member: TeamMember, next: OrgRole) {
    if (next === member.role || busyUserId) return;
    setBusyUserId(member.userId);
    try {
      const supabase = await requireSupabase();
      await changeMemberRole(supabase, org.id, member.userId, next);
      toast.success(t("members.roleChanged"));
      await refresh();
      if (member.userId === userId) await refreshOrg();
    } catch (error) {
      console.error(error);
      toast.error(errorSays(error, "ORG:last_owner") ? t("members.lastOwner") : t("common.error"));
    } finally {
      setBusyUserId(null);
    }
  }

  async function confirmRemove() {
    if (!removing || busyUserId) return;
    const target = removing;
    const self = target.userId === userId;
    setBusyUserId(target.userId);
    try {
      const supabase = await requireSupabase();
      await removeMember(supabase, org.id, target.userId);
      setRemoving(null);
      if (self) {
        toast.success(t("members.left"));
        await refreshOrg();
        void navigate({ to: "/app" });
      } else {
        toast.success(t("members.removed"));
        await refresh();
      }
    } catch (error) {
      console.error(error);
      toast.error(errorSays(error, "ORG:last_owner") ? t("members.lastOwner") : t("common.error"));
    } finally {
      setBusyUserId(null);
    }
  }

  async function confirmRevoke() {
    if (!revoking || busyInvitationId) return;
    const target = revoking;
    setBusyInvitationId(target.id);
    try {
      const supabase = await requireSupabase();
      await revokeInvitation(supabase, org.id, target.id);
      setRevoking(null);
      toast.success(t("members.invitations.revoked"));
      await refresh();
    } catch (error) {
      console.error(error);
      toast.error(t("common.error"));
    } finally {
      setBusyInvitationId(null);
    }
  }

  const removingName = removing
    ? memberName(removing.profile ?? undefined, removing.profile?.email ?? removing.userId.slice(0, 8))
    : "";
  const removingSelf = removing?.userId === userId;
  const members = data?.members ?? [];
  const invitations = data?.invitations ?? [];

  return (
    <>
      <PageHeader
        eyebrow={org.name}
        title={t("nav.members")}
        description={t("members.subtitle", { org: org.name })}
        actions={
          seatsUsed !== null ? (
            <Pill tone={seatsFull ? "caution" : "neutral"} dot>
              {t("shell.org.seats", { used: seatsUsed, limit: org.seat_limit })}
            </Pill>
          ) : null
        }
      />

      <div className="space-y-8">
        <InviteForm orgId={org.id} disabled={seatsFull} onInvited={() => void refresh()} />

        <Section title={t("nav.members")} count={loading && !data ? undefined : members.length}>
          {loading && !data ? (
            <TableSkeleton />
          ) : (
            <MembersTable
              members={members}
              currentUserId={userId}
              actorRole={role}
              busyUserId={busyUserId}
              onRoleChange={(member, next) => void handleRoleChange(member, next)}
              onRemove={setRemoving}
            />
          )}
        </Section>

        <Section title={t("members.invitations")} count={loading && !data ? undefined : invitations.length}>
          {loading && !data ? (
            <TableSkeleton />
          ) : (
            <InvitationsList invitations={invitations} busyId={busyInvitationId} onRevoke={setRevoking} />
          )}
        </Section>
      </div>

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
        title={removingSelf ? t("members.leave.title", { org: org.name }) : t("members.remove.title", { name: removingName })}
        text={removingSelf ? t("members.leave.text") : t("members.remove.text", { name: removingName })}
        confirmLabel={removingSelf ? t("members.leave") : t("common.remove")}
        destructive
        busy={busyUserId !== null}
        onConfirm={confirmRemove}
      />

      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(open) => {
          if (!open) setRevoking(null);
        }}
        title={t("members.invitations.revoke.title", { email: revoking?.email ?? "" })}
        text={t("members.invitations.revoke.text")}
        confirmLabel={t("members.invitations.revoke")}
        destructive
        busy={busyInvitationId !== null}
        onConfirm={confirmRevoke}
      />
    </>
  );
}
