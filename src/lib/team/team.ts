/**
 * The team area's reads and writes from the browser, under RLS: members
 * with their joining date, pending invitations (never the token hash,
 * which is not granted), seat and quota counters, role changes, removals,
 * organisation settings and the person's profile. Every call throws the
 * supabase-js error; the pages turn known codes into sentences.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { InvitationRow, Locale, OrgRole, ProfileRow } from "@/lib/db/types";

export interface TeamMember {
  userId: string;
  role: OrgRole;
  joinedAt: string;
  profile: ProfileRow | null;
}

export async function readMembers(supabase: SupabaseClient, orgId: string): Promise<TeamMember[]> {
  const { data, error } = await supabase
    .from("memberships")
    .select("user_id, role, created_at")
    .eq("org_id", orgId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  const rows = (data ?? []) as { user_id: string; role: OrgRole; created_at: string }[];
  // Profiles are read apart: memberships points at auth.users, not at profiles,
  // so PostgREST has no relationship to embed through.
  const profiles = new Map<string, ProfileRow>();
  if (rows.length) {
    const { data: profileRows, error: profileError } = await supabase
      .from("profiles")
      .select("*")
      .in(
        "id",
        rows.map((row) => row.user_id),
      );
    if (profileError) throw profileError;
    for (const profile of (profileRows ?? []) as ProfileRow[]) profiles.set(profile.id, profile);
  }
  return rows.map((row) => ({
    userId: row.user_id,
    role: row.role,
    joinedAt: row.created_at,
    profile: profiles.get(row.user_id) ?? null,
  }));
}

/** The columns the browser is granted on invitations: select=* would be refused. */
const INVITATION_COLUMNS = "id, org_id, email, role, invited_by, expires_at, accepted_at, created_at";

export async function readPendingInvitations(supabase: SupabaseClient, orgId: string): Promise<InvitationRow[]> {
  const { data, error } = await supabase
    .from("invitations")
    .select(INVITATION_COLUMNS)
    .eq("org_id", orgId)
    .is("accepted_at", null)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as InvitationRow[];
}

export async function readSeatsUsed(supabase: SupabaseClient, orgId: string): Promise<number> {
  const { data, error } = await supabase.rpc("seats_used", { p_org: orgId });
  if (error) throw error;
  return typeof data === "number" ? data : Number(data);
}

export async function readCvsProcessedThisMonth(supabase: SupabaseClient, orgId: string): Promise<number> {
  const { data, error } = await supabase.rpc("cvs_processed_this_month", { p_org: orgId });
  if (error) throw error;
  return typeof data === "number" ? data : Number(data);
}

export async function changeMemberRole(supabase: SupabaseClient, orgId: string, userId: string, role: OrgRole): Promise<void> {
  const { error } = await supabase.from("memberships").update({ role }).eq("org_id", orgId).eq("user_id", userId);
  if (error) throw error;
}

/** Removes a member; a person removing themselves is leaving. */
export async function removeMember(supabase: SupabaseClient, orgId: string, userId: string): Promise<void> {
  const { error } = await supabase.from("memberships").delete().eq("org_id", orgId).eq("user_id", userId);
  if (error) throw error;
}

export async function revokeInvitation(supabase: SupabaseClient, orgId: string, invitationId: string): Promise<void> {
  const { error } = await supabase.from("invitations").delete().eq("org_id", orgId).eq("id", invitationId);
  if (error) throw error;
}

export interface OrganizationSettings {
  name: string;
  locale: Locale;
  retention_months: number;
}

export async function updateOrganization(supabase: SupabaseClient, orgId: string, patch: OrganizationSettings): Promise<void> {
  const { error } = await supabase.from("organizations").update(patch).eq("id", orgId);
  if (error) throw error;
}

export async function deleteOrganization(supabase: SupabaseClient, orgId: string): Promise<void> {
  const { error } = await supabase.from("organizations").delete().eq("id", orgId);
  if (error) throw error;
}

export async function readProfile(supabase: SupabaseClient, userId: string): Promise<ProfileRow | null> {
  const { data, error } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
  if (error) throw error;
  return (data as ProfileRow | null) ?? null;
}

export async function updateProfile(
  supabase: SupabaseClient,
  userId: string,
  patch: Partial<Pick<ProfileRow, "display_name" | "locale">>,
): Promise<void> {
  const { error } = await supabase.from("profiles").update(patch).eq("id", userId);
  if (error) throw error;
}

/** True when a supabase-js or Postgres error carries this code in its message ("ORG:last_owner"). */
export function errorSays(error: unknown, code: string): boolean {
  if (!error || typeof error !== "object") return false;
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" && message.includes(code);
}

/** What the roles Select may offer: an admin manages below owner, an owner manages everyone. */
export function assignableRoles(actor: OrgRole, target: OrgRole): OrgRole[] {
  if (actor === "owner") return ["owner", "admin", "member", "viewer"];
  if (actor === "admin" && target !== "owner") return ["admin", "member", "viewer"];
  return [];
}
