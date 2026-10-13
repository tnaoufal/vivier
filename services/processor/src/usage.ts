/**
 * Spend accounting: every model, embedding and OCR call ends in one
 * `ai_usage` row for the organisation it served. A usage row that could
 * not be written must never fail the work it accounts for (the document,
 * the re-embed pass): it is logged and forgotten.
 */
import type { Db } from "./db.js";
import { logError } from "./log.js";
import type { Usage } from "./model.js";
import type { AiUsageKind } from "./types.js";

export type UsageRecorder = (orgId: string, kind: AiUsageKind, usage: Usage) => Promise<void>;

export function usageRecorderOf(db: Db): UsageRecorder {
  return async (orgId, kind, usage) => {
    try {
      await db.recordUsage(orgId, kind, usage.model, usage.tokensIn, usage.tokensOut);
    } catch (error) {
      logError("usage_record_failed", error, { orgId, kind });
    }
  };
}
