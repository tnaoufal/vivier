import { describe, expect, it } from "vitest";

import { looksScanned, normaliseText, readableChars } from "../src/pdf.js";

describe("looksScanned", () => {
  it("is true for an empty or near-empty text layer", () => {
    expect(looksScanned("", 1)).toBe(true);
    expect(looksScanned("   \n\n  ", 3)).toBe(true);
    expect(looksScanned("a".repeat(149), 1)).toBe(true);
  });

  it("is false when every page averages at least 150 readable characters", () => {
    expect(looksScanned("a".repeat(400), 1)).toBe(false);
    expect(looksScanned("a".repeat(300), 2)).toBe(false);
    expect(looksScanned("a".repeat(400), 0)).toBe(false);
  });

  it("is true when the text is thin across many pages", () => {
    expect(looksScanned("a".repeat(400), 5)).toBe(true);
  });
});

describe("normaliseText", () => {
  it("collapses spaces, trims lines, keeps line breaks and strips control characters", () => {
    const text = "  Marie   Dupont \r\nContrôleuse\tde gestion\u0000\u0007\n\n\n\nParis France\n";
    expect(normaliseText(text)).toBe("Marie Dupont\nContrôleuse de gestion\n\nParis France");
  });

  it("caps the length", () => {
    expect(normaliseText("a".repeat(500), 100)).toHaveLength(100);
    expect(normaliseText("abc", 0)).toBe("");
  });

  it("counts readable characters without whitespace", () => {
    expect(readableChars(" a b\nc ")).toBe(3);
  });
});
