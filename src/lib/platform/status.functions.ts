/**
 * What /status shows: the live setup (presence of each part, never a
 * value) and a probe of the processor's health. Free of secrets by
 * construction: describeSetup() answers booleans and public names only.
 */
import { createServerFn } from "@tanstack/react-start";

import { describeSetup, settings, type Setup } from "./settings.server";

export interface ProcessorHealth {
  reachable: boolean;
  ok: boolean;
  version: string | null;
  supabase: boolean | null;
  model: boolean | null;
  ocr: boolean | null;
  polling: boolean | null;
}

export async function probeProcessor(
  url: string | null,
  fetchImpl: typeof fetch = fetch,
): Promise<ProcessorHealth> {
  const none: ProcessorHealth = { reachable: false, ok: false, version: null, supabase: null, model: null, ocr: null, polling: null };
  if (!url) return none;
  try {
    const response = await fetchImpl(`${url.replace(/\/+$/, "")}/health`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return { ...none, reachable: true };
    const json = (await response.json()) as Record<string, unknown>;
    const flag = (key: string) => (typeof json[key] === "boolean" ? (json[key] as boolean) : null);
    return {
      reachable: true,
      ok: json["ok"] === true,
      version: typeof json["version"] === "string" ? json["version"] : null,
      supabase: flag("supabase"),
      model: flag("model"),
      ocr: flag("ocr"),
      polling: flag("polling"),
    };
  } catch {
    return none;
  }
}

export interface StatusReport {
  setup: Setup;
  processor: ProcessorHealth;
  checkedAt: string;
}

export const getStatus = createServerFn({ method: "GET" }).handler(async (): Promise<StatusReport> => {
  const s = settings();
  return {
    setup: describeSetup(),
    processor: await probeProcessor(s.processorUrl),
    checkedAt: new Date().toISOString(),
  };
});
