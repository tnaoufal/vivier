/**
 * Sending the CVs the service refused at the monthly cap back to the
 * queue, as many as the month allows again, oldest first. The browser
 * may only set `status` to 'queued' on a failed document (the guard
 * trigger refuses the rest and clears the sentence); supabase-js cannot
 * limit an update, so the ids are read first and updated by chunks of
 * 100, each statement filtered again on the status and the sentence so
 * a document a colleague re-queued meanwhile is skipped, not refused.
 * The processor is then poked with the ids actually re-queued, 500 a
 * call; a missed poke only delays the work (the service polls its
 * queue). The chunking is planRequeue() / planPokes() in quota.ts.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { QUOTA_ERROR_PATTERN, planPokes, planRequeue } from "./quota";

/** Tells the processor about re-queued documents; answers false when it could not be reached. */
export type Poke = (documentIds: string[]) => Promise<boolean>;

export interface RequeueResult {
  /** How many documents went back to the queue (the rows the updates answered). */
  requeued: number;
  /** False when at least one poke did not reach the processor; the queue is polled anyway. */
  reached: boolean;
}

/** The ids of the quota refusals, oldest first, at most `limit` (the processor reads the queue in that order too). */
export async function listQuotaFailureIds(
  supabase: SupabaseClient,
  orgId: string,
  limit: number,
): Promise<string[]> {
  const { data, error } = await supabase
    .from("documents")
    .select("id")
    .eq("org_id", orgId)
    .eq("status", "failed")
    .like("error", QUOTA_ERROR_PATTERN)
    .order("created_at", { ascending: true })
    .limit(Math.max(0, Math.floor(limit)));
  if (error) throw error;
  return ((data ?? []) as { id: string }[]).map((row) => row.id);
}

/**
 * Re-queues up to `remaining` quota refusals of the organisation and pokes
 * the processor. A statement that fails stops the loop, but what was
 * re-queued before it is still poked before the error is thrown.
 */
export async function requeueQuotaFailures(
  supabase: SupabaseClient,
  orgId: string,
  remaining: number,
  poke: Poke,
): Promise<RequeueResult> {
  const plan = planRequeue(await listQuotaFailureIds(supabase, orgId, remaining), remaining);
  const requeued: string[] = [];
  let failure: unknown = null;
  for (const chunk of plan.updates) {
    const { data, error } = await supabase
      .from("documents")
      .update({ status: "queued" })
      .eq("org_id", orgId)
      .eq("status", "failed")
      .like("error", QUOTA_ERROR_PATTERN)
      .in("id", chunk)
      .select("id");
    if (error) {
      failure = error;
      break;
    }
    for (const row of (data ?? []) as { id: string }[]) requeued.push(row.id);
  }
  let reached = true;
  for (const chunk of planPokes(requeued)) {
    if (!(await poke(chunk))) reached = false;
  }
  if (failure) throw failure;
  return { requeued: requeued.length, reached };
}
