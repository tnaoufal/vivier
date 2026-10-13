import { describe, expect, it } from "vitest";

import { extractJson, vectorLiteral } from "../src/model.js";

describe("extractJson", () => {
  it("finds the first balanced object, with or without a code fence", () => {
    expect(extractJson('Sure: {"a": 1, "b": {"c": "}"}} trailing')).toBe('{"a": 1, "b": {"c": "}"}}');
    expect(extractJson('```json\n{"a": [1, 2]}\n```')).toBe('{"a": [1, 2]}');
    expect(extractJson("[1, 2, 3]")).toBe("[1, 2, 3]");
  });

  it("answers null when nothing balances", () => {
    expect(extractJson("no json here")).toBeNull();
    expect(extractJson('{"a": 1')).toBeNull();
  });
});

describe("vectorLiteral", () => {
  it("writes a pgvector literal with six decimals and zero for a non-finite value", () => {
    expect(vectorLiteral([0.1, -2, Number.NaN])).toBe("[0.100000,-2.000000,0]");
  });
});
