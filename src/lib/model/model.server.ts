/**
 * The model, behind any OpenAI-compatible API: LLM_BASE_URL, LLM_API_KEY,
 * LLM_MODEL and LLM_EMBEDDING_MODEL (README "Model"). Mistral is the
 * recommended vendor for European hosting (api.mistral.ai/v1,
 * mistral-small-latest, mistral-embed); OpenAI, Anthropic through a
 * gateway, Groq, Together, OpenRouter and a local Ollama expose the same
 * API. Without a key, `modelConfigured()` is false and every caller
 * answers honestly that no model is set up, never a made-up result.
 *
 * Every call here is behind `enforceRateLimit("model")` in the server
 * functions that use it, and every answer is recorded in ai_usage.
 */
import OpenAI from "openai";
import type { ZodType } from "zod";

import { EMBEDDING_DIMENSIONS } from "@/lib/db/types";
import { AppError } from "@/lib/platform/errors";
import { settings, type Settings } from "@/lib/platform/settings.server";

export const DEFAULT_CHAT_MODEL = "mistral-small-latest";
export const DEFAULT_EMBEDDING_MODEL = "mistral-embed";

export interface ModelConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  embeddingModel: string;
}

export function modelConfig(s: Settings = settings()): ModelConfig | null {
  if (!s.llm.apiKey) return null;
  const baseUrl = (s.llm.baseUrl ?? "https://api.openai.com/v1").replace(/\/+$/, "");
  const mistral = baseUrl.includes("mistral.ai");
  return {
    baseUrl,
    apiKey: s.llm.apiKey,
    model: s.llm.model ?? (mistral ? DEFAULT_CHAT_MODEL : "gpt-4o-mini"),
    embeddingModel:
      s.llm.embeddingModel ?? (mistral ? DEFAULT_EMBEDDING_MODEL : "text-embedding-3-small"),
  };
}

export function modelConfigured(s: Settings = settings()): boolean {
  return modelConfig(s) !== null;
}

let cached: { key: string; client: OpenAI } | undefined;

function client(config: ModelConfig): OpenAI {
  const key = `${config.baseUrl}|${config.apiKey}`;
  if (cached?.key !== key) {
    cached = {
      key,
      client: new OpenAI({ apiKey: config.apiKey, baseURL: config.baseUrl, maxRetries: 1, timeout: 45_000 }),
    };
  }
  return cached.client;
}

export interface Usage {
  model: string;
  tokensIn: number;
  tokensOut: number;
}

export interface JsonAnswer<T> {
  value: T;
  usage: Usage;
}

/** The first balanced JSON object or array in a text, for a model that wraps its answer. */
export function extractJson(text: string): string | null {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = trimmed.search(/[[{]/);
  if (start < 0) return null;
  const open = trimmed[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  for (let i = start; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return trimmed.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * Asks for a JSON answer and validates it with the schema. One retry on
 * an answer the schema rejects, with the error quoted back; then a thrown
 * error (never a partial object). `model` names another chat model of the
 * same endpoint for this call (the assessment may use a stronger one);
 * empty or null means the configured one, and the usage names the one used.
 */
export async function completeJson<T>(input: {
  system: string;
  user: string;
  schema: ZodType<T>;
  temperature?: number;
  maxTokens?: number;
  model?: string | null;
  config?: ModelConfig | null;
}): Promise<JsonAnswer<T>> {
  const config = input.config ?? modelConfig();
  if (!config) throw new AppError("SETUP:model");
  const model = input.model?.trim() || config.model;
  const api = client(config);
  // Structural, so the call type-checks whatever the SDK names its union.
  const messages: { role: "system" | "user"; content: string }[] = [
    { role: "system", content: input.system },
    { role: "user", content: input.user },
  ];
  let tokensIn = 0;
  let tokensOut = 0;
  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const completion = await api.chat.completions.create({
      model,
      messages:
        attempt === 0
          ? messages
          : [
              ...messages,
              { role: "user", content: `Your previous answer was not valid: ${lastError}. Answer again with JSON only.` },
            ],
      temperature: input.temperature ?? 0.1,
      max_tokens: input.maxTokens ?? 2000,
      response_format: { type: "json_object" },
    });
    tokensIn += completion.usage?.prompt_tokens ?? 0;
    tokensOut += completion.usage?.completion_tokens ?? 0;
    const text = completion.choices[0]?.message?.content ?? "";
    const json = extractJson(text);
    if (!json) {
      lastError = "no JSON object found";
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch (error) {
      lastError = `JSON parse error: ${error instanceof Error ? error.message : String(error)}`;
      continue;
    }
    const result = input.schema.safeParse(parsed);
    if (result.success) {
      return { value: result.data, usage: { model, tokensIn, tokensOut } };
    }
    lastError = result.error.issues
      .slice(0, 5)
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
  }
  throw new Error(`The model did not answer valid JSON: ${lastError}`);
}

/** One embedding per text, normalised to EMBEDDING_DIMENSIONS (OpenAI models are shortened; others must match). */
export async function embed(
  texts: string[],
  config: ModelConfig | null = modelConfig(),
): Promise<{ vectors: number[][]; usage: Usage }> {
  if (!config) throw new AppError("SETUP:model");
  if (!texts.length) return { vectors: [], usage: { model: config.embeddingModel, tokensIn: 0, tokensOut: 0 } };
  const api = client(config);
  const openai = config.baseUrl.includes("api.openai.com");
  const response = await api.embeddings.create({
    model: config.embeddingModel,
    input: texts.map((text) => text.slice(0, 8000)),
    ...(openai ? { dimensions: EMBEDDING_DIMENSIONS } : {}),
  });
  const vectors = response.data
    .slice()
    .sort((a, b) => a.index - b.index)
    .map((item) => item.embedding);
  for (const vector of vectors) {
    if (vector.length !== EMBEDDING_DIMENSIONS) {
      throw new Error(
        `The embedding model answered ${vector.length} dimensions; the schema holds ${EMBEDDING_DIMENSIONS}. Set LLM_EMBEDDING_MODEL to a ${EMBEDDING_DIMENSIONS}-dimension model.`,
      );
    }
  }
  return {
    vectors,
    usage: { model: config.embeddingModel, tokensIn: response.usage?.prompt_tokens ?? 0, tokensOut: 0 },
  };
}

/** A pgvector literal for a REST insert or an RPC argument. */
export function vectorLiteral(vector: number[]): string {
  return `[${vector.map((v) => (Number.isFinite(v) ? v.toFixed(6) : "0")).join(",")}]`;
}
