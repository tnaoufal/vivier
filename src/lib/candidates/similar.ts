/**
 * The profiles near one candidate, as the database ranks them
 * (similar_candidates): by the meaning of the career when both profiles
 * carry a vector, else by the words of the headline and the skills. The
 * RPC answers ids with a similarity and the method that produced it;
 * this module guards those rows (a shape it promises is still checked
 * at the boundary), reads the profiles the person may see under RLS,
 * and hands them back in the database's order. A proximity is a reading
 * aid for a person who compares, never a verdict. The pure helpers are
 * tested in similar.test.ts.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { CandidateRow, SimilarCandidate } from "@/lib/db/types";

/** How many neighbours the drawer asks for; the RPC caps at 50. */
export const SIMILAR_LIMIT = 10;

/** What a neighbour's row shows; the embedding and the contact details never travel. */
export const SIMILAR_COLUMNS = "id, full_name, headline, location, skills, status";

export type SimilarProfileRow = Pick<
  CandidateRow,
  "id" | "full_name" | "headline" | "location" | "skills" | "status"
>;

export type SimilarMethod = SimilarCandidate["method"];

/** A neighbour as the drawer shows it: the profile, how close, and how that was measured. */
export interface SimilarProfile extends SimilarProfileRow {
  /** 0..1, as the database computed it (cosine similarity or a normalised text rank). */
  similarity: number;
  method: SimilarMethod;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const METHODS: readonly SimilarMethod[] = ["embedding", "skills"];

export function isSimilarMethod(value: unknown): value is SimilarMethod {
  return typeof value === "string" && (METHODS as readonly string[]).includes(value);
}

/** One row of the RPC when it has the shape the migration promises; null for anything else. */
export function guardSimilarRow(value: unknown): SimilarCandidate | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const id = row["candidate_id"];
  const similarity = row["similarity"];
  const method = row["method"];
  if (typeof id !== "string" || !UUID.test(id)) return null;
  if (typeof similarity !== "number" || !Number.isFinite(similarity)) return null;
  if (!isSimilarMethod(method)) return null;
  // Cosine distance runs 0..2, so an unrelated profile reads below 0 and rounding
  // can read a twin above 1: clamped to 0..1 rather than dropped from the list.
  return { candidate_id: id, similarity: Math.min(1, Math.max(0, similarity)), method };
}

/** The rows the guard accepts, in the RPC's order, each candidate once; [] for anything but an array. */
export function guardSimilarRows(value: unknown): SimilarCandidate[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: SimilarCandidate[] = [];
  for (const item of value) {
    const row = guardSimilarRow(item);
    if (!row || seen.has(row.candidate_id)) continue;
    seen.add(row.candidate_id);
    out.push(row);
  }
  return out;
}

/** The rows in the order of `ids`: an id without a row is skipped, a row outside `ids` too. */
export function orderBy<T extends { id: string }>(ids: readonly string[], rows: readonly T[]): T[] {
  const byId = new Map(rows.map((row) => [row.id, row] as const));
  const out: T[] = [];
  for (const id of ids) {
    const row = byId.get(id);
    if (row) out.push(row);
  }
  return out;
}

/** 82 for 0.823: a similarity as a whole percentage, clamped to 0..100; 0 when it is not a number. */
export function percentOf(similarity: number): number {
  if (!Number.isFinite(similarity)) return 0;
  return Math.round(Math.min(1, Math.max(0, similarity)) * 100);
}

/** The neighbours the person may read, in the RPC's order, each with its similarity and method. */
export function mergeSimilar(
  neighbours: readonly SimilarCandidate[],
  rows: readonly SimilarProfileRow[],
): SimilarProfile[] {
  const byId = new Map(neighbours.map((neighbour) => [neighbour.candidate_id, neighbour] as const));
  const ordered = orderBy(
    neighbours.map((neighbour) => neighbour.candidate_id),
    rows,
  );
  const out: SimilarProfile[] = [];
  for (const row of ordered) {
    const neighbour = byId.get(row.id);
    if (neighbour) out.push({ ...row, similarity: neighbour.similarity, method: neighbour.method });
  }
  return out;
}

/**
 * The profiles closest to a candidate in the organisation, nearest
 * first. The RPC runs under the caller's RLS and the second read filters
 * by the organisation again, so a neighbour the person may not see is
 * simply absent.
 */
export async function listSimilar(
  supabase: SupabaseClient,
  orgId: string,
  candidateId: string,
  limit = SIMILAR_LIMIT,
): Promise<SimilarProfile[]> {
  const { data, error } = await supabase.rpc("similar_candidates", {
    p_org: orgId,
    p_candidate: candidateId,
    p_limit: limit,
  });
  if (error) throw error;
  const neighbours = guardSimilarRows(data);
  if (!neighbours.length) return [];
  const read = await supabase
    .from("candidates")
    .select(SIMILAR_COLUMNS)
    .eq("org_id", orgId)
    .in(
      "id",
      neighbours.map((neighbour) => neighbour.candidate_id),
    );
  if (read.error) throw read.error;
  return mergeSimilar(neighbours, (read.data ?? []) as unknown as SimilarProfileRow[]);
}
