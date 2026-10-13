import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import { useAuth } from "@/lib/auth/auth-context";
import { loadSupabase } from "@/lib/auth/supabase-client";
import type { MembershipRow, OrganizationRow, OrgRole, ProfileRow } from "@/lib/db/types";
import { roleAtLeast } from "@/lib/db/types";

import {
  OrgContext,
  pickOrg,
  rememberOrgId,
  storedOrgId,
  type OrgContextValue,
  type OrgMembership,
} from "./org-context";

interface MembershipWithOrg extends MembershipRow {
  organizations: OrganizationRow | null;
}

export function OrgProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [memberships, setMemberships] = useState<OrgMembership[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [members, setMembers] = useState<Map<string, ProfileRow & { role: OrgRole }>>(new Map());
  const [loading, setLoading] = useState(true);

  const loadMemberships = useCallback(async () => {
    if (!userId) {
      setMemberships([]);
      setCurrentId(null);
      setLoading(false);
      return;
    }
    const supabase = await loadSupabase();
    if (!supabase) {
      setLoading(false);
      return;
    }
    const { data, error } = await supabase
      .from("memberships")
      .select("org_id, user_id, role, created_at, organizations(*)")
      .eq("user_id", userId)
      .order("created_at", { ascending: true });
    if (error) {
      console.error(error);
      setLoading(false);
      return;
    }
    const rows = (data ?? []) as unknown as MembershipWithOrg[];
    const list: OrgMembership[] = rows
      .filter((row) => row.organizations)
      .map((row) => ({ org: row.organizations as OrganizationRow, role: row.role }));
    setMemberships(list);
    const picked = pickOrg(list, storedOrgId());
    setCurrentId(picked?.org.id ?? null);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    setLoading(true);
    void loadMemberships();
  }, [loadMemberships]);

  const loadMembers = useCallback(async (orgId: string) => {
    const supabase = await loadSupabase();
    if (!supabase) return;
    // memberships.user_id points at auth.users, so PostgREST cannot embed
    // profiles through it: two reads, joined here.
    const { data, error } = await supabase
      .from("memberships")
      .select("user_id, role")
      .eq("org_id", orgId);
    if (error) {
      console.error(error);
      return;
    }
    const rows = (data ?? []) as unknown as { user_id: string; role: OrgRole }[];
    const ids = rows.map((row) => row.user_id);
    const map = new Map<string, ProfileRow & { role: OrgRole }>();
    if (ids.length) {
      const profiles = await supabase.from("profiles").select("*").in("id", ids);
      if (profiles.error) {
        console.error(profiles.error);
        return;
      }
      const byId = new Map(
        ((profiles.data ?? []) as unknown as ProfileRow[]).map((profile) => [profile.id, profile]),
      );
      for (const row of rows) {
        const profile = byId.get(row.user_id);
        if (profile) map.set(row.user_id, { ...profile, role: row.role });
      }
    }
    setMembers(map);
  }, []);

  useEffect(() => {
    if (currentId) void loadMembers(currentId);
    else setMembers(new Map());
  }, [currentId, loadMembers]);

  const current = useMemo(
    () => memberships.find((m) => m.org.id === currentId) ?? null,
    [currentId, memberships],
  );

  const value = useMemo<OrgContextValue>(
    () => ({
      memberships,
      org: current?.org ?? null,
      role: current?.role ?? null,
      members,
      loading,
      switchOrg: (orgId: string) => {
        rememberOrgId(orgId);
        setCurrentId(orgId);
      },
      refresh: async () => {
        await loadMemberships();
        if (currentId) await loadMembers(currentId);
      },
      can: (min: OrgRole) => roleAtLeast(current?.role ?? null, min),
    }),
    [current, currentId, loadMembers, loadMemberships, loading, members, memberships],
  );

  return <OrgContext.Provider value={value}>{children}</OrgContext.Provider>;
}
