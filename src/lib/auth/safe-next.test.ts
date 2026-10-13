import { describe, expect, it } from "vitest";

import { safeNext } from "./safe-next";

describe("safeNext", () => {
  it("follows same-site paths only", () => {
    expect(safeNext("/app/briefs/1")).toBe("/app/briefs/1");
    expect(safeNext("//evil.example")).toBe("/app");
    expect(safeNext("https://evil.example")).toBe("/app");
    expect(safeNext(undefined)).toBe("/app");
  });
});
