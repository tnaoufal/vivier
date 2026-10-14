/**
 * PDF text: the text layer through unpdf (pdf.js without a DOM), a test
 * for a scanned PDF (no layer, or next to nothing per page) and the
 * normalisation every text goes through before it is stored or read by
 * the model: collapsed whitespace, line breaks kept, control characters
 * out, a hard cap on length.
 *
 * Also the images of one page, for the candidate's photo (photo.ts):
 * unpdf's `extractImages(pdf, pageNumber)` takes the document proxy in
 * every 0.12.x and answers, since 0.12.2 (the floor in package.json),
 * objects of decoded pixels with their width, height and channel count;
 * 0.12.0 and 0.12.1 answered bare pixel arrays. The answer is checked at
 * runtime, so an unpdf of another signature yields no image and one log
 * line, never a failed document.
 */
import { extractImages, extractText, getDocumentProxy } from "unpdf";

import { logWarn } from "./log.js";
import { PAGE_PIXELS_PER_POINT, type ImagesOfPage, type RawImage } from "./photo.js";

export interface PdfText {
  pageCount: number;
  text: string;
}

/** One image drawn on a page, as pdf.js decoded it. */
export interface PageImage extends RawImage {
  /** pdf.js's object key, for the log. */
  key: string;
}

export type PageImages = ImagesOfPage<PageImage>;

/** Something pdf.js may answer and the proxy may offer; checked field by field. */
type Loose = Record<string, unknown>;

function looseOf(value: unknown): Loose | null {
  return value !== null && typeof value === "object" ? (value as Loose) : null;
}

function isChannels(value: unknown): value is 1 | 3 | 4 {
  return value === 1 || value === 3 || value === 4;
}

function isSize(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

/**
 * One of unpdf's images as a RawImage, or null when the shape is another
 * (unpdf before 0.12.2 answered bare pixel arrays; a 1-bit mask packs its
 * bits and has fewer bytes than pixels).
 */
export function pageImageOf(value: unknown): PageImage | null {
  const item = looseOf(value);
  if (!item) return null;
  const { width, height, channels, data, key } = item;
  if (!isSize(width) || !isSize(height) || !isChannels(channels)) return null;
  if (!ArrayBuffer.isView(data) || data.byteLength !== width * height * channels) return null;
  return {
    key: typeof key === "string" ? key : "",
    width,
    height,
    channels,
    data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
  };
}

/** The images unpdf answered that have the expected shape; the others are counted in one log line. */
export function pageImagesOf(answer: unknown): PageImage[] {
  if (!Array.isArray(answer)) {
    logWarn("photo_images_unsupported", { reason: "unpdf answered no array of images" });
    return [];
  }
  const images: PageImage[] = [];
  let dropped = 0;
  for (const item of answer) {
    const image = pageImageOf(item);
    if (image) images.push(image);
    else dropped += 1;
  }
  // A mask among photos is normal; nothing readable at all is not: that
  // is an unpdf of another signature, said once per document.
  if (dropped > 0 && images.length === 0) {
    logWarn("photo_images_unsupported", { dropped, reason: "no image of the known shape" });
  }
  return images;
}

/** The two pdf.js calls the page width needs, as methods so `this` stays bound. */
interface DocumentProxyLike {
  getPage?: (pageNumber: number) => Promise<{ getViewport?: (options: { scale: number }) => unknown }>;
}

/**
 * The page's width in the images' pixel unit (PAGE_PIXELS_PER_POINT per
 * point), or null when the proxy cannot say: the half-page rule is then
 * skipped, never guessed.
 */
async function pageWidthOf(pdf: unknown, pageNumber: number): Promise<number | null> {
  try {
    const proxy = pdf as DocumentProxyLike;
    if (typeof proxy.getPage !== "function") return null;
    const page = await proxy.getPage(pageNumber);
    if (typeof page.getViewport !== "function") return null;
    const width = looseOf(page.getViewport({ scale: 1 }))?.["width"];
    return typeof width === "number" && Number.isFinite(width) && width > 0
      ? width * PAGE_PIXELS_PER_POINT
      : null;
  } catch {
    return null;
  }
}

/**
 * The images of page `pageNumber` (1-based) with the page's width, for
 * the photo. The caller treats a thrown error as "no photo" (pipeline.ts).
 */
export async function extractPageImages(buffer: Uint8Array, pageNumber = 1): Promise<PageImages> {
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  try {
    const pageWidth = await pageWidthOf(pdf, pageNumber);
    // Typed as unknown on purpose: the shape is checked, not trusted,
    // whatever this unpdf's signature says.
    const answer: unknown = await extractImages(pdf, pageNumber);
    return { pageWidth, images: pageImagesOf(answer) };
  } finally {
    const proxy = pdf as unknown as { destroy?: () => Promise<void> };
    if (typeof proxy.destroy === "function") {
      await proxy.destroy().catch(() => undefined);
    }
  }
}

/** Below this many readable characters per page (or in total) the PDF counts as scanned. */
export const MIN_CHARS_PER_PAGE = 150;

export const DEFAULT_MAX_TEXT_CHARS = 200_000;

export async function extractPdfText(buffer: Uint8Array): Promise<PdfText> {
  // A copy: pdf.js may transfer or detach the bytes it is given, and a
  // Node Buffer can share a pool with other buffers.
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  try {
    const result = await extractText(pdf, { mergePages: true });
    const text = Array.isArray(result.text) ? result.text.join("\n\n") : result.text;
    return { pageCount: Math.max(0, Math.floor(result.totalPages)), text: String(text ?? "") };
  } finally {
    const proxy = pdf as unknown as { destroy?: () => Promise<void> };
    if (typeof proxy.destroy === "function") {
      await proxy.destroy().catch(() => undefined);
    }
  }
}

/** Characters that are not whitespace. */
export function readableChars(text: string): number {
  return text.replace(/\s+/g, "").length;
}

/**
 * True when the text layer is too thin to be a CV: fewer than
 * MIN_CHARS_PER_PAGE readable characters on average per page, or fewer
 * than that in total.
 */
export function looksScanned(text: string, pageCount: number): boolean {
  const chars = readableChars(text);
  if (chars < MIN_CHARS_PER_PAGE) return true;
  const pages = Math.max(1, Math.floor(pageCount));
  return chars / pages < MIN_CHARS_PER_PAGE;
}

/**
 * Collapses runs of spaces, trims every line, keeps line breaks (at most
 * one blank line in a row), strips control characters and caps the length.
 */
export function normaliseText(text: string, maxChars: number = DEFAULT_MAX_TEXT_CHARS): string {
  const lines = text
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F﻿]/g, "")
    .replace(/ /g, " ")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim());
  return lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, Math.max(0, Math.floor(maxChars)));
}
