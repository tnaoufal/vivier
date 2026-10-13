import { afterEach, describe, expect, it } from "vitest";

import { buildApp, idleRuntime, type AppRuntime } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { bearerTokenOf, secretsMatch } from "../src/secret.js";

const SECRET = "ci";
const DOC_A = "11111111-1111-4111-8111-111111111111";
const DOC_B = "22222222-2222-4222-8222-222222222222";

function config() {
  return loadConfig({ PROCESSOR_SHARED_SECRET: SECRET, PROCESSOR_ALLOW_INSECURE_SECRET: "1" });
}

const auth = { authorization: `Bearer ${SECRET}` };

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (closers.length) await closers.pop()?.();
});

function app(runtime: AppRuntime = idleRuntime()) {
  const instance = buildApp(config(), runtime);
  closers.push(() => instance.close());
  return instance;
}

describe("config", () => {
  it("refuses to start without a secret or with a short one unless the override is set", () => {
    expect(() => loadConfig({})).toThrow(/PROCESSOR_SHARED_SECRET/);
    expect(() => loadConfig({ PROCESSOR_SHARED_SECRET: "short" })).toThrow(/32 characters/);
    const insecure = config();
    expect(insecure.insecureSecretAllowed).toBe(true);
    expect(insecure.warnings.some((w) => w.includes("shorter"))).toBe(true);
    const sound = loadConfig({ PROCESSOR_SHARED_SECRET: "s".repeat(32) });
    expect(sound.insecureSecretAllowed).toBe(false);
    expect(sound.supabase).toBeNull();
    expect(sound.model).toBeNull();
    expect(sound.ocr).toBeNull();
    expect(sound.concurrency).toBe(4);
  });

  it("reads the optional parts and clamps the numbers", () => {
    const c = loadConfig({
      PROCESSOR_SHARED_SECRET: "s".repeat(32),
      SUPABASE_URL: "https://abc.supabase.co/",
      SUPABASE_SERVICE_ROLE_KEY: "service",
      LLM_API_KEY: "key",
      LLM_BASE_URL: "https://api.mistral.ai/v1",
      MISTRAL_OCR_API_KEY: "ocr",
      POLL_INTERVAL_MS: "0",
      MAINTENANCE_INTERVAL_MS: "1",
      PROCESSOR_CONCURRENCY: "99",
      MAX_TEXT_CHARS: "abc",
      PORT: "9000",
    });
    expect(c.supabase).toEqual({ url: "https://abc.supabase.co", serviceRoleKey: "service" });
    expect(c.model).toEqual({
      baseUrl: "https://api.mistral.ai/v1",
      apiKey: "key",
      model: "mistral-small-latest",
      embeddingModel: "mistral-embed",
    });
    expect(c.ocr?.model).toBe("mistral-ocr-latest");
    expect(c.pollIntervalMs).toBe(0);
    expect(c.maintenanceIntervalMs).toBe(60_000);
    expect(c.concurrency).toBe(8);
    expect(c.maxTextChars).toBe(200_000);
    expect(c.port).toBe(9000);
  });
});

describe("secret", () => {
  it("compares secrets and reads bearer headers", () => {
    expect(secretsMatch("abc", "abc")).toBe(true);
    expect(secretsMatch("abc", "abd")).toBe(false);
    expect(secretsMatch("", "")).toBe(false);
    expect(bearerTokenOf("Bearer token ")).toBe("token");
    expect(bearerTokenOf("Basic x")).toBe("");
    expect(bearerTokenOf(undefined)).toBe("");
  });
});

describe("app", () => {
  it("answers /health without a bearer and says what is set up", async () => {
    const res = await app().inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body["ok"]).toBe(true);
    expect(body["supabase"]).toBe(false);
    expect(body["model"]).toBe(false);
    expect(body["ocr"]).toBe(false);
    expect(body["embedding"]).toBe("off");
    expect(body["polling"]).toBe(false);
    expect(typeof body["version"]).toBe("string");
    expect(typeof body["uptimeSeconds"]).toBe("number");
  });

  it("refuses /metrics without the bearer and serves it with", async () => {
    const instance = app();
    expect((await instance.inject({ method: "GET", url: "/metrics" })).statusCode).toBe(401);
    expect(
      (await instance.inject({ method: "GET", url: "/metrics", headers: { authorization: "Bearer nope" } })).statusCode,
    ).toBe(401);
    const res = await instance.inject({ method: "GET", url: "/metrics", headers: auth });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body["documents"]).toBeDefined();
    expect(body["inFlight"]).toBe(0);
    expect((body["setup"] as Record<string, unknown>)["supabase"]).toBe(false);
  });

  it("answers 503 on /process and /maintenance when Supabase is not configured", async () => {
    const instance = app();
    const process = await instance.inject({
      method: "POST",
      url: "/process",
      headers: auth,
      payload: { documentIds: [DOC_A] },
    });
    expect(process.statusCode).toBe(503);
    expect((process.json() as { error: string }).error).toMatch(/Supabase/);
    const maintenance = await instance.inject({ method: "POST", url: "/maintenance", headers: auth });
    expect(maintenance.statusCode).toBe(503);
  });

  it("validates and schedules /process, and runs /maintenance", async () => {
    const scheduled: string[][] = [];
    const instance = app({
      polling: true,
      inFlight: () => 3,
      schedule: (ids) => {
        scheduled.push(ids);
        return ids.length;
      },
      maintenance: async () => ({
        ranAt: "2026-10-13T10:00:00.000Z",
        purged: 1,
        filesRemoved: 2,
        failed: 0,
        staleRequeued: 0,
        staleFailed: 0,
        reembedded: 3,
        reembedFailed: 0,
        reembedSkipped: 0,
        ms: 5,
      }),
    });
    const accepted = await instance.inject({
      method: "POST",
      url: "/process",
      headers: auth,
      payload: { documentIds: [DOC_A, DOC_A.toUpperCase(), DOC_B] },
    });
    expect(accepted.statusCode).toBe(202);
    expect(accepted.json()).toEqual({ accepted: 2 });
    expect(scheduled).toEqual([[DOC_A, DOC_B]]);

    for (const payload of [{}, { documentIds: [] }, { documentIds: ["x"] }, { documentIds: Array(51).fill(DOC_A) }]) {
      const res = await instance.inject({ method: "POST", url: "/process", headers: auth, payload });
      expect(res.statusCode).toBe(400);
      expect(typeof (res.json() as { error: string }).error).toBe("string");
    }
    const broken = await instance.inject({
      method: "POST",
      url: "/process",
      headers: { ...auth, "content-type": "application/json" },
      payload: "{not json",
    });
    expect(broken.statusCode).toBe(400);
    expect(broken.json()).toEqual({ error: "Invalid request body." });

    const maintenance = await instance.inject({ method: "POST", url: "/maintenance", headers: auth });
    expect(maintenance.statusCode).toBe(200);
    expect((maintenance.json() as { purged: number }).purged).toBe(1);
    expect((maintenance.json() as { reembedded: number }).reembedded).toBe(3);

    const metrics = await instance.inject({ method: "GET", url: "/metrics", headers: auth });
    expect((metrics.json() as { inFlight: number }).inFlight).toBe(3);
  });

  it("answers 401 then 404 for an unknown route", async () => {
    const instance = app();
    expect((await instance.inject({ method: "GET", url: "/nope" })).statusCode).toBe(401);
    const res = await instance.inject({ method: "GET", url: "/nope", headers: auth });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "Not found." });
  });
});
