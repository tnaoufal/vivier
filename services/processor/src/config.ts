/**
 * Environment configuration. Secrets are read here and never logged. Only
 * the shared secret is required to start: the process must answer
 * GET /health in CI with nothing else set, so Supabase, the model and OCR
 * are optional and their absence turns the matching part off (no polling
 * without Supabase, regex-only profiles without a model, `needs_ocr` for
 * scanned PDFs without OCR). Each omission is a warning the server logs
 * once at start and a flag /health shows.
 */

export const VERSION = "1.0.0";

/**
 * Shortest PROCESSOR_SHARED_SECRET accepted. It is the only gate on
 * `POST /process` and `POST /maintenance`: 32 random bytes (64 hex or 44
 * base64 characters) are the floor, a word is not. CI's smoke test starts
 * the container with `PROCESSOR_SHARED_SECRET=ci` and
 * PROCESSOR_ALLOW_INSECURE_SECRET=1; nothing else should.
 */
export const SHARED_SECRET_MIN_LENGTH = 32;

/**
 * Documents processed at once by default. A document is mostly waiting on
 * the model and the storage, so four in flight drain a queue of hundreds
 * of files at a steady pace without starving one process of memory;
 * PROCESSOR_CONCURRENCY tunes it within 1..8.
 */
export const DEFAULT_CONCURRENCY = 4;

/**
 * Model calls one analysis keeps in flight (the triage's batches, the
 * screening's, the readings): four drain a pool of a thousand profiles
 * in a few minutes without tripping the model's rate limit;
 * ANALYSIS_CONCURRENCY tunes it within 1..8.
 */
export const DEFAULT_ANALYSIS_CONCURRENCY = 4;
/** Analyses run at once by one process; ANALYSIS_MAX_RUNS tunes it within 1..4. */
export const DEFAULT_ANALYSIS_MAX_RUNS = 2;
/** How often the queued and the stale analyses are looked for (a lost poke, a crash or a redeploy never loses a run). */
export const DEFAULT_ANALYSIS_POLL_INTERVAL_MS = 30_000;

export const DEFAULT_CHAT_MODEL = "mistral-small-latest";
export const DEFAULT_EMBEDDING_MODEL = "mistral-embed";
export const DEFAULT_OCR_MODEL = "mistral-ocr-latest";
export const DEFAULT_OCR_URL = "https://api.mistral.ai/v1/ocr";

export interface SupabaseConfig {
  url: string;
  serviceRoleKey: string;
}

export interface ModelConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  embeddingModel: string;
  /** The chat model the analysis's calls go to (LLM_ANALYSIS_MODEL), the chat model unless set. */
  analysisModel: string;
}

export interface OcrConfig {
  apiKey: string;
  url: string;
  model: string;
}

