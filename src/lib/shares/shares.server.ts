/**
 * Service-role helpers shared by the share server functions and the CV
 * route: the lookups (an organisation, a shortlist with its brief, a
 * share of the organisation, the share behind the token a link carries,
 * hashed first and never compared raw), the reading of a share's
 * organisation, items and brief snapshot (guarded: the columns are
 * JSON, and shares created before the dossier lack the new fields), the
 * sender's name, and the activity row every change writes. Only ever
 * imported by server-function handlers and API routes.
 */
import type {
  ActivityKind,
  BriefRow,
  Locale,
  OrganizationRow,
  ProfileRow,
  ShareBrief,
  ShareItem,
  ShareRequirement,
  ShareRow,
} from "@/lib/db/types";
import { parseCriteria } from "@/lib/briefs/criteria";
import { AppError } from "@/lib/platform/errors";
import type { Member, ServiceClient } from "@/lib/platform/supabase.server";

import { cleanScore, isDecision, isMet, type DraftBrief } from "./draft";
import { isTokenShaped, sha256Hex } from "./token";

export function log(event: string, detail: Record<string, unknown>): void {
  console.error("[shares]", JSON.stringify({ event, ...detail }));
}

export function errorText(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 200);
}

/** A PostgREST `in` filter over ids the validator already checked. */
export function inList(ids: readonly string[]): string {
  return `in.(${ids.join(",")})`;
}

// ---------------------------------------------------------------------
// lookups of the organisation's rows
// ---------------------------------------------------------------------

export type OrgInfo = Pick<OrganizationRow, "id" | "name" | "locale">;

export async function loadOrg(client: ServiceClient, orgId: string): Promise<OrgInfo> {
  const rows = await client.select<OrgInfo>(
    `organizations?select=id,name,locale&id=eq.${encodeURIComponent(orgId)}&limit=1`,
  );
  const org = rows[0];
  if (!org) throw new AppError("NOT_FOUND");
  return org;
}

type BriefPick = Pick<BriefRow, "id" | "title" | "description" | "criteria">;

interface ShortlistLookup {
  id: string;
  brief_id: string;
  briefs: BriefPick | BriefPick[] | null;
}

export interface LoadedShortlist {
  id: string;
  briefId: string;
  brief: DraftBrief;
}

/** The shortlist of the organisation with its brief (criteria read as the brief page reads them), or NOT_FOUND. */
export async function loadShortlist(client: ServiceClient, orgId: string, shortlistId: string): Promise<LoadedShortlist> {
  const rows = await client.select<ShortlistLookup>(
    `shortlists?select=id,brief_id,briefs(id,title,description,criteria)&org_id=eq.${encodeURIComponent(orgId)}&id=eq.${encodeURIComponent(shortlistId)}&limit=1`,
  );
  const row = rows[0];
  if (!row) throw new AppError("NOT_FOUND");
  const brief = Array.isArray(row.briefs) ? (row.briefs[0] ?? null) : row.briefs;
  return {
    id: row.id,
    briefId: row.brief_id,
    brief: {
      title: brief?.title ?? "",
      description: brief?.description ?? "",
      criteria: parseCriteria(brief?.criteria),
    },
  };
}

export type ShareLookup = Pick<ShareRow, "id" | "org_id" | "shortlist_id" | "title" | "expires_at" | "revoked_at"> & {
  /** Read by the service role to check a link against the share; never answered to the browser. */
  token_hash: string;
  shortlists: { brief_id: string } | { brief_id: string }[] | null;
};

/** A share of the organisation, or NOT_FOUND. */
export async function loadShare(client: ServiceClient, orgId: string, shareId: string): Promise<ShareLookup> {
  const rows = await client.select<ShareLookup>(
    `shares?select=id,org_id,shortlist_id,title,expires_at,revoked_at,token_hash,shortlists(brief_id)&org_id=eq.${encodeURIComponent(orgId)}&id=eq.${encodeURIComponent(shareId)}&limit=1`,
  );
  const share = rows[0];
  if (!share) throw new AppError("NOT_FOUND");
  return share;
}

export function briefIdOf(share: ShareLookup): string | null {
  const row = Array.isArray(share.shortlists) ? (share.shortlists[0] ?? null) : share.shortlists;
  return row?.brief_id ?? null;
}

/** The sender as the email names them: display name, else email, else the product. */
export async function senderName(client: ServiceClient, member: Member): Promise<string> {
  const rows = await client.select<Pick<ProfileRow, "display_name" | "email">>(
    `profiles?select=display_name,email&id=eq.${encodeURIComponent(member.userId)}&limit=1`,
  );
  const profile = rows[0];
  return profile?.display_name?.trim() || profile?.email || member.email || "Vivier";
}

// ---------------------------------------------------------------------
// the share behind a link
// ---------------------------------------------------------------------

export interface ShareOrg {
  name: string;
  locale: Locale;
}

