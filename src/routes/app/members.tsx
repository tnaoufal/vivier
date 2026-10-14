/**
 * The team page, for administrators and owners: the members with their
 * roles and the pending invitations on the left, the invite form (the
 * page's one primary action) and the plan card with its meters on the
 * right. A member or a viewer sees the refusal instead. Every removal
 * is confirmed; the database keeps the last owner.
 */
import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { RefreshCw, TriangleAlert, UserPlus } from "lucide-react";

import { ConfirmDialog } from "@/components/app-shell/confirm-dialog";
import { EmptyState } from "@/components/app-shell/empty-state";
import { PageHeader } from "@/components/app-shell/page-header";
import { Section } from "@/components/app-shell/section";
import { InviteForm } from "@/components/team/invite-form";
import { InvitationsList } from "@/components/team/invitations-list";
import { MembersTable } from "@/components/team/members-table";
import { NotAllowed } from "@/components/team/not-allowed";
import { PlanCard } from "@/components/team/plan-card";
import { Button } from "@/components/ui/button";
import { SkeletonRows } from "@/components/ui/skeleton";
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
  readCvsProcessedThisMonth,
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

const INVITE_ANCHOR = "invite";

function ListSkeleton() {
  return (
    <div className="sheet overflow-hidden">
      <SkeletonRows rows={3} />
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

  const { data, loading, error, refresh } = useQuery(
    `members:${org.id}`,
    async () => {
      const supabase = await requireSupabase();
      const unread = (caught: unknown) => {
        console.error(caught);
        return null;
      };
      const [members, invitations, seatsUsed, cvsProcessed] = await Promise.all([
        readMembers(supabase, org.id),
        readPendingInvitations(supabase, org.id),
        readSeatsUsed(supabase, org.id).catch(unread),
        readCvsProcessedThisMonth(supabase, org.id).catch(unread),
      ]);
      return { members, invitations, seatsUsed, cvsProcessed };
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
        <PageHeader eyebrow={org.name} title={t("nav.members")} />
        <NotAllowed />
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
    } catch (caught) {
      console.error(caught);
      toast.error(errorSays(caught, "ORG:last_owner") ? t("members.lastOwner") : t("common.error"));
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
    } catch (caught) {
      console.error(caught);
      toast.error(errorSays(caught, "ORG:last_owner") ? t("members.lastOwner") : t("common.error"));
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
    } catch (caught) {
      console.error(caught);
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
  const ready = !(loading && !data);

  return (
    <>
      {/* No seat pill here: the plan card beside the lists carries the seats, said once. */}
      <PageHeader
        eyebrow={org.name}
        title={t("nav.members")}
        actions={
          <Button asChild variant="outline" icon={<UserPlus />} className="lg:hidden">
            <a href={`#${INVITE_ANCHOR}`}>{t("members.invite.jump")}</a>
          </Button>
        }
      />

      <div className="grid gap-8 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-start">
        {/* A failed read is said as such: an empty team would be a false fact. */}
        {error && !data ? (
          <EmptyState
            icon={<TriangleAlert />}
            title={t("common.error")}
            action={
              <Button type="button" variant="outline" icon={<RefreshCw />} onClick={() => void refresh()}>
                {t("common.retry")}
              </Button>
            }
          />
        ) : (
          <div className="space-y-8">
            <Section title={t("members.list")} count={ready ? members.length : undefined}>
              {!ready ? (
                <ListSkeleton />
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

            <Section title={t("members.invitations")} count={ready ? invitations.length : undefined}>
              {!ready ? <ListSkeleton /> : <InvitationsList invitations={invitations} busyId={busyInvitationId} onRevoke={setRevoking} />}
            </Section>
          </div>
        )}

        <aside className="space-y-6 lg:sticky lg:top-8">
          <InviteForm id={INVITE_ANCHOR} orgId={org.id} disabled={seatsFull} onInvited={() => void refresh()} />
          <PlanCard org={org} seatsUsed={seatsUsed} cvsProcessed={data?.cvsProcessed ?? null} loading={!ready} />
        </aside>
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
