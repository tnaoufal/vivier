/**
 * The organisation the person is working in, with their role in it and
 * the team's profiles (names next to comments and decisions). Loaded by
 * the app layout from memberships under RLS; the current choice is
 * remembered in this browser.
 */
import { createContext, useContext } from "react";

import type { MembershipRow, OrganizationRow, OrgRole, ProfileRow } from "@/lib/db/types";
import { roleAtLeast } from "@/lib/db/types";

export const ORG_STORAGE_KEY = "vivier-org";

export interface OrgMembership {
  org: OrganizationRow;
  role: OrgRole;
}

export interface OrgContextValue {
  /** Every organisation the person belongs to. */
  memberships: OrgMembership[];
  /** The current one; null when the person belongs to none yet. */
  org: OrganizationRow | null;
  role: OrgRole | null;
  /** Members of the current organisation, by user id. */
  members: Map<string, ProfileRow & { role: OrgRole }>;
  loading: boolean;
  switchOrg: (orgId: string) => void;
  /** Reloads memberships and members (after a change of team or settings). */
  refresh: () => Promise<void>;
  /** True when the person's role is at least `min`. */
  can: (min: OrgRole) => boolean;
  /** Whether candidates' photos are shown in this organisation (organizations.show_photos, on by default). */
  showPhotos: boolean;
}

export const OrgContext = createContext<OrgContextValue | null>(null);

export function useOrg(): OrgContextValue {
  const context = useContext(OrgContext);
  if (!context) throw new Error("useOrg must be used inside OrgProvider");
  return context;
}

/** The current organisation, or a thrown error for pages that cannot render without one. */
export function useCurrentOrg(): { org: OrganizationRow; role: OrgRole } {
  const { org, role } = useOrg();
  if (!org || !role) throw new Error("No organisation selected");
  return { org, role };
}

export function storedOrgId(): string | null {
  try {
    return window.localStorage.getItem(ORG_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function rememberOrgId(orgId: string): void {
  try {
    window.localStorage.setItem(ORG_STORAGE_KEY, orgId);
  } catch {
    // Storage may be blocked.
  }
}

/** Picks the organisation to show: the remembered one when still a member, else the first. */
export function pickOrg(memberships: OrgMembership[], remembered: string | null): OrgMembership | null {
  if (!memberships.length) return null;
  return memberships.find((m) => m.org.id === remembered) ?? memberships[0] ?? null;
}

/**
 * Whether the interface shows candidates' photos: the organisation's
 * choice (organizations.show_photos), on unless it was turned off. No
 * organisation, or a row read before the column existed, reads as on.
 * The photo identifies a person in the interface only; it never reaches
 * a model, whatever this says.
 */
export function readShowPhotos(org: Pick<OrganizationRow, "show_photos"> | null | undefined): boolean {
  if (!org) return true;
  return org.show_photos !== false;
}

/** The display name of a member, falling back to the email, then a placeholder. */
export function memberName(
  profile: Pick<ProfileRow, "display_name" | "email"> | undefined,
  fallback: string,
): string {
  if (!profile) return fallback;
  return profile.display_name?.trim() || profile.email?.split("@")[0] || fallback;
}

export function initialsOf(name: string): string {
  const parts = name
    .replace(/[^\p{L}\p{N} ]/gu, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return "?";
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase();
}

export { roleAtLeast };
export type { MembershipRow };
