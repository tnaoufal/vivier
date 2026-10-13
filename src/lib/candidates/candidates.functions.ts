/**
 * Server functions of the talent pool: the poke that tells the processor
 * new documents are queued (best effort: it polls the queue anyway) and
 * the erasure of a candidate with their files (admin). Both read the
 * caller from the access token through requireMember() and work only
 * on the organisation it verified.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { AppError } from "@/lib/platform/errors";
import { pokeProcessor } from "@/lib/platform/processor.server";
import { enforceRateLimit } from "@/lib/platform/rate-limit.server";
import { db, requireMember } from "@/lib/platform/supabase.server";

const notifyInput = z.object({
  accessToken: z.string().min(1).max(4096),
  orgId: z.uuid(),
  documentIds: z.array(z.uuid()).min(1).max(200),
});

const POKE_BATCH = 50;

export interface NotifyResult {
  /** False when the processor is not set up or did not answer; the queue is polled anyway. */
  reached: boolean;
  /** How many of the ids belong to the organisation and were passed on. */
  known: number;
}

export const notifyProcessor = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => notifyInput.parse(data))
  .handler(async ({ data }): Promise<NotifyResult> => {
    const member = await requireMember(data.accessToken, data.orgId, "member");
    await enforceRateLimit("processor", { userKey: member.userId });
    const unique = Array.from(new Set(data.documentIds));
    const rows = await db().select<{ id: string }>(
      `documents?select=id&org_id=eq.${encodeURIComponent(member.orgId)}&id=in.(${unique
        .map(encodeURIComponent)
        .join(",")})`,
    );
    const ids = rows.map((row) => row.id);
    if (!ids.length) return { reached: false, known: 0 };
    let reached = true;
    for (let at = 0; at < ids.length; at += POKE_BATCH) {
      const result = await pokeProcessor(ids.slice(at, at + POKE_BATCH));
      if (!result.reached) reached = false;
    }
    return { reached, known: ids.length };
  });

const eraseInput = z.object({
  accessToken: z.string().min(1).max(4096),
  orgId: z.uuid(),
  candidateId: z.uuid(),
});

export interface EraseResult {
  /** The number of CV files removed from storage. */
  removed: number;
}

export const eraseCandidate = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => eraseInput.parse(data))
  .handler(async ({ data }): Promise<EraseResult> => {
    const member = await requireMember(data.accessToken, data.orgId, "admin");
    const client = db();
    const org = encodeURIComponent(member.orgId);
    const id = encodeURIComponent(data.candidateId);
    const found = await client.select<{ id: string }>(`candidates?select=id&org_id=eq.${org}&id=eq.${id}&limit=1`);
    if (!found.length) throw new AppError("NOT_FOUND");
    const documents = await client.select<{ storage_path: string }>(
      `documents?select=storage_path&org_id=eq.${org}&candidate_id=eq.${id}`,
    );
    const paths = documents.map((document) => document.storage_path);
    await client.removeObjects("cvs", paths);
    // The documents rows go with the candidate (ON DELETE CASCADE); the trigger logs candidate.deleted.
    await client.delete("candidates", { id: data.candidateId, org_id: member.orgId });
    console.info(
      "[candidates]",
      JSON.stringify({ event: "erased", orgId: member.orgId, by: member.userId, documents: paths.length }),
    );
    return { removed: paths.length };
  });
