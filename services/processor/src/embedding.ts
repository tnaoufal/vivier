/**
 * What the service knows about its embedding model while it runs. The
 * schema holds vectors of EMBEDDING_DIMENSIONS; a LLM_EMBEDDING_MODEL
 * that answers another width fails every embedding quietly, and the
 * candidates end up without a vector (found by text only). So the server
 * probes the model once after it listens, the pipeline and the re-embed
 * pass report what they see, and GET /health shows the state: "off"
 * without a model (or until the probe has answered), "ok", "mismatch"
 * (the wrong width: the fix sentence names the variable) or "unavailable"
 * (the probe failed, or EMBEDDING_FAILURES_BEFORE_UNAVAILABLE calls in a
 * row did, for another reason). A wrong width is a configuration mistake
 * and flips the state at once; any other error can be one 429 or one
 * timeout among four documents in flight, so a model that answers is not
 * reported down for it. Kept in memory like the metrics: one process,
 * reset on every deploy.
 */
import { logError, logInfo } from "./log.js";
import { ModelError, type Embedder } from "./model.js";
import { EMBEDDING_DIMENSIONS } from "./types.js";

export type EmbeddingStatus = "ok" | "mismatch" | "unavailable" | "off";

/** The text embedded by the startup probe: short, neutral, the same every time. */
export const EMBEDDING_PROBE_TEXT = "vivier probe";

/** Failures in a row (no mismatch, no success between them) before an "ok" state turns "unavailable". */
export const EMBEDDING_FAILURES_BEFORE_UNAVAILABLE = 3;

let status: EmbeddingStatus = "off";
let failuresInARow = 0;

export function embeddingStatus(): EmbeddingStatus {
  return status;
}

/** True for the ModelError thrown when the model answered a vector of the wrong width. */
export function isDimensionMismatch(error: unknown): error is ModelError {
  return error instanceof ModelError && error.dimensions !== null;
}

/** The one sentence an operator needs: which variable, which width, which value works. */
export function embeddingFixSentence(model: string | null, answered: number | null = null): string {
  const variable = model === null ? "LLM_EMBEDDING_MODEL" : `LLM_EMBEDDING_MODEL=${model}`;
  const width = answered === null ? "another width" : `${answered} dimensions`;
  return `${variable} answers ${width}; the candidates.embedding column holds ${EMBEDDING_DIMENSIONS}. Set LLM_EMBEDDING_MODEL to a ${EMBEDDING_DIMENSIONS}-dimension model (mistral-embed on Mistral; OpenAI's text-embedding-3-* are shortened to ${EMBEDDING_DIMENSIONS} automatically) and redeploy.`;
}

export function noteEmbeddingSuccess(): void {
  status = "ok";
  failuresInARow = 0;
}

/**
 * Records a failed embedding call and answers the state it leads to: a
 * wrong width is "mismatch" at once; another error is "unavailable" when
 * nothing has succeeded yet (the probe's own failure) or after
 * EMBEDDING_FAILURES_BEFORE_UNAVAILABLE in a row from "ok". A "mismatch"
 * stays whatever fails next: the variable is what to fix, and only a
 * success proves it fixed.
 */
export function noteEmbeddingFailure(error: unknown): EmbeddingStatus {
  if (isDimensionMismatch(error)) {
    status = "mismatch";
    failuresInARow = 0;
    return status;
  }
  failuresInARow += 1;
  if (status === "off" || (status === "ok" && failuresInARow >= EMBEDDING_FAILURES_BEFORE_UNAVAILABLE)) {
    markUnavailable();
  }
  return status;
}

function markUnavailable(): EmbeddingStatus {
  status = "unavailable";
  return status;
}

/** Test hook. */
export function resetEmbeddingStatus(): void {
  status = "off";
  failuresInARow = 0;
}

/**
 * Embeds EMBEDDING_PROBE_TEXT once and logs the result: `embedding_ok`,
 * `embedding_mismatch` (with the fix sentence) or `embedding_unavailable`.
 * Never throws: the server fires it after listen and goes on; /health
 * reads the state it leaves.
 */
export async function probeEmbedding(embed: Embedder, model: string): Promise<EmbeddingStatus> {
  try {
    const { vector } = await embed(EMBEDDING_PROBE_TEXT);
    noteEmbeddingSuccess();
    logInfo("embedding_ok", { model, dimensions: vector.length });
  } catch (error) {
    // The probe's answer is the state, whatever was there: it is the check.
    const next = isDimensionMismatch(error) ? noteEmbeddingFailure(error) : markUnavailable();
    if (next === "mismatch") {
      const answered = isDimensionMismatch(error) ? error.dimensions : null;
      logError("embedding_mismatch", error, { model, fix: embeddingFixSentence(model, answered) });
    } else {
      logError("embedding_unavailable", error, { model });
    }
  }
  return status;
}
