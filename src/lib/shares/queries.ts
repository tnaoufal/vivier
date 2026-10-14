/**
 * The typed reads of the sharing area through supabase-js under RLS:
 * the items of a shortlist with their candidate (to tick what goes into
 * a presentation), the shares of a shortlist (the columns the grant
 * allows: never token_hash) and the emails sent for them. Every read
 * filters by the organisation and casts rows at the boundary.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { CandidateRow, EmailSendRow, ShareRow, ShortlistItemRow } from "@/lib/db/types";

/** An embedded to-one row comes back as an object; an array (older PostgREST) is read as its first row. */
function one<T>(value: unknown): T | null {
  if (Array.isArray(value)) return (value[0] as T | undefined) ?? null;
  return value && typeof value === "object" ? (value as T) : null;
}

/** The photo path is for the dialog's avatars only: the dossier a link opens carries no photo. */
export type ShareableCandidate = Pick<CandidateRow, "id" | "full_name" | "headline" | "photo_path">;

export interface ShareableItem extends Pick<ShortlistItemRow, "id" | "candidate_id" | "status" | "position"> {
  /** Null when the candidate was erased from the pool. */
  candidates: ShareableCandidate | null;
}

export async function listShareableItems(
  supabase: SupabaseClient,
  orgId: string,
  shortlistId: string,
): Promise<ShareableItem[]> {
  const { data, error } = await supabase
    .from("shortlist_items")
    .select("id, candidate_id, status, position, candidates(id, full_name, headline, photo_path)")
    .eq("org_id", orgId)
    .eq("shortlist_id", shortlistId)
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as unknown as Record<string, unknown>[]).map((row) => ({
    ...(row as unknown as Pick<ShortlistItemRow, "id" | "candidate_id" | "status" | "position">),
    candidates: one<ShareableCandidate>(row["candidates"]),
  }));
}

/** The columns members may read; `*` would ask for token_hash and be refused. */
export const SHARE_COLUMNS =
  "id, org_id, shortlist_id, title, intro, items, include_cvs, expires_at, revoked_at, view_count, last_viewed_at, created_by, created_at";

export async function listShares(supabase: SupabaseClient, orgId: string, shortlistId: string): Promise<ShareRow[]> {
  const { data, error } = await supabase
    .from("shares")
    .select(SHARE_COLUMNS)
    .eq("org_id", orgId)
    .eq("shortlist_id", shortlistId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as ShareRow[];
}

export type ShareSend = Pick<EmailSendRow, "id" | "share_id" | "to_email" | "status" | "error" | "sent_at" | "created_at">;

export async function listShareSends(supabase: SupabaseClient, orgId: string, shareIds: string[]): Promise<ShareSend[]> {
  if (!shareIds.length) return [];
  const { data, error } = await supabase
    .from("email_sends")
    .select("id, share_id, to_email, status, error, sent_at, created_at")
    .eq("org_id", orgId)
    .eq("kind", "share")
    .in("share_id", shareIds)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as ShareSend[];
}

export function sendsByShare(sends: readonly ShareSend[]): Map<string, ShareSend[]> {
  const map = new Map<string, ShareSend[]>();
  for (const send of sends) {
    if (!send.share_id) continue;
    const list = map.get(send.share_id) ?? [];
    list.push(send);
    map.set(send.share_id, list);
  }
  return map;
}
