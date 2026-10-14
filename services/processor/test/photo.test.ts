import { inflateSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import {
  PAGE_PIXELS_PER_POINT,
  PHOTO_MAX_SIDE_OUT,
  choosePhoto,
  downscale,
  isPhotoLike,
  photoFileOf,
  photoPathOf,
  sniffImageType,
  type RawImage,
} from "../src/photo.js";

/** An A4 page in the pixel unit the PDF images are compared with. */
const A4 = 595 * PAGE_PIXELS_PER_POINT;

function raw(width: number, height: number, channels: 1 | 3 | 4, samples: number[]): RawImage {
  return { width, height, channels, data: Uint8Array.from(samples) };
}

describe("isPhotoLike", () => {
  it("accepts a portrait or a square, rejects icons, banners, columns and page scans", () => {
    expect(isPhotoLike({ width: 300, height: 400 }, A4)).toBe(true);
    expect(isPhotoLike({ width: 400, height: 400 }, A4)).toBe(true);
    expect(isPhotoLike({ width: 120, height: 160 }, A4)).toBe(true);
    // An icon: too small.
    expect(isPhotoLike({ width: 32, height: 32 }, A4)).toBe(false);
    expect(isPhotoLike({ width: 80, height: 80 }, A4)).toBe(false);
    expect(isPhotoLike({ width: 81, height: 81 }, A4)).toBe(true);
    // A banner or a logo: wider than tall.
    expect(isPhotoLike({ width: 600, height: 120 }, A4)).toBe(false);
    expect(isPhotoLike({ width: 450, height: 400 }, A4)).toBe(false);
    // A decorative column: far taller than wide.
    expect(isPhotoLike({ width: 200, height: 842 }, A4)).toBe(false);
    // A scan of the page or a background: page-shaped, wider than half the page.
    expect(isPhotoLike({ width: 595, height: 842 }, A4)).toBe(false);
    expect(isPhotoLike({ width: 1240, height: 1754 }, A4)).toBe(false);
    expect(isPhotoLike({ width: 1300, height: 1300 }, A4)).toBe(false);
  });

  it("skips the half-page rule when the page width is unknown, and ignores nonsense", () => {
    expect(isPhotoLike({ width: 595, height: 842 }, null)).toBe(true);
    expect(isPhotoLike({ width: 595, height: 842 }, Number.NaN)).toBe(true);
    expect(isPhotoLike({ width: Number.NaN, height: 400 }, A4)).toBe(false);
    expect(isPhotoLike({ width: 300, height: 0 }, A4)).toBe(false);
  });
});

describe("choosePhoto", () => {
  it("takes the largest image that fits, the first on a tie, and null when none fits", () => {
    const icon = { width: 32, height: 32, key: "icon" };
    const small = { width: 160, height: 200, key: "small" };
    const large = { width: 300, height: 400, key: "large" };
    const sameArea = { width: 400, height: 300, key: "landscape" };
    const background = { width: 595, height: 842, key: "background" };
    expect(choosePhoto([icon, small, large, sameArea, background], A4)?.key).toBe("large");
    expect(choosePhoto([small, { width: 200, height: 160, key: "wide" }], A4)?.key).toBe("small");
    const twin = { width: 300, height: 400, key: "twin" };
    expect(choosePhoto([large, twin], A4)?.key).toBe("large");
    expect(choosePhoto([icon, background], A4)).toBeNull();
    expect(choosePhoto([], A4)).toBeNull();
  });
});

describe("downscale", () => {
  it("averages each block of source pixels, channel by channel", () => {
    // 4x4 RGB in four flat quadrants: red, green / blue, white.
    const samples: number[] = [];
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        const quadrant = (y < 2 ? 0 : 2) + (x < 2 ? 0 : 1);
        samples.push(...[[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 255]][quadrant] ?? []);
      }
    }
    const small = downscale(raw(4, 4, 3, samples), 2);
    expect([small.width, small.height, small.channels]).toEqual([2, 2, 3]);
    expect(Array.from(small.data)).toEqual([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255]);

    // A gradient block averages to its mean, rounded.
    const gradient = downscale(raw(2, 2, 1, [0, 10, 20, 31]), 1);
    expect(Array.from(gradient.data)).toEqual([15]);
  });

  it("keeps the aspect ratio, caps the longest side and never upscales", () => {
    const tall = downscale(raw(300, 400, 4, new Array(300 * 400 * 4).fill(7)), 256);
    expect([tall.width, tall.height]).toEqual([192, 256]);
    expect(tall.data.length).toBe(192 * 256 * 4);
    expect(tall.data.every((v) => v === 7)).toBe(true);
    const wide = downscale(raw(400, 100, 1, new Array(400 * 100).fill(3)), 256);
    expect([wide.width, wide.height]).toEqual([256, 64]);
    const small = raw(100, 120, 3, new Array(100 * 120 * 3).fill(1));
    expect(downscale(small, 256)).toBe(small);
    expect(PHOTO_MAX_SIDE_OUT).toBe(256);
  });
});

describe("photoFileOf, photoPathOf and sniffImageType", () => {
  it("answers a PNG of the downscaled image", () => {
    const file = photoFileOf(raw(512, 640, 3, new Array(512 * 640 * 3).fill(50)));
    expect(file.contentType).toBe("image/png");
    expect(sniffImageType(file.bytes)).toBe("image/png");
    const bytes = Buffer.from(file.bytes);
    expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)]).toEqual([205, 256]);
    // The IDAT (third chunk) inflates to 256 filtered rows of 205 RGB pixels.
    const idatLength = bytes.readUInt32BE(33);
    expect(bytes.subarray(37, 41).toString("latin1")).toBe("IDAT");
    expect(inflateSync(bytes.subarray(41, 41 + idatLength)).length).toBe((205 * 3 + 1) * 256);
  });

  it("names the object after the organisation, the candidate and the type", () => {
    expect(photoPathOf("org", "cand", "image/png")).toBe("org/cand.png");
    expect(photoPathOf("org", "cand", "image/jpeg")).toBe("org/cand.jpg");
  });

  it("tells a JPEG from a PNG by their first bytes and nothing else", () => {
    expect(sniffImageType(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffImageType(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe("image/png");
    expect(sniffImageType(Uint8Array.from([0x47, 0x49, 0x46, 0x38]))).toBeNull();
    expect(sniffImageType(new Uint8Array(0))).toBeNull();
  });
});
