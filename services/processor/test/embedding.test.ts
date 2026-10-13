import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import {
  EMBEDDING_FAILURES_BEFORE_UNAVAILABLE,
  EMBEDDING_PROBE_TEXT,
  embeddingFixSentence,
  embeddingStatus,
  isDimensionMismatch,
  noteEmbeddingFailure,
  noteEmbeddingSuccess,
  probeEmbedding,
  resetEmbeddingStatus,
} from "../src/embedding.js";
import { ModelError, type Embedding } from "../src/model.js";

const VECTOR = Array.from({ length: 1024 }, () => 0);
const USAGE = { model: "mistral-embed", tokensIn: 2, tokensOut: 0 };

async function okEmbed(_text: string): Promise<Embedding> {
  return { vector: VECTOR, usage: USAGE };
}

async function mismatchEmbed(_text: string): Promise<Embedding> {
  throw new ModelError("The embedding model answered 256 dimensions; the schema holds 1024.", {
    dimensions: 256,
  });
}

async function downEmbed(_text: string): Promise<Embedding> {
  throw new ModelError("The embedding call failed", { cause: new Error("401 Unauthorized") });
}

beforeAll(() => {
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterAll(() => {
  vi.restoreAllMocks();
});

beforeEach(() => {
  resetEmbeddingStatus();
});

describe("isDimensionMismatch and the fix sentence", () => {
  it("recognises only the ModelError that carries the width answered", () => {
    expect(isDimensionMismatch(new ModelError("x", { dimensions: 256 }))).toBe(true);
    expect(isDimensionMismatch(new ModelError("The embedding call failed"))).toBe(false);
    expect(isDimensionMismatch(new Error("256 dimensions"))).toBe(false);
    expect(isDimensionMismatch(null)).toBe(false);
  });

  it("names the variable, the width answered and the width expected", () => {
    const sentence = embeddingFixSentence("nomic-embed-text", 768);
    expect(sentence).toContain("LLM_EMBEDDING_MODEL=nomic-embed-text");
    expect(sentence).toContain("768 dimensions");
    expect(sentence).toContain("1024");
    expect(sentence).toContain("mistral-embed");
    expect(embeddingFixSentence(null)).toMatch(/^LLM_EMBEDDING_MODEL answers another width/);
  });
});

describe("embedding state", () => {
  it("starts off, flips on a wrong width at once, and resets", () => {
    expect(embeddingStatus()).toBe("off");
    noteEmbeddingSuccess();
    expect(embeddingStatus()).toBe("ok");
    expect(noteEmbeddingFailure(new ModelError("x", { dimensions: 256 }))).toBe("mismatch");
    expect(embeddingStatus()).toBe("mismatch");
    noteEmbeddingSuccess();
    expect(embeddingStatus()).toBe("ok");
    resetEmbeddingStatus();
    expect(embeddingStatus()).toBe("off");
  });

  it("is unavailable when nothing has succeeded yet and a call fails", () => {
    expect(noteEmbeddingFailure(new Error("down"))).toBe("unavailable");
    expect(embeddingStatus()).toBe("unavailable");
    noteEmbeddingSuccess();
    expect(embeddingStatus()).toBe("ok");
  });

  it("keeps an ok state through transient failures, until several in a row", () => {
    expect(EMBEDDING_FAILURES_BEFORE_UNAVAILABLE).toBe(3);
    noteEmbeddingSuccess();
    expect(noteEmbeddingFailure(new Error("429"))).toBe("ok");
    expect(noteEmbeddingFailure(new Error("timeout"))).toBe("ok");
    noteEmbeddingSuccess();
    expect(noteEmbeddingFailure(new Error("429"))).toBe("ok");
    expect(noteEmbeddingFailure(new Error("429"))).toBe("ok");
    expect(noteEmbeddingFailure(new Error("429"))).toBe("unavailable");
    expect(embeddingStatus()).toBe("unavailable");
    expect(noteEmbeddingFailure(new Error("429"))).toBe("unavailable");
    noteEmbeddingSuccess();
    expect(embeddingStatus()).toBe("ok");
  });

  it("keeps a mismatch state through other failures: the fix is the variable, not a retry", () => {
    noteEmbeddingFailure(new ModelError("x", { dimensions: 256 }));
    for (let i = 0; i < EMBEDDING_FAILURES_BEFORE_UNAVAILABLE; i++) {
      noteEmbeddingFailure(new Error("down"));
    }
    expect(embeddingStatus()).toBe("mismatch");
  });

  it("probes once with the fixed text and never throws", async () => {
    const embed = vi.fn(okEmbed);
    expect(await probeEmbedding(embed, "mistral-embed")).toBe("ok");
    expect(embed).toHaveBeenCalledTimes(1);
    expect(embed).toHaveBeenCalledWith(EMBEDDING_PROBE_TEXT);
    expect(embeddingStatus()).toBe("ok");

    expect(await probeEmbedding(mismatchEmbed, "nomic-embed-text")).toBe("mismatch");
    expect(embeddingStatus()).toBe("mismatch");

    // The probe's answer is the state whatever was there before.
    expect(await probeEmbedding(downEmbed, "mistral-embed")).toBe("unavailable");
    expect(embeddingStatus()).toBe("unavailable");
    noteEmbeddingSuccess();
    expect(await probeEmbedding(downEmbed, "mistral-embed")).toBe("unavailable");
  });
});

describe("GET /health", () => {
  const closers: Array<() => Promise<void>> = [];
  afterEach(async () => {
    while (closers.length) await closers.pop()?.();
  });

  function health(env: NodeJS.ProcessEnv) {
    const app = buildApp(loadConfig({ PROCESSOR_SHARED_SECRET: "s".repeat(32), ...env }));
    closers.push(() => app.close());
    return app.inject({ method: "GET", url: "/health" });
  }

  it("shows the embedding state with a model, and off without one whatever the state", async () => {
    const before = await health({ LLM_API_KEY: "key" });
    expect(before.statusCode).toBe(200);
    expect((before.json() as { embedding: string }).embedding).toBe("off");

    await probeEmbedding(mismatchEmbed, "nomic-embed-text");
    const after = await health({ LLM_API_KEY: "key" });
    expect((after.json() as { embedding: string }).embedding).toBe("mismatch");

    noteEmbeddingSuccess();
    const ok = await health({ LLM_API_KEY: "key" });
    expect(ok.json()).toMatchObject({ model: true, embedding: "ok" });
    const noModel = await health({});
    expect(noModel.json()).toMatchObject({ model: false, embedding: "off" });
  });
});
