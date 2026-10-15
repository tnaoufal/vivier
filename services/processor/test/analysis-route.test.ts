import { describe, expect, it } from "vitest";

import { buildApp, idleRuntime } from "../src/app.js";
import { loadConfig } from "../src/config.js";

const SEARCH = "66666666-6666-4666-8666-666666666666";

describe("POST /analyses/:searchId", () => {
  const config = loadConfig({
    PROCESSOR_SHARED_SECRET: "ci",
    PROCESSOR_ALLOW_INSECURE_SECRET: "1",
  });
  const auth = { authorization: "Bearer ci" };

  it("pokes the runner for a well-formed id and refuses the rest", async () => {
    const poked: string[] = [];
    const app = buildApp(config, {
      ...idleRuntime(),
      analysis: { poke: (id) => poked.push(id), running: () => 1 },
    });
    try {
      const accepted = await app.inject({
        method: "POST",
        url: `/analyses/${SEARCH.toUpperCase()}`,
        headers: auth,
      });
      expect(accepted.statusCode).toBe(202);
      expect(accepted.json()).toEqual({ queued: true });
      expect(poked).toEqual([SEARCH]);
      const malformed = await app.inject({ method: "POST", url: "/analyses/nope", headers: auth });
      expect(malformed.statusCode).toBe(400);
      const unauthorised = await app.inject({ method: "POST", url: `/analyses/${SEARCH}` });
      expect(unauthorised.statusCode).toBe(401);
      const metrics = await app.inject({ method: "GET", url: "/metrics", headers: auth });
      expect((metrics.json() as { analysesRunning: number }).analysesRunning).toBe(1);
    } finally {
      await app.close();
    }
  });

  it("answers 503 without Supabase", async () => {
    const app = buildApp(config);
    try {
      const res = await app.inject({ method: "POST", url: `/analyses/${SEARCH}`, headers: auth });
      expect(res.statusCode).toBe(503);
    } finally {
      await app.close();
    }
  });
});
