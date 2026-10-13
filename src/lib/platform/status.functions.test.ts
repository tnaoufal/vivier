import { describe, expect, it } from "vitest";

import { probeProcessor } from "./status.functions";
import { describeSetup } from "./settings.server";

describe("probeProcessor", () => {
  it("reads the health flags and never throws", async () => {
    const ok = await probeProcessor("https://p.example/", (async () =>
      new Response(JSON.stringify({ ok: true, version: "1.0.0", supabase: true, model: false }), {
        status: 200,
      })) as typeof fetch);
    expect(ok).toMatchObject({ reachable: true, ok: true, version: "1.0.0", supabase: true, model: false, ocr: null });
    const down = await probeProcessor("https://p.example", (async () => {
      throw new Error("ECONNREFUSED");
    }) as typeof fetch);
    expect(down.reachable).toBe(false);
    expect(await probeProcessor(null)).toMatchObject({ reachable: false });
  });
});

describe("describeSetup", () => {
  it("answers presence only", () => {
    const setup = describeSetup({
      SUPABASE_URL: "https://x.supabase.co",
      SUPABASE_PUBLISHABLE_KEY: "pk",
      SUPABASE_SERVICE_ROLE_KEY: "secret",
      LLM_API_KEY: "secret",
      LLM_BASE_URL: "https://api.mistral.ai/v1",
      RESEND_API_KEY: "secret",
      SITE_URL: "https://vivier.example",
    });
    expect(JSON.stringify(setup)).not.toContain("secret");
    expect(setup.accounts).toBe(true);
    expect(setup.model.baseUrl).toBe("https://api.mistral.ai/v1");
    expect(setup.email).toBe(true);
    expect(setup.processor).toBe(false);
  });
});
