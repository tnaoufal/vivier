/**
 * The team page, for everyone: the members with their roles as rows;
 * for administrators and owners, the pending invitations under them,
 * the plan card with its two usages beside, and the page's one filled
 * button, "Inviter", which opens the invite dialog. A quiet link leads
 * to the activity log. Every removal is confirmed; the database keeps
 * the last owner; leaving oneself lives in the settings.
 */
import { useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { Activity, RefreshCw, TriangleAlert, UserPlus } from "lucide-react";

import { ConfirmDialog } from "@/components/app-shell/confirm-dialog";
import { EmptyState } from "@/components/app-shell/empty-state";
import { PageHeader } from "@/components/app-shell/page-header";
import { Section } from "@/components/app-shell/section";
import { InvitationsList } from "@/components/team/invitations-list";
import { InviteDialog } from "@/components/team/invite-dialog";
import { MembersTable } from "@/components/team/members-table";
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
  const admin = can("admin");
  const userId = user?.id ?? "";

  const { data, loading, error, refresh } = useQuery(`members:${org.id}:${admin}`, async () => {
    const supabase = await requireSupabase();
    const unread = (caught: unknown) => {
      console.error(caught);
      return null;
    };
    // Invitations and counters are the administrators': a member reads the roster alone.
    const [members, invitations, seatsUsed, cvsProcessed] = await Promise.all([
      readMembers(supabase, org.id),
      admin ? readPendingInvitations(supabase, org.id) : Promise.resolve<InvitationRow[]>([]),
      admin ? readSeatsUsed(supabase, org.id).catch(unread) : Promise.resolve(null),
      admin ? readCvsProcessedThisMonth(supabase, org.id).catch(unread) : Promise.resolve(null),
    ]);
    return { members, invitations, seatsUsed, cvsProcessed };
  });

  const [inviteOpen, setInviteOpen] = useState(false);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [busyInvitationId, setBusyInvitationId] = useState<string | null>(null);
  const [removing, setRemoving] = useState<TeamMember | null>(null);
  const [revoking, setRevoking] = useState<InvitationRow | null>(null);

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
    setBusyUserId(target.userId);
    try {
      const supabase = await requireSupabase();
      await removeMember(supabase, org.id, target.userId);
      setRemoving(null);
      toast.success(t("members.removed"));
      await refresh();
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
    ? memberName(
        removing.profile ?? undefined,
        removing.profile?.email ?? removing.userId.slice(0, 8),
      )
    : "";
  const members = data?.members ?? [];
  const invitations = data?.invitations ?? [];
  const ready = !(loading && !data);

  const lists = (
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
      {admin ? (
        <Section title={t("members.invitations")} count={ready ? invitations.length : undefined}>
          {!ready ? (
            <ListSkeleton />
          ) : (
            <InvitationsList
              invitations={invitations}
              busyId={busyInvitationId}
              onRevoke={setRevoking}
            />
          )}
        </Section>
      ) : null}
    </div>
  );

  return (
    <>
      {/* No seat figure here: the plan card beside the lists carries the seats, said once. */}
      <PageHeader
        eyebrow={org.name}
        title={t("nav.members")}
        actions={
          <>
            <Button asChild variant="ghost" icon={<Activity />}>
              <Link to="/app/activity">{t("nav.activity")}</Link>
            </Button>
            {admin ? (
              <Button
                type="button"
                icon={<UserPlus />}
                onClick={() => setInviteOpen(true)}
                disabled={seatsFull}
              >
                {t("team.invite")}
              </Button>
            ) : null}
          </>
        }
      />

      {/* A failed read is said as such: an empty team would be a false fact. */}
      {error && !data ? (
        <EmptyState
          icon={<TriangleAlert />}
          title={t("common.error")}
          action={
            <Button
              type="button"
              variant="outline"
              icon={<RefreshCw />}
              onClick={() => void refresh()}
            >
              {t("common.retry")}
            </Button>
          }
        />
      ) : admin ? (
        <div className="grid gap-8 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-start">
          {lists}
          <aside className="lg:sticky lg:top-8">
            <PlanCard
              org={org}
              seatsUsed={seatsUsed}
              cvsProcessed={data?.cvsProcessed ?? null}
              loading={!ready}
            />
          </aside>
        </div>
      ) : (
        lists
      )}

      {admin ? (
        <InviteDialog
          open={inviteOpen}
          onOpenChange={setInviteOpen}
          orgId={org.id}
          onInvited={() => void refresh()}
        />
      ) : null}

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
        title={t("members.remove.title", { name: removingName })}
        text={t("members.remove.text", { name: removingName })}
        confirmLabel={t("common.remove")}
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
