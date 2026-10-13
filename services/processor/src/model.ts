/**
 * The model, behind any OpenAI-compatible API (LLM_BASE_URL, LLM_API_KEY,
 * LLM_MODEL, LLM_EMBEDDING_MODEL): the same conventions as the web app's
 * `model.server.ts`, copied so the service stays self-contained. Mistral
 * is the recommended vendor for European hosting (api.mistral.ai/v1,
 * mistral-small-latest, mistral-embed); OpenAI, a gateway, Groq, Together,
 * OpenRouter and a local Ollama expose the same API. Only the stable
 * `chat.completions.create` and `embeddings.create` calls are used, so
 * any 4.x, 5.x or 6.x of the `openai` package works.
 *
 * A JSON answer is extracted, parsed and validated with a zod schema; one
 * retry quotes the validation error back; then a ModelError, never a
 * partial object. Vectors must be exactly EMBEDDING_DIMENSIONS wide.
 */
import OpenAI from "openai";
import type { z, ZodTypeAny } from "zod";

import type { ModelConfig } from "./config.js";
import { EMBEDDING_DIMENSIONS } from "./types.js";

/** A model call failed, answered nothing usable, or answered the wrong width. */
export class ModelError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ModelError";
  }
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

let cached: { key: string; client: OpenAI } | undefined;

function client(config: ModelConfig): OpenAI {
  const key = `${config.baseUrl}|${config.apiKey}`;
  if (cached?.key !== key) {
    cached = {
      key,
      client: new OpenAI({
        apiKey: config.apiKey,
        baseURL: config.baseUrl,
        maxRetries: 1,
        timeout: 60_000,
      }),
    };
  }
  return cached.client;
}

/** The first balanced JSON object or array in a text, for a model that wraps its answer. */
export function extractJson(text: string): string | null {
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
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
 * ModelError (never a partial object).
 */
export async function completeJson<S extends ZodTypeAny>(input: {
  system: string;
  user: string;
  schema: S;
  temperature?: number;
  maxTokens?: number;
  config: ModelConfig;
}): Promise<JsonAnswer<z.output<S>>> {
  const api = client(input.config);
  let tokensIn = 0;
  let tokensOut = 0;
  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const completion = await api.chat.completions
      .create({
        model: input.config.model,
        messages:
          attempt === 0
            ? [
                { role: "system", content: input.system },
                { role: "user", content: input.user },
              ]
            : [
                { role: "system", content: input.system },
                { role: "user", content: input.user },
                {
                  role: "user",
                  content: `Your previous answer was not valid: ${lastError}. Answer again with JSON only.`,
                },
              ],
        temperature: input.temperature ?? 0.1,
        max_tokens: input.maxTokens ?? 2000,
        response_format: { type: "json_object" },
      })
      .catch((error: unknown): never => {
        throw new ModelError("The model call failed", { cause: error });
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
      return {
        value: result.data as z.output<S>,
        usage: { model: input.config.model, tokensIn, tokensOut },
      };
    }
    lastError = result.error.issues
      .slice(0, 5)
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
  }
  throw new ModelError(`The model did not answer valid JSON: ${lastError}`);
}

/** One embedding, EMBEDDING_DIMENSIONS wide (OpenAI models are shortened; others must match). */
export async function embedOne(
  text: string,
  config: ModelConfig,
): Promise<{ vector: number[]; usage: Usage }> {
  const api = client(config);
  const openai = config.baseUrl.includes("api.openai.com");
  const response = await api.embeddings
    .create({
      model: config.embeddingModel,
      input: [text.slice(0, 8000)],
      ...(openai ? { dimensions: EMBEDDING_DIMENSIONS } : {}),
    })
    .catch((error: unknown): never => {
      throw new ModelError("The embedding call failed", { cause: error });
    });
  const vector = response.data[0]?.embedding;
  if (!vector || !Array.isArray(vector)) {
    throw new ModelError("The embedding model answered no vector");
  }
  if (vector.length !== EMBEDDING_DIMENSIONS) {
    throw new ModelError(
      `The embedding model answered ${vector.length} dimensions; the schema holds ${EMBEDDING_DIMENSIONS}. Set LLM_EMBEDDING_MODEL to a ${EMBEDDING_DIMENSIONS}-dimension model.`,
    );
  }
  return {
    vector,
    usage: {
      model: config.embeddingModel,
      tokensIn: response.usage?.prompt_tokens ?? 0,
      tokensOut: 0,
    },
  };
}

/** A pgvector literal for a REST insert or an RPC argument. */
export function vectorLiteral(vector: number[]): string {
  return `[${vector.map((v) => (Number.isFinite(v) ? v.toFixed(6) : "0")).join(",")}]`;
}
