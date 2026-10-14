/**
 * A PNG encoder small enough to own: 8-bit grey, RGB or RGBA, no
 * interlace, every scanline under filter 0, the samples deflated by
 * Node's zlib. That is all a 256-pixel portrait needs, and it keeps the
 * processor at zero new dependency (its lockfile is an owner's decision).
 * The CRC32 is the one PNG chunks carry (IEEE 802.3, reflected), table
 * driven; `crc32` is exported so the tests check it against the standard
 * vector. Decoding is not here: nothing in the service reads a PNG back.
 */
import { deflateSync } from "node:zlib";

/** Samples per pixel: 1 grey, 3 RGB, 4 RGBA. */
export type PngChannels = 1 | 3 | 4;

export interface PngImage {
  width: number;
  height: number;
  channels: PngChannels;
  /** Row-major samples, `width * height * channels` bytes, top row first. */
  data: Uint8Array;
}

export const PNG_SIGNATURE = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** PNG colour type per channel count (IHDR byte 9). */
const COLOUR_TYPES: Record<PngChannels, number> = { 1: 0, 3: 2, 4: 6 };

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** The CRC32 of `bytes`, continuing from `seed` when given (0 to start). */
export function crc32(bytes: Uint8Array, seed = 0): number {
  let c = (seed ^ 0xffffffff) >>> 0;
  for (const byte of bytes) c = (CRC_TABLE[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const typeBytes = Buffer.from(type, "latin1");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.byteLength, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(data, crc32(typeBytes)), 0);
  return Buffer.concat([length, typeBytes, data, crc]);
}

function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

/** The PNG file of `image`; a RangeError when the dimensions and the samples disagree. */
export function encodePng(image: PngImage): Buffer {
  const { width, height, channels, data } = image;
  if (!isPositiveInteger(width) || !isPositiveInteger(height)) {
    throw new RangeError(`PNG dimensions must be positive integers, got ${width}x${height}`);
  }
  if (!(channels in COLOUR_TYPES)) throw new RangeError(`PNG channels must be 1, 3 or 4, got ${channels}`);
  const rowBytes = width * channels;
  if (data.byteLength !== rowBytes * height) {
    throw new RangeError(`PNG samples: expected ${rowBytes * height} bytes, got ${data.byteLength}`);
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = COLOUR_TYPES[channels];
  header[10] = 0; // compression: deflate
  header[11] = 0; // filter method: adaptive, one byte per scanline
  header[12] = 0; // no interlace

  // Filter 0 ("none") on every scanline: the deflate does the work, and a
  // portrait of a few hundred pixels does not need the adaptive filters.
  const raw = Buffer.alloc((rowBytes + 1) * height);
  for (let y = 0; y < height; y++) {
    const offset = y * (rowBytes + 1);
    raw[offset] = 0;
    raw.set(data.subarray(y * rowBytes, (y + 1) * rowBytes), offset + 1);
  }

  return Buffer.concat([
    Buffer.from(PNG_SIGNATURE),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", new Uint8Array(0)),
  ]);
}
