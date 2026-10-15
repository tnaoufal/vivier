/**
 * The team page on the plane, for everyone: the title names the kind of
 * space ("Équipe", or "Espace personnel" for a person working alone),
 * the meta counts the members and names the plan (a personal space says
 * instead, in one line, that inviting someone makes it a team), the one
 * filled button invites (administrators and owners, held while the
 * seats are full) and the menu leads to the activity log. The members
 * as rows in the wide pane; for administrators and owners the fill pane
 * holds the pending invitations and the plan's two usages. Every
 * removal is confirmed; the database keeps the last owner; leaving
 * oneself lives in the settings.
 */
import { useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { Activity, Ellipsis, RefreshCw, TriangleAlert, UserPlus } from "lucide-react";

import { ConfirmDialog } from "@/components/app-shell/confirm-dialog";
import { EmptyState } from "@/components/app-shell/empty-state";
import { Section } from "@/components/app-shell/section";
import { PHONE_ICON, Pane, PaneTitle, Workspace } from "@/components/app-shell/workspace";
import { InvitationsList } from "@/components/team/invitations-list";
import { InviteDialog } from "@/components/team/invite-dialog";
import { MemberRows } from "@/components/team/member-rows";
import { PlanUsage } from "@/components/team/plan-usage";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SkeletonRows } from "@/components/ui/skeleton";
import { useAuth } from "@/lib/auth/auth-context";
import { requireSupabase } from "@/lib/auth/supabase-client";
import { formatCount } from "@/lib/candidates/format";
import { useQuery } from "@/lib/data/use-query";
import type { InvitationRow, OrgRole } from "@/lib/db/types";
import { useI18n } from "@/lib/i18n";
import { isPersonal, memberName, useCurrentOrg, useOrg } from "@/lib/org/org-context";
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

function MembersPage() {
  const { t, locale } = useI18n();
  const { org, role } = useCurrentOrg();
  const { can, refresh: refreshOrg } = useOrg();
  const { user } = useAuth();
  const admin = can("admin");
  const personal = isPersonal(org);
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
  // A failed read is said as such: an empty team, or no invitation, would be a false fact.
  const failed = error !== null && data === null;
  const countText = !ready
    ? null
    : members.length === 1
      ? t("members.count.one")
      : t("members.count.many", { count: formatCount(locale, members.length) });
  const consequence = t("members.personal.invite");

  return (
    <Workspace
      title={personal ? t("nav.personalSpace") : t("nav.members")}
      meta={
        personal ? (
          <span>{consequence}</span>
        ) : (
          <>
            {countText ? <span className="font-medium tabular-nums">{countText}</span> : null}
            <span>{t(`shell.org.plan.${org.plan}`)}</span>
          </>
        )
      }
      actions={
        <>
          {admin ? (
            <Button
              type="button"
              icon={<UserPlus />}
              onClick={() => setInviteOpen(true)}
              disabled={seatsFull}
              aria-label={t("team.invite")}
              className={PHONE_ICON}
            >
              <span className="max-sm:sr-only">{t("team.invite")}</span>
            </Button>
          ) : null}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="outline" size="icon" aria-label={t("common.actions")}>
                <Ellipsis />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <Link to="/app/activity">
                  <Activity aria-hidden="true" />
                  {t("nav.activity")}
                </Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      }
    >
      <Pane
        label={t("members.list")}
        width={admin && !failed ? "wide" : "fill"}
        header={<PaneTitle title={t("members.list")} count={ready ? members.length : undefined} />}
      >
        {/* The meta is hidden on a phone: the consequence is said once there, in the pane. */}
        {personal ? (
          <p className="border-b border-line px-4 py-2 text-meta text-muted-foreground sm:hidden">
            {consequence}
          </p>
        ) : null}
        {failed ? (
          <EmptyState
            quiet
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
        ) : !ready ? (
          <SkeletonRows rows={3} avatarSize="md" />
        ) : (
          <MemberRows
            members={members}
            currentUserId={userId}
            actorRole={role}
            busyUserId={busyUserId}
            onRoleChange={(member, next) => void handleRoleChange(member, next)}
            onRemove={setRemoving}
          />
        )}
      </Pane>

      {admin && !failed ? (
        <Pane
          label={`${t("members.invitations")} · ${t("settings.plan")}`}
          width="fill"
          bodyClassName="flex flex-col gap-6 p-4 sm:p-6"
        >
          <Section title={t("members.invitations")} count={ready ? invitations.length : undefined}>
            {!ready ? (
              <SkeletonRows rows={2} avatar={false} />
            ) : (
              <InvitationsList
                invitations={invitations}
                busyId={busyInvitationId}
                onRevoke={setRevoking}
              />
            )}
          </Section>
          <Section title={t("settings.plan")}>
            <PlanUsage
              org={org}
              seatsUsed={seatsUsed}
              cvsProcessed={data?.cvsProcessed ?? null}
              loading={!ready}
            />
          </Section>
        </Pane>
      ) : null}

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
    </Workspace>
  );
}
