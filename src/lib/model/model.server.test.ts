import { describe, expect, it } from "vitest";

import { extractJson, modelConfig, vectorLiteral } from "./model.server";
import { settings } from "@/lib/server/settings.server";

describe("extractJson", () => {
  it("finds the object inside prose and fences", () => {
    expect(extractJson('Sure! ```json\n{"a": 1}\n```')).toBe('{"a": 1}');
    expect(extractJson('Here: {"a": "}", "b": [1, {"c": 2}]} done')).toBe('{"a": "}", "b": [1, {"c": 2}]}');
    expect(extractJson("nothing")).toBeNull();
  });
});

describe("modelConfig", () => {
  it("is null without a key and defaults to Mistral's models on its API", () => {
    expect(modelConfig(settings({}))).toBeNull();
    const config = modelConfig(settings({ LLM_API_KEY: "k", LLM_BASE_URL: "https://api.mistral.ai/v1/" }));
    expect(config?.model).toBe("mistral-small-latest");
    expect(config?.embeddingModel).toBe("mistral-embed");
    expect(config?.baseUrl).toBe("https://api.mistral.ai/v1");
  });
});

describe("vectorLiteral", () => {
  it("writes pgvector's bracket form", () => {
    expect(vectorLiteral([0.5, -1, Number.NaN])).toBe("[0.500000,-1.000000,0]");
  });
});
