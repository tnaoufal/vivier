/** Records what a model call cost, per organisation (ai_usage). Never throws: a failed record must not fail the answer. */
import type { AiUsageKind } from "@/lib/db/types";
import type { Usage } from "@/lib/model/model.server";

import { db } from "./supabase.server";

export async function recordUsage(orgId: string, kind: AiUsageKind, usage: Usage): Promise<void> {
  try {
    await db().insert("ai_usage", [
      { org_id: orgId, kind, model: usage.model, tokens_in: usage.tokensIn, tokens_out: usage.tokensOut },
    ]);
  } catch (error) {
    console.warn("[usage]", JSON.stringify({ event: "record_failed", kind, error: String(error) }));
  }
}
