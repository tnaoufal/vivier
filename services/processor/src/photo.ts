/**
 * The candidate's photo: which image of the CV's first page is a
 * portrait, and how it becomes the small file the interface shows next
 * to the name. Pure: the pixels come from pdf.ts (a PDF with a text
 * layer) or the bytes from ocr.ts (a scanned PDF), the file goes to the
 * private `photos` bucket through db.ts, and nothing here ever reaches a
 * model: the photo identifies a person on a screen, it is read for
 * nothing else, and no prompt carries it (AGENTS.md: the photo is never
 * extracted, scored or inferred from).
 *
 * The rules are plain and tested: a portrait-shaped image (both sides
 * between PHOTO_MIN_SIDE and PHOTO_MAX_SIDE, width/height between
 * PHOTO_MIN_RATIO and PHOTO_MAX_RATIO, an area above PHOTO_MIN_AREA, not
 * drawn wider than half the page), so an icon, a logo, a banner, a
 * decorative column or a scan of the whole page is never taken for a
 * face; the largest when several fit. A chosen pixel image is downscaled
 * with a box filter to PHOTO_MAX_SIDE_OUT pixels on its longest side and
 * encoded as a PNG (png.ts); an image the OCR already encoded (JPEG or
 * PNG) is kept as it is.
 */
import { encodePng, type PngChannels } from "./png.js";

/**
 * What the choice reads: the image's own width and height (its pixels; for
 * an image the OCR cut out, its box on the page) and the width the page
 * draws it at, in the page's unit (absent when unknown: the half-page rule
 * is then skipped, never guessed).
 */
export interface ImageGeometry {
  width: number;
  height: number;
  drawnWidth?: number;
}

/** The images found on one page, with the page's width in the unit of their drawn width (null when unknown). */
export interface ImagesOfPage<T extends ImageGeometry> {
  pageWidth: number | null;
  images: T[];
}

/** A decoded image: `width * height * channels` samples, row-major. */
export interface RawImage extends ImageGeometry {
  channels: PngChannels;
  data: Uint8Array;
}

export type PhotoContentType = "image/png" | "image/jpeg";

/** The file written to the `photos` bucket. */
export interface PhotoFile {
  bytes: Uint8Array;
  contentType: PhotoContentType;
}

/** Shortest side of a portrait, in pixels; below it, an icon. */
export const PHOTO_MIN_SIDE = 80;
/** Longest side of a portrait; above it, a page scan or a background. */
export const PHOTO_MAX_SIDE = 1200;
/** width / height of a portrait: taller than wide, or square, never a banner. */
export const PHOTO_MIN_RATIO = 0.6;
export const PHOTO_MAX_RATIO = 1.1;
/** An image must cover more than this many pixels (80 x 80). */
export const PHOTO_MIN_AREA = 80 * 80;
/** The longest side of the file written, in pixels. */
export const PHOTO_MAX_SIDE_OUT = 256;
/** The `photos` bucket refuses a larger file (its file_size_limit). */
export const PHOTO_MAX_BYTES = 2 * 1024 * 1024;

/** True when `image` has the shape of a portrait on a page `pageWidth` wide (the unit of its drawn width). */
export function isPhotoLike(image: ImageGeometry, pageWidth: number | null): boolean {
  const { width, height, drawnWidth } = image;
  if (!Number.isFinite(width) || !Number.isFinite(height)) return false;
  if (width < PHOTO_MIN_SIDE || height < PHOTO_MIN_SIDE) return false;
  if (width > PHOTO_MAX_SIDE || height > PHOTO_MAX_SIDE) return false;
  const ratio = width / height;
  if (ratio < PHOTO_MIN_RATIO || ratio > PHOTO_MAX_RATIO) return false;
  if (width * height <= PHOTO_MIN_AREA) return false;
  // A scan of the page or a background is drawn across it, whatever its
  // resolution; a portrait kept at a high resolution is drawn small.
  if (
    drawnWidth !== undefined &&
    Number.isFinite(drawnWidth) &&
    pageWidth !== null &&
    Number.isFinite(pageWidth) &&
    drawnWidth > pageWidth / 2
  ) {
    return false;
  }
  return true;
}

/** The largest image that looks like a portrait, or null; the first one wins a tie. */
export function choosePhoto<T extends ImageGeometry>(images: T[], pageWidth: number | null): T | null {
  let best: T | null = null;
  for (const image of images) {
    if (!isPhotoLike(image, pageWidth)) continue;
    if (best === null || image.width * image.height > best.width * best.height) best = image;
  }
  return best;
}

/**
 * The image with its longest side at `maxSide` pixels at most, by a box
 * filter: every output pixel is the mean of the block of source pixels
 * it covers (channel by channel, alpha included). An image already small
 * enough is answered as it is; nothing is ever upscaled.
 */
export function downscale(image: RawImage, maxSide: number = PHOTO_MAX_SIDE_OUT): RawImage {
  const { width, height, channels, data } = image;
  const longest = Math.max(width, height);
  if (longest <= maxSide) return image;
  const outWidth = Math.max(1, Math.round((width * maxSide) / longest));
  const outHeight = Math.max(1, Math.round((height * maxSide) / longest));
  const out = new Uint8Array(outWidth * outHeight * channels);
  const sums = new Float64Array(channels);
  for (let y = 0; y < outHeight; y++) {
    const y0 = Math.floor((y * height) / outHeight);
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * height) / outHeight));
    for (let x = 0; x < outWidth; x++) {
      const x0 = Math.floor((x * width) / outWidth);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * width) / outWidth));
      sums.fill(0);
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const offset = (sy * width + sx) * channels;
          for (let c = 0; c < channels; c++) sums[c] = (sums[c] ?? 0) + (data[offset + c] ?? 0);
        }
      }
      const count = (y1 - y0) * (x1 - x0);
      const target = (y * outWidth + x) * channels;
      for (let c = 0; c < channels; c++) out[target + c] = Math.round((sums[c] ?? 0) / count);
    }
  }
  return { width: outWidth, height: outHeight, channels, data: out };
}

/** The PNG file of a decoded image, downscaled first. */
export function photoFileOf(image: RawImage): PhotoFile {
  const small = downscale(image);
  return { bytes: encodePng(small), contentType: "image/png" };
}

/** The object key of a candidate's photo in the `photos` bucket. */
export function photoPathOf(orgId: string, candidateId: string, contentType: PhotoContentType): string {
  return `${orgId}/${candidateId}.${contentType === "image/jpeg" ? "jpg" : "png"}`;
}

/** The image type the first bytes announce, among the two the bucket accepts. */
export function sniffImageType(bytes: Uint8Array): PhotoContentType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  return null;
}