export interface TokenShareRow
  extends Pick<
    ShareRow,
    | "id"
    | "org_id"
    | "title"
    | "intro"
    | "items"
    | "brief"
    | "include_cvs"
    | "expires_at"
    | "revoked_at"
    | "created_at"
    | "view_count"
  > {
  organizations: ShareOrg | ShareOrg[] | null;
}

const TOKEN_SHARE_COLUMNS =
  "id,org_id,title,intro,items,brief,include_cvs,expires_at,revoked_at,created_at,view_count,organizations(name,locale)";

/** The share behind a link, whatever its state; null when the token is not shaped like one or matches nothing. */
export async function findShareByToken(client: ServiceClient, token: string): Promise<TokenShareRow | null> {
  if (!isTokenShaped(token)) return null;
  const hash = await sha256Hex(token);
  const rows = await client.select<TokenShareRow>(`shares?select=${TOKEN_SHARE_COLUMNS}&token_hash=eq.${hash}&limit=1`);
  return rows[0] ?? null;
}

/** An embedded to-one row comes back as an object; an array (older PostgREST) is read as its first row. */
export function orgOf(row: Pick<TokenShareRow, "organizations">): ShareOrg | null {
  const value = row.organizations;
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

function isItem(value: unknown): value is ShareItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return typeof item["candidateId"] === "string" && typeof item["name"] === "string";
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

/** A stored requirement row, or null when the JSON does not hold one. */
function requirementOf(value: unknown): ShareRequirement | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const label = text(row["label"]);
  const met = row["met"];
  if (!label || !isMet(met)) return null;
  return { label, required: row["required"] === true, met, evidence: text(row["evidence"]) };
}

/**
 * The stored items, guarded (the column is JSON), with the CV link only
 * when CVs are included. A share created before the dossier holds none
 * of the facts, the score, the decision or the requirement table: they
 * read as empty and null, and the page says so rather than inventing.
 */
export function itemsOf(row: Pick<TokenShareRow, "items" | "include_cvs">): ShareItem[] {
  const raw: unknown = row.items;
  if (!Array.isArray(raw)) return [];
  return raw.filter(isItem).map((item) => {
    const stored = item as unknown as Record<string, unknown>;
    const years = stored["yearsExperience"];
    return {
      candidateId: item.candidateId,
      name: item.name,
      headline: text(stored["headline"]),
      location: text(stored["location"]),
      yearsExperience: typeof years === "number" && Number.isFinite(years) ? years : null,
      availability: text(stored["availability"]),
      skills: strings(stored["skills"]),
      languages: strings(stored["languages"]),
      summary: typeof stored["summary"] === "string" ? stored["summary"] : "",
      strengths: strings(stored["strengths"]),
      attention: strings(stored["attention"]),
      score: cleanScore(stored["score"]),
      decision: isDecision(stored["decision"]) ? stored["decision"] : null,
      requirements: Array.isArray(stored["requirements"])
        ? stored["requirements"].map(requirementOf).filter((entry): entry is ShareRequirement => entry !== null)
        : [],
      documentId: row.include_cvs && typeof stored["documentId"] === "string" ? stored["documentId"] : null,
    };
  });
}

/** The brief's snapshot, guarded; null for a share created before the dossier or a malformed column. */
export function briefOf(row: Pick<TokenShareRow, "brief">): ShareBrief | null {
  const raw: unknown = row.brief;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const brief = raw as Record<string, unknown>;
  const title = typeof brief["title"] === "string" ? brief["title"] : "";
  const summary = typeof brief["summary"] === "string" ? brief["summary"] : "";
  const requirements: ShareBrief["requirements"] = Array.isArray(brief["requirements"])
    ? brief["requirements"].flatMap((entry: unknown) => {
        if (!entry || typeof entry !== "object") return [];
        const row = entry as Record<string, unknown>;
        const label = text(row["label"]);
        return label ? [{ label, required: row["required"] === true }] : [];
      })
    : [];
  if (!title && !summary && !requirements.length) return null;
  return { title, summary, requirements };
}

// ---------------------------------------------------------------------
// the trace
// ---------------------------------------------------------------------

export interface ActivityInput {
  orgId: string;
  actorId: string;
  kind: Extract<ActivityKind, "share.created" | "share.revoked" | "share.sent">;
  shareId: string;
  briefId: string | null;
  payload: Record<string, unknown>;
}

/** Best effort: a failed trace must not fail the action, but it is logged. */
export async function recordActivity(client: ServiceClient, input: ActivityInput): Promise<void> {
  try {
    await client.insert("activities", [
      {
        org_id: input.orgId,
        actor_id: input.actorId,
        kind: input.kind,
        target_type: "share",
        target_id: input.shareId,
        brief_id: input.briefId,
        payload: input.payload,
      },
    ]);
  } catch (error) {
    log("activity_failed", { kind: input.kind, shareId: input.shareId, error: errorText(error) });
  }
}
