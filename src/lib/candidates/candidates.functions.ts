/**
 * Server functions of the talent pool: the poke that tells the processor
 * new documents are queued (best effort: it polls the queue anyway) and
 * the erasure of a candidate with their files, the CVs and the photo
 * (admin). Both read the caller from the access token through
 * requireMember() and work only on the organisation it verified.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { planLots } from "@/lib/candidates/upload";
import { AppError } from "@/lib/platform/errors";
import { pokeProcessor } from "@/lib/platform/processor.server";
import { enforceRateLimit } from "@/lib/platform/rate-limit.server";
import { db, requireMember } from "@/lib/platform/supabase.server";

const notifyInput = z.object({
  accessToken: z.string().min(1).max(4096),
  orgId: z.uuid(),
  // The dialog pokes after each lot of 100; 500 leaves room for a retry of several lots at once.
  documentIds: z.array(z.uuid()).min(1).max(500),
});

/** The processor reads at most this many ids per poke; a lot is sent in a few pokes. */
const POKE_BATCH = 50;
/** Ids per ownership look-up: 500 of them in one `id=in.(...)` would exceed the 16 KB URL the gateway accepts. */
const LOOKUP_BATCH = 100;

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
    const unique: string[] = Array.from(new Set<string>(data.documentIds));
    const org = encodeURIComponent(member.orgId);
    const ids: string[] = [];
    for (const chunk of planLots(unique, LOOKUP_BATCH)) {
      const rows = await db().select<{ id: string }>(
        `documents?select=id&org_id=eq.${org}&id=in.(${chunk.map((id) => encodeURIComponent(id)).join(",")})`,
      );
      for (const row of rows) ids.push(row.id);
    }
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
  /** True when the profile carried a photo and it was removed with the CVs. */
  photoRemoved: boolean;
}

export const eraseCandidate = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => eraseInput.parse(data))
  .handler(async ({ data }): Promise<EraseResult> => {
    const member = await requireMember(data.accessToken, data.orgId, "admin");
    const client = db();
    const org = encodeURIComponent(member.orgId);
    const id = encodeURIComponent(data.candidateId);
    const found = await client.select<{ id: string; photo_path: string | null }>(
      `candidates?select=id,photo_path&org_id=eq.${org}&id=eq.${id}&limit=1`,
    );
    const candidate = found[0];
    if (!candidate) throw new AppError("NOT_FOUND");
    const documents = await client.select<{ storage_path: string }>(
      `documents?select=storage_path&org_id=eq.${org}&candidate_id=eq.${id}`,
    );
    const paths = documents.map((document) => document.storage_path);
    // The photo goes with the CVs, and first: one object, so a storage failure there stops the
    // erasure before any CV is gone (a retry finds the profile whole). The service role bypasses
    // the bucket's policies, so only a path inside this organisation's folder is ever removed.
    const photoPath =
      typeof candidate.photo_path === "string" &&
      candidate.photo_path.startsWith(`${member.orgId}/`)
        ? candidate.photo_path
        : null;
    // The processor writes <org>/<candidate>.png (or .jpg from the OCR); a CV read at the same time
    // as another one of the same person can leave that object without photo_path: it goes too.
    const photoObjects = [
      ...new Set([
        ...(photoPath ? [photoPath] : []),
        `${member.orgId}/${data.candidateId}.png`,
        `${member.orgId}/${data.candidateId}.jpg`,
      ]),
    ];
    await client.removeObjects("photos", photoObjects);
    await client.removeObjects("cvs", paths);
    // The documents rows go with the candidate (ON DELETE CASCADE); the trigger logs candidate.deleted.
    await client.delete("candidates", { id: data.candidateId, org_id: member.orgId });
    // The trigger ran under the service role (no auth.uid()): name the administrator, best effort.
    await client
      .patch(
        "activities",
        { org_id: member.orgId, kind: "candidate.deleted", target_id: data.candidateId },
        { actor_id: member.userId },
      )
      .catch((error: unknown) =>
        console.warn(
          "[candidates]",
          JSON.stringify({ event: "actor_stamp_failed", error: String(error).slice(0, 200) }),
        ),
      );
    console.info(
      "[candidates]",
      JSON.stringify({
        event: "erased",
        orgId: member.orgId,
        by: member.userId,
        documents: paths.length,
        photo: photoPath !== null,
      }),
    );
    return { removed: paths.length, photoRemoved: photoPath !== null };
  });
