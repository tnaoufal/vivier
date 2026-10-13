/**
 * Fastify app. Server-to-server only (the Worker calls it with the shared
 * secret): no CORS headers, every route but GET /health behind the bearer
 * secret, every answer JSON, every error a sentence without internals.
 * The runtime (what to do on /process and /maintenance) is injected so
 * the app builds without Supabase, as it does in CI's smoke test and in
 * the tests.
 */
import Fastify, { type FastifyInstance } from "fastify";

import type { ProcessorConfig } from "./config.js";
import { logError, logInfo } from "./log.js";
import type { MaintenanceReport } from "./maintenance.js";
import { readMetrics } from "./metrics.js";
import { bearerTokenOf, secretsMatch } from "./secret.js";

export interface AppRuntime {
  /** True when the poller runs (Supabase configured and POLL_INTERVAL_MS > 0). */
  polling: boolean;
  inFlight: () => number;
  /** Queues documents for processing; null when Supabase is not configured. */
  schedule: ((ids: string[]) => number) | null;
  /** Runs (or joins) a maintenance pass; null when Supabase is not configured. */
  maintenance: (() => Promise<MaintenanceReport>) | null;
}

export const PROCESS_MAX_IDS = 50;
const BODY_LIMIT_BYTES = 64 * 1024;
/** Time to receive a whole request; the Worker sends small JSON bodies at once. */
const REQUEST_TIMEOUT_MS = 30_000;
/**
 * Socket inactivity timeout. It runs while a handler works (no bytes move
 * until the answer), so it must exceed the slowest route: a maintenance
 * pass removing files for up to a hundred candidates.
 */
const CONNECTION_TIMEOUT_MS = 180_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const startedAt = Date.now();

/** The 4xx status an error carries (Fastify's parser and limit errors), else 500. */
export function clientStatusOf(error: unknown): number {
  const statusCode =
    error instanceof Error ? (error as Error & { statusCode?: unknown }).statusCode : undefined;
  return typeof statusCode === "number" && statusCode >= 400 && statusCode < 500 ? statusCode : 500;
}

/** The runtime of a service without Supabase: health and metrics only. */
export function idleRuntime(): AppRuntime {
  return { polling: false, inFlight: () => 0, schedule: null, maintenance: null };
}

export function buildApp(config: ProcessorConfig, runtime: AppRuntime = idleRuntime()): FastifyInstance {
  const app = Fastify({
    logger: false,
    bodyLimit: BODY_LIMIT_BYTES,
    requestTimeout: REQUEST_TIMEOUT_MS,
    connectionTimeout: CONNECTION_TIMEOUT_MS,
  });

  const setup = () => ({
    supabase: config.supabase !== null,
    model: config.model !== null,
    ocr: config.ocr !== null,
    polling: runtime.polling,
  });

  // One gate for every route: the bearer secret is checked before a
  // handler runs, so no route can forget it. GET /health alone is public;
  // an unknown path is refused too, so nothing can be enumerated.
  app.addHook("onRequest", async (request, reply) => {
    if (request.method === "GET" && request.routeOptions.url === "/health") return;
    const token = bearerTokenOf(request.headers.authorization);
    if (!secretsMatch(token, config.sharedSecret)) {
      return reply.code(401).send({ error: "Unauthorized." });
    }
  });

  // Public: says that the process listens and which parts are set up
  // (presence only, never a value).
  app.get("/health", async (_request, reply) => {
    return reply.send({
      ok: true,
      version: config.version,
      uptimeSeconds: Math.max(0, Math.round((Date.now() - startedAt) / 1000)),
      ...setup(),
    });
  });

  app.get("/metrics", async (_request, reply) => {
    return reply.send({
      ...readMetrics(),
      inFlight: runtime.inFlight(),
      setup: {
        ...setup(),
        concurrency: config.concurrency,
        pollIntervalMs: config.pollIntervalMs,
        maintenanceIntervalMs: config.maintenanceIntervalMs,
      },
    });
  });

  app.post("/process", async (request, reply) => {
    if (!runtime.schedule) {
      return reply.code(503).send({ error: "Supabase is not configured on this service." });
    }
    const body = request.body as { documentIds?: unknown } | null | undefined;
    const ids = body?.documentIds;
    if (
      !Array.isArray(ids) ||
      ids.length === 0 ||
      ids.length > PROCESS_MAX_IDS ||
      !ids.every((id) => typeof id === "string" && UUID_RE.test(id))
    ) {
      return reply.code(400).send({
        error: `Body must be { documentIds: string[] } with 1 to ${PROCESS_MAX_IDS} document ids.`,
      });
    }
    const unique = [...new Set((ids as string[]).map((id) => id.toLowerCase()))];
    const accepted = runtime.schedule(unique);
    logInfo("process_requested", { accepted });
    return reply.code(202).send({ accepted });
  });

  app.post("/maintenance", async (_request, reply) => {
    if (!runtime.maintenance) {
      return reply.code(503).send({ error: "Supabase is not configured on this service." });
    }
    const report = await runtime.maintenance();
    return reply.send(report);
  });

  app.setNotFoundHandler(async (_request, reply) => {
    return reply.code(404).send({ error: "Not found." });
  });

  // Fastify hands the error as `unknown`: a client error carries a 4xx
  // statusCode (body too large, invalid JSON); anything else is a 500.
  app.setErrorHandler(async (error: unknown, request, reply) => {
    const status = clientStatusOf(error);
    if (status === 500) {
      logError("request_failed", error, { method: request.method, url: request.url });
    }
    const message =
      status === 400
        ? "Invalid request body."
        : status === 413
          ? "Request body too large."
          : status === 415
            ? "Unsupported content type."
            : status < 500
              ? "Request refused."
              : "Internal error.";
    return reply.code(status).send({ error: message });
  });

  return app;
}
