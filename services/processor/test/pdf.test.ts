import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  drawnWidthsOf,
  looksScanned,
  normaliseText,
  pageImageOf,
  pageImagesOf,
  readableChars,
} from "../src/pdf.js";

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

  it("warns, naming the document, only when nothing answered is an image of any layout", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    warn.mockClear();
    // A page whose only images are masks is routine: no line.
    const mask = { data: new Uint8Array(2), width: 8, height: 2, channels: 1, key: "mask" };
    expect(pageImagesOf([mask, mask], { documentId: "doc-1" })).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
    // Bare pixel arrays are an unpdf of another signature: one line.
    expect(pageImagesOf([new Uint8ClampedArray(12)], { documentId: "doc-1" })).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[1])).toContain('"documentId":"doc-1"');
    // A size without bytes is no layout this processor knows either.
    expect(pageImagesOf([{ width: 8, height: 2, channels: 1 }])).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(2);
  });
});

describe("drawnWidthsOf", () => {
  /** pdf.js's codes for the operators the walk follows (any distinct numbers do). */
  const OPS = {
    save: 10,
    restore: 11,
    transform: 12,
    paintFormXObjectBegin: 74,
    paintFormXObjectEnd: 75,
    beginAnnotation: 80,
    endAnnotation: 81,
    paintImageXObject: 85,
  };

  function walk(...ops: Array<[number, unknown[]]>): Map<string, number> {
    return drawnWidthsOf(
      ops.map(([fn]) => fn),
      ops.map(([, args]) => args),
      OPS,
    );
  }

  it("measures each image's width on the page through the matrices that draw it", () => {
    const drawn = walk(
      // A page flipped upside down at the top level, as browsers print.
      [OPS.transform, [1, 0, 0, -1, 0, 842]],
      [OPS.save, []],
      [OPS.transform, [100, 0, 0, -133, 40, 120]],
      [OPS.paintImageXObject, ["img_p0_1", 600, 800]],
      [OPS.restore, []],
      // Inside a form scaled by half.
      [OPS.paintFormXObjectBegin, [[0.5, 0, 0, 0.5, 0, 0], [0, 0, 595, 842]]],
      [OPS.save, []],
      [OPS.transform, [400, 0, 0, 566, 0, 0]],
      [OPS.paintImageXObject, ["img_p0_2", 400, 566]],
      [OPS.restore, []],
      [OPS.paintFormXObjectEnd, []],
      // Back at the page: a background drawn across it.
      [OPS.save, []],
      [OPS.transform, [595, 0, 0, 842, 0, 0]],
      [OPS.paintImageXObject, ["img_p0_3", 400, 566]],
      [OPS.restore, []],
      // Turned a quarter: its width on the page is its drawn height.
      [OPS.save, []],
      [OPS.transform, [0, 150, -120, 0, 300, 300]],
      [OPS.paintImageXObject, ["img_p0_4", 300, 400]],
      [OPS.restore, []],
    );
    expect(Object.fromEntries(drawn)).toEqual({ img_p0_1: 100, img_p0_2: 200, img_p0_3: 595, img_p0_4: 120 });
  });

  it("keeps an image's widest drawing and starts an annotation from the page's own state", () => {
    const drawn = walk(
      [OPS.transform, [3, 0, 0, 3, 0, 0]],
      [OPS.save, []],
      [OPS.transform, [20, 0, 0, 20, 0, 0]],
      [OPS.paintImageXObject, ["img_p0_1"]],
      [OPS.restore, []],
      [OPS.save, []],
      [OPS.transform, [10, 0, 0, 10, 0, 0]],
      [OPS.paintImageXObject, ["img_p0_1"]],
      [OPS.restore, []],
      [OPS.beginAnnotation, ["annot", [0, 0, 100, 100], [1, 0, 0, 1, 10, 10], [2, 0, 0, 2, 0, 0], false]],
      [OPS.transform, [50, 0, 0, 50, 0, 0]],
      [OPS.paintImageXObject, ["img_p0_2"]],
      [OPS.endAnnotation, []],
      // An unbalanced restore leaves the matrix as it is.
      [OPS.restore, []],
      [OPS.restore, []],
      [OPS.paintImageXObject, ["img_p0_3"]],
    );
    expect(Object.fromEntries(drawn)).toEqual({ img_p0_1: 60, img_p0_2: 100, img_p0_3: 3 });
  });

  it("measures nothing it cannot read", () => {
    expect(drawnWidthsOf([OPS.paintImageXObject], [["img"]], { ...OPS, beginAnnotation: undefined }).size).toBe(0);
    expect(drawnWidthsOf(undefined, [], OPS).size).toBe(0);
    expect(drawnWidthsOf([OPS.paintImageXObject], [["img"]], null).size).toBe(0);
    // A matrix that is not six numbers is skipped; an image without a key is not measured.
    const drawn = walk(
      [OPS.transform, [2, 0, 0]],
      [OPS.paintImageXObject, ["img"]],
      [OPS.paintImageXObject, [7]],
    );
    expect(Object.fromEntries(drawn)).toEqual({ img: 1 });
  });
});
