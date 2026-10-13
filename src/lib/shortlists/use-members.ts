/**
 * The team as the shortlist pages name it: one entry per member of the
 * current organisation with the name the shell shows (display name, else
 * the email's local part), sorted by name, plus a lookup that never
 * invents a name for someone who left.
 */
import { useCallback, useMemo } from "react";

import type { OrgRole } from "@/lib/db/types";
import { useT } from "@/lib/i18n";
import { memberName, useOrg } from "@/lib/org/org-context";

export interface TeamMember {
  id: string;
  name: string;
  role: OrgRole;
}

export function useTeamMembers(): TeamMember[] {
  const { members } = useOrg();
  return useMemo(() => {
    const list: TeamMember[] = [];
    for (const [id, profile] of members) {
      list.push({ id, name: memberName(profile, id.slice(0, 8)), role: profile.role });
    }
    return list.sort((a, b) => a.name.localeCompare(b.name));
  }, [members]);
}

/** A function naming a member by id: "A former member" when they left, "Someone" when the id is null. */
export function useMemberNamer(): (userId: string | null | undefined) => string {
  const { members } = useOrg();
  const t = useT();
  return useCallback(
    (userId: string | null | undefined) => {
      if (!userId) return t("common.someone");
      return memberName(members.get(userId), t("shortlists.formerMember"));
    },
    [members, t],
  );
}
