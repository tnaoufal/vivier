import { describe, expect, it } from "vitest";

import { clamp, cn, ratioPercent } from "./utils";

describe("cn", () => {
  it("merges classes and lets the last tailwind class win", () => {
    expect(cn("p-4", "p-8")).toBe("p-8");
    expect(cn("text-ink", false, undefined, "font-medium")).toBe("text-ink font-medium");
  });
});

describe("clamp", () => {
  it("holds the value inside the range", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
    expect(clamp(Number.NaN, 0, 10)).toBe(0);
  });
});

describe("ratioPercent", () => {
  it("answers a whole number from 0 to 100", () => {
    expect(ratioPercent(1, 3)).toBe(33);
    expect(ratioPercent(2, 3)).toBe(67);
    expect(ratioPercent(3, 3)).toBe(100);
    expect(ratioPercent(0, 3)).toBe(0);
  });

  it("never overflows and never divides by nothing", () => {
    expect(ratioPercent(5, 3)).toBe(100);
    expect(ratioPercent(-5, 3)).toBe(0);
    expect(ratioPercent(1, 0)).toBe(0);
    expect(ratioPercent(1, -2)).toBe(0);
    expect(ratioPercent(Number.NaN, 4)).toBe(0);
    expect(ratioPercent(1, Number.POSITIVE_INFINITY)).toBe(0);
  });
});
