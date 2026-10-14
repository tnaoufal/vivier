import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { looksScanned, normaliseText, pageImageOf, pageImagesOf, readableChars } from "../src/pdf.js";

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

describe("pageImagesOf", () => {
  beforeAll(() => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  it("keeps unpdf's images whose shape it knows, as bytes", () => {
    const rgb = { data: new Uint8ClampedArray(2 * 3 * 3).fill(9), width: 2, height: 3, channels: 3, key: "img_p0_1" };
    const image = pageImageOf(rgb);
    expect(image).toMatchObject({ width: 2, height: 3, channels: 3, key: "img_p0_1" });
    expect(image?.data).toBeInstanceOf(Uint8Array);
    expect(image?.data.length).toBe(18);
    expect(pageImageOf({ ...rgb, key: undefined })?.key).toBe("");
    expect(pageImagesOf([rgb, rgb])).toHaveLength(2);
  });

  it("degrades to no image for another signature or a shape it cannot read", () => {
    // unpdf 0.12.0 and 0.12.1 answered bare pixel arrays (0.12.2 is the floor).
    expect(pageImagesOf([new Uint8ClampedArray(12)])).toEqual([]);
    expect(pageImagesOf(undefined)).toEqual([]);
    expect(pageImagesOf("nope")).toEqual([]);
    // A 1-bit mask packs its bits: fewer bytes than pixels.
    expect(pageImageOf({ data: new Uint8Array(2), width: 8, height: 2, channels: 1, key: "mask" })).toBeNull();
    expect(pageImageOf({ data: new Uint8Array(6), width: 2, height: 1, channels: 2, key: "two" })).toBeNull();
    expect(pageImageOf({ data: [1, 2, 3], width: 1, height: 1, channels: 3, key: "array" })).toBeNull();
    expect(pageImageOf({ data: new Uint8Array(3), width: 1.5, height: 1, channels: 3 })).toBeNull();
    expect(pageImageOf(null)).toBeNull();
  });
});
