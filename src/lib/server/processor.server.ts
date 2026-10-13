/**
 * Talking to the processor (services/processor on Railway): a poke after
 * an upload so queued documents are picked up at once, and a maintenance
 * trigger. Best effort: the processor also polls the queue itself, so a
 * failed poke only delays the work; it is never shown as an upload error.
 */
import { settings } from "./settings.server";

export interface PokeResult {
  /** False when the service is not set up or did not answer 2xx. */
  reached: boolean;
}

export async function pokeProcessor(documentIds: string[], fetchImpl: typeof fetch = fetch): Promise<PokeResult> {
  const s = settings();
  if (!s.processorUrl || !s.processorSecret || !documentIds.length) return { reached: false };
  try {
    const response = await fetchImpl(`${s.processorUrl.replace(/\/+$/, "")}/process`, {
      method: "POST",
      headers: { Authorization: `Bearer ${s.processorSecret}`, "Content-Type": "application/json" },
      body: JSON.stringify({ documentIds: documentIds.slice(0, 50) }),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      console.warn("[processor]", JSON.stringify({ event: "poke_refused", status: response.status }));
    }
    return { reached: response.ok };
  } catch (error) {
    console.warn("[processor]", JSON.stringify({ event: "poke_failed", error: String(error).slice(0, 200) }));
    return { reached: false };
  }
}
