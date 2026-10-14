/**
 * The monthly CV quota as the browser sees it. At the organisation's cap
 * the processor refuses a document with one sentence in `documents.error`
 * and the status `failed`, without counting an attempt: such a document
 * is not broken, it waits. This module tells a quota refusal from a real
 * failure, says how much room the month has left, and cuts a re-queue
 * into the chunks supabase-js and the processor poke accept. Pure and
 * tested in quota.test.ts; the reads live in queries.ts, the write in
 * requeue.ts.
 */
import type { DocumentRow } from "@/lib/db/types";

import { planLots } from "./upload";

/**
 * The start of the processor's sentence, FAILURE_MESSAGES.quota in
 * services/processor/src/messages.ts ("Quota mensuel de CV atteint. Il se
 * renouvelle le 1er du mois."). Coupled by text on purpose: the browser
 * recognises what the service wrote, in the database as here. Change the
 * two together.
 */
export const QUOTA_ERROR_PREFIX = "Quota mensuel";

/** The same prefix as a LIKE pattern, for the count and the list queries. */
export const QUOTA_ERROR_PATTERN = `${QUOTA_ERROR_PREFIX}%`;

/** True when the service refused the document at the cap: failed, with its quota sentence. */
export function isQuotaFailure(document: Pick<DocumentRow, "status" | "error">): boolean {
  return (
    document.status === "failed" &&
    typeof document.error === "string" &&
    document.error.startsWith(QUOTA_ERROR_PREFIX)
  );
}

/**
 * How many CVs the month still allows: the quota minus what was processed
 * and minus what waits in the queue (`pending`: queued or processing).
 * The RPC counts processed rows only, and the service claims the queue
 * oldest first, each document checked against the cap in turn: a
 * document re-queued or imported behind the queue only gets the room the
 * queue leaves. Never negative, 0 when a number cannot be read.
 */
export function quotaRemaining(quota: number, used: number, pending = 0): number {
  if (!Number.isFinite(quota) || !Number.isFinite(used) || !Number.isFinite(pending)) return 0;
  return Math.max(
    0,
    Math.floor(quota) - Math.max(0, Math.floor(used)) - Math.max(0, Math.floor(pending)),
  );
}

/** How many of `count` files an import would send past the remaining quota (an upper bound: duplicates are never queued). */
export function beyondQuota(count: number, remaining: number): number {
  if (!Number.isFinite(count)) return 0;
  return Math.max(
    0,
    Math.floor(count) - Math.max(0, Number.isFinite(remaining) ? Math.floor(remaining) : 0),
  );
}

/** Ids per update statement: `.in("id", …)` travels in the URL, which stays under the gateway's 16 KB at 100 ids. */
export const REQUEUE_UPDATE_CHUNK = 100;
/** Ids per notifyProcessor call: its input accepts 500 at most. */
export const REQUEUE_POKE_CHUNK = 500;

export interface RequeuePlan {
  /** The ids to re-queue, in the order given (oldest first), at most `remaining` of them, without duplicates. */
  ids: string[];
  /** One update statement per chunk of REQUEUE_UPDATE_CHUNK ids. */
  updates: string[][];
  /** The ids given but left waiting, beyond the remaining quota. */
  left: number;
}

/** Keeps the first `remaining` ids and cuts them for the update; the rest wait for a later quota. */
export function planRequeue(ids: readonly string[], remaining: number): RequeuePlan {
  const unique = Array.from(new Set(ids));
  const take = Number.isFinite(remaining) ? Math.max(0, Math.floor(remaining)) : 0;
  const taken = unique.slice(0, take);
  return {
    ids: taken,
    updates: planLots(taken, REQUEUE_UPDATE_CHUNK),
    left: unique.length - taken.length,
  };
}

/** The pokes for the ids actually re-queued, REQUEUE_POKE_CHUNK per call. */
export function planPokes(ids: readonly string[]): string[][] {
  return planLots(ids, REQUEUE_POKE_CHUNK);
}
