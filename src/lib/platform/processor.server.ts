/**
 * Talking to the processor (services/processor on Railway): a poke after
 * an upload so queued documents are picked up at once, a poke after a
 * search is queued so its analysis starts at once, and a maintenance
 * trigger. Best effort: the processor also polls the documents queue and
 * scans the searches table itself, so a failed poke only delays the
 * work; it is never shown as an upload or an analysis error.
 */
import { settings } from "./settings.server";

export interface PokeResult {
  /** False when the service is not set up or did not answer 2xx. */
  reached: boolean;
}

/** The processor's address without a trailing slash, or null when the service is not set up. */
function processorBase(): { url: string; secret: string } | null {
  const s = settings();
  if (!s.processorUrl || !s.processorSecret) return null;
  return { url: s.processorUrl.replace(/\/+$/, ""), secret: s.processorSecret };
}

export async function pokeProcessor(
  documentIds: string[],
  fetchImpl: typeof fetch = fetch,
): Promise<PokeResult> {
  const base = processorBase();
  if (!base || !documentIds.length) return { reached: false };
  try {
    const response = await fetchImpl(`${base.url}/process`, {
      method: "POST",
      headers: { Authorization: `Bearer ${base.secret}`, "Content-Type": "application/json" },
      body: JSON.stringify({ documentIds: documentIds.slice(0, 50) }),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      console.warn(
        "[processor]",
        JSON.stringify({ event: "poke_refused", status: response.status }),
      );
    }
    return { reached: response.ok };
  } catch (error) {
    console.warn(
      "[processor]",
      JSON.stringify({ event: "poke_failed", error: String(error).slice(0, 200) }),
    );
    return { reached: false };
  }
}

/**
 * Tells the processor a search was queued (POST /analyses/<id>), so its
 * run starts now rather than at the next scan of the table (every 30 s).
 * A refusal or a failure is logged with the search's id and nothing
 * else: the scan picks the row up all the same.
 */
export async function pokeAnalysis(
  searchId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<PokeResult> {
  const base = processorBase();
  if (!base || !searchId) return { reached: false };
  try {
    const response = await fetchImpl(`${base.url}/analyses/${encodeURIComponent(searchId)}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${base.secret}`, "Content-Type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      console.warn(
        "[processor]",
        JSON.stringify({ event: "analysis_poke_refused", searchId, status: response.status }),
      );
    }
    return { reached: response.ok };
  } catch (error) {
    console.warn(
      "[processor]",
      JSON.stringify({
        event: "analysis_poke_failed",
        searchId,
        error: String(error).slice(0, 200),
      }),
    );
    return { reached: false };
  }
}
