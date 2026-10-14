import { inflateSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import { PNG_SIGNATURE, crc32, encodePng, type PngImage } from "../src/png.js";

interface Chunk {
  type: string;
  data: Buffer;
  crc: number;
}

/** The chunks of a PNG file after its signature, as any decoder reads them. */
function chunksOf(file: Buffer): Chunk[] {
  expect(Array.from(file.subarray(0, 8))).toEqual(Array.from(PNG_SIGNATURE));
  const chunks: Chunk[] = [];
  let offset = 8;
  while (offset < file.length) {
    const length = file.readUInt32BE(offset);
    const type = file.subarray(offset + 4, offset + 8).toString("latin1");
    const data = file.subarray(offset + 8, offset + 8 + length);
    const crc = file.readUInt32BE(offset + 8 + length);
    chunks.push({ type, data, crc });
    offset += 12 + length;
  }
  return chunks;
}

/** IHDR, IDAT inflated back to filtered scanlines, IEND: what a decoder sees. */
function decode(file: Buffer): { width: number; height: number; bitDepth: number; colourType: number; rows: number[][] } {
  const chunks = chunksOf(file);
  expect(chunks.map((c) => c.type)).toEqual(["IHDR", "IDAT", "IEND"]);
  for (const chunk of chunks) {
    expect(chunk.crc).toBe(crc32(Buffer.concat([Buffer.from(chunk.type, "latin1"), chunk.data])));
  }
  const header = chunks[0]?.data ?? Buffer.alloc(0);
  const width = header.readUInt32BE(0);
  const height = header.readUInt32BE(4);
  const bitDepth = header[8] ?? -1;
  const colourType = header[9] ?? -1;
  expect([header[10], header[11], header[12]]).toEqual([0, 0, 0]);
  const channels = colourType === 0 ? 1 : colourType === 2 ? 3 : 4;
  const raw = inflateSync(chunks[1]?.data ?? Buffer.alloc(0));
  const stride = width * channels + 1;
  expect(raw.length).toBe(stride * height);
  const rows: number[][] = [];
  for (let y = 0; y < height; y++) {
    expect(raw[y * stride]).toBe(0);
    rows.push(Array.from(raw.subarray(y * stride + 1, (y + 1) * stride)));
  }
  return { width, height, bitDepth, colourType, rows };
}

describe("crc32", () => {
  it("matches the standard check value and chains through a seed", () => {
    const bytes = Buffer.from("123456789", "latin1");
    expect(crc32(bytes)).toBe(0xcbf43926);
    expect(crc32(new Uint8Array(0))).toBe(0);
    expect(crc32(bytes.subarray(4), crc32(bytes.subarray(0, 4)))).toBe(0xcbf43926);
  });
});

describe("encodePng", () => {
  it("round-trips a 2x2 RGB image through IHDR and an inflated IDAT", () => {
    const image: PngImage = {
      width: 2,
      height: 2,
      channels: 3,
      data: Uint8Array.from([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255]),
    };
    const decoded = decode(encodePng(image));
    expect(decoded).toMatchObject({ width: 2, height: 2, bitDepth: 8, colourType: 2 });
    expect(decoded.rows).toEqual([
      [255, 0, 0, 0, 255, 0],
      [0, 0, 255, 255, 255, 255],
    ]);
  });

  it("writes RGBA as colour type 6 and grey as colour type 0", () => {
    const rgba = decode(
      encodePng({ width: 2, height: 1, channels: 4, data: Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]) }),
    );
    expect(rgba).toMatchObject({ width: 2, height: 1, colourType: 6, rows: [[1, 2, 3, 4, 5, 6, 7, 8]] });
    const grey = decode(encodePng({ width: 1, height: 2, channels: 1, data: Uint8Array.from([9, 10]) }));
    expect(grey).toMatchObject({ width: 1, height: 2, colourType: 0, rows: [[9], [10]] });
  });

  it("refuses dimensions that disagree with the samples", () => {
    expect(() => encodePng({ width: 2, height: 2, channels: 3, data: new Uint8Array(11) })).toThrow(RangeError);
    expect(() => encodePng({ width: 0, height: 1, channels: 3, data: new Uint8Array(0) })).toThrow(RangeError);
    expect(() => encodePng({ width: 1.5, height: 1, channels: 1, data: new Uint8Array(1) })).toThrow(RangeError);
  });
});