export interface ProcessorConfig {
  version: string;
  port: number;
  /** Bearer secret every route but GET /health requires. */
  sharedSecret: string;
  /** True when a short secret was accepted because PROCESSOR_ALLOW_INSECURE_SECRET=1. */
  insecureSecretAllowed: boolean;
  supabase: SupabaseConfig | null;
  model: ModelConfig | null;
  ocr: OcrConfig | null;
  /** 0 disables the poller. */
  pollIntervalMs: number;
  /** 0 disables the maintenance timer (POST /maintenance still works). */
  maintenanceIntervalMs: number;
  /** Documents processed at once: 1..8 (default 4). */
  concurrency: number;
  /** Model calls one analysis keeps in flight: 1..8 (default 4). */
  analysisConcurrency: number;
  /** Analyses run at once: 1..4 (default 2). */
  analysisMaxRuns: number;
  /** How often queued or stale analyses are claimed; 0 disables the scan (a poke still starts a run). */
  analysisPollIntervalMs: number;
  /** Cap on the text kept per document (extracted_text and what the model reads from). */
  maxTextChars: number;
  /** What is off and why; logged once at start. */
  warnings: string[];
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

function value(env: NodeJS.ProcessEnv, key: string): string | null {
  const raw = env[key];
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

/** Clamps an integer env var into [min, max]; a blank or invalid value is the fallback. */
function clampedInt(raw: string | null, fallback: number, min: number, max: number): number {
  const parsed = raw === null ? NaN : Number(raw);
  const base = Number.isFinite(parsed) ? parsed : fallback;
  return Math.min(max, Math.max(min, Math.floor(base)));
}

/** An interval in ms where "0" means off; other values clamp into [min, max]. */
function intervalMs(raw: string | null, fallback: number, min: number, max: number): number {
  if (raw !== null && Number(raw) === 0) return 0;
  return clampedInt(raw, fallback, min, max);
}

function httpUrl(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return raw.replace(/\/+$/, "");
  } catch {
    return null;
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ProcessorConfig {
  const warnings: string[] = [];

  const sharedSecret = value(env, "PROCESSOR_SHARED_SECRET");
  if (!sharedSecret) {
    throw new ConfigError(
      "PROCESSOR_SHARED_SECRET is required: set the same value as on the Worker (openssl rand -hex 32)",
    );
  }
  const insecureSecretAllowed = value(env, "PROCESSOR_ALLOW_INSECURE_SECRET") === "1";
  if (sharedSecret.length < SHARED_SECRET_MIN_LENGTH) {
    if (!insecureSecretAllowed) {
      throw new ConfigError(
        `PROCESSOR_SHARED_SECRET must be at least ${SHARED_SECRET_MIN_LENGTH} characters (openssl rand -hex 32); PROCESSOR_ALLOW_INSECURE_SECRET=1 overrides this for a local or CI smoke test only`,
      );
    }
    warnings.push(
      `PROCESSOR_SHARED_SECRET is shorter than ${SHARED_SECRET_MIN_LENGTH} characters and was accepted because PROCESSOR_ALLOW_INSECURE_SECRET=1: smoke tests only, never production`,
    );
  }

  const supabaseUrl = httpUrl(value(env, "SUPABASE_URL"));
  const serviceRoleKey = value(env, "SUPABASE_SERVICE_ROLE_KEY");
  let supabase: SupabaseConfig | null = null;
  if (supabaseUrl && serviceRoleKey) {
    supabase = { url: supabaseUrl, serviceRoleKey };
  } else if (value(env, "SUPABASE_URL") && !supabaseUrl) {
    warnings.push("SUPABASE_URL is not an http(s) URL: Supabase is off, nothing is processed");
  } else if (supabaseUrl || serviceRoleKey) {
    warnings.push(
      "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set: Supabase is off, nothing is processed",
    );
  } else {
    warnings.push(
      "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are not set: the service answers /health only, nothing is processed",
    );
  }

  const llmApiKey = value(env, "LLM_API_KEY");
  let model: ModelConfig | null = null;
  if (llmApiKey) {
    const baseUrl = (httpUrl(value(env, "LLM_BASE_URL")) ?? "https://api.openai.com/v1").replace(
      /\/+$/,
      "",
    );
    const mistral = baseUrl.includes("mistral.ai");
    const chatModel = value(env, "LLM_MODEL") ?? (mistral ? DEFAULT_CHAT_MODEL : "gpt-4o-mini");
    model = {
      baseUrl,
      apiKey: llmApiKey,
      model: chatModel,
      embeddingModel:
        value(env, "LLM_EMBEDDING_MODEL") ??
        (mistral ? DEFAULT_EMBEDDING_MODEL : "text-embedding-3-small"),
      analysisModel: value(env, "LLM_ANALYSIS_MODEL") ?? chatModel,
    };
  } else {
    warnings.push(
      "LLM_API_KEY is not set: no model, profiles come from regexes only (low confidence) and candidates get no embedding",
    );
  }

  const ocrApiKey = value(env, "MISTRAL_OCR_API_KEY");
  let ocr: OcrConfig | null = null;
  if (ocrApiKey) {
    ocr = {
      apiKey: ocrApiKey,
      url: httpUrl(value(env, "MISTRAL_OCR_URL")) ?? DEFAULT_OCR_URL,
      model: value(env, "MISTRAL_OCR_MODEL") ?? DEFAULT_OCR_MODEL,
    };
  } else {
    warnings.push("MISTRAL_OCR_API_KEY is not set: scanned PDFs end in needs_ocr");
  }

  return {
    version: VERSION,
    port: clampedInt(value(env, "PORT"), 8080, 1, 65535),
    sharedSecret,
    insecureSecretAllowed,
    supabase,
    model,
    ocr,
    pollIntervalMs: intervalMs(value(env, "POLL_INTERVAL_MS"), 20_000, 1_000, 3_600_000),
    maintenanceIntervalMs: intervalMs(
      value(env, "MAINTENANCE_INTERVAL_MS"),
      3_600_000,
      60_000,
      86_400_000,
    ),
    concurrency: clampedInt(value(env, "PROCESSOR_CONCURRENCY"), DEFAULT_CONCURRENCY, 1, 8),
    analysisConcurrency: clampedInt(
      value(env, "ANALYSIS_CONCURRENCY"),
      DEFAULT_ANALYSIS_CONCURRENCY,
      1,
      8,
    ),
    analysisMaxRuns: clampedInt(value(env, "ANALYSIS_MAX_RUNS"), DEFAULT_ANALYSIS_MAX_RUNS, 1, 4),
    analysisPollIntervalMs: intervalMs(
      value(env, "ANALYSIS_POLL_INTERVAL_MS"),
      DEFAULT_ANALYSIS_POLL_INTERVAL_MS,
      5_000,
      3_600_000,
    ),
    maxTextChars: clampedInt(value(env, "MAX_TEXT_CHARS"), 200_000, 10_000, 2_000_000),
    warnings,
  };
}
