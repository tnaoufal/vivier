/**
 * PDF text: the text layer through unpdf (pdf.js without a DOM), a test
 * for a scanned PDF (no layer, or next to nothing per page) and the
 * normalisation every text goes through before it is stored or read by
 * the model: collapsed whitespace, line breaks kept, control characters
 * out, a hard cap on length.
 *
 * Also the images of one page, for the candidate's photo (photo.ts):
 * read from the page's operator list and pdf.js's own object store
 * (`page.objs`) in the shape unpdf's `extractImages` answers (key,
 * width, height, channels, decoded pixels), but one image at a time: an
 * object pdf.js never settled (an image over `maxImageSize` it skipped,
 * the page background of many CVs) is left out instead of ending the
 * page, as `objs.get` would by throwing. The answer is checked at
 * runtime (pageImagesOf), so another pdf.js shape yields no image and
 * one log line, never a failed document. The width each image is drawn
 * at comes from the same operator list (cached by pdf.js), walked with
 * its transformation matrices.
 */
import { extractText, getDocumentProxy, getResolvedPDFJS } from "unpdf";

import { logWarn, type LogFields } from "./log.js";
import { PHOTO_MAX_SIDE, type ImagesOfPage, type RawImage } from "./photo.js";

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

/** True for an image whose bytes are laid out otherwise (a mask packs its bits): routine, no new signature. */
function isOtherLayout(value: unknown): boolean {
  const item = looseOf(value);
  return item !== null && isSize(item["width"]) && isSize(item["height"]) && ArrayBuffer.isView(item["data"]);
}

/**
 * The images unpdf answered that have the expected shape. An image in
 * another layout (a mask packs its bits) is routine and dropped quietly;
 * when nothing is even an image of another layout, that is an unpdf of
 * another signature, said in one log line with `context` (the document).
 */
export function pageImagesOf(answer: unknown, context: LogFields = {}): PageImage[] {
  if (!Array.isArray(answer)) {
    logWarn("photo_images_unsupported", { ...context, reason: "unpdf answered no array of images" });
    return [];
  }
  const images: PageImage[] = [];
  let unknown = 0;
  for (const item of answer) {
    const image = pageImageOf(item);
    if (image) images.push(image);
    else if (!isOtherLayout(item)) unknown += 1;
  }
  if (unknown > 0 && images.length === 0) {
    logWarn("photo_images_unsupported", { ...context, unknown, reason: "no image of the known shape" });
  }
  return images;
}

/** A PDF matrix [a, b, c, d, e, f], in pdf.js's order. */
type Matrix = readonly [number, number, number, number, number, number];

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

function matrixOf(value: unknown): Matrix | null {
  if (!Array.isArray(value) && !ArrayBuffer.isView(value)) return null;
  const items: unknown[] = Array.from(value as ArrayLike<unknown>);
  const numbers = items.filter((item): item is number => typeof item === "number" && Number.isFinite(item));
  if (items.length !== 6 || numbers.length !== 6) return null;
  const [a = 1, b = 0, c = 0, d = 1, e = 0, f = 0] = numbers;
  return [a, b, c, d, e, f];
}

/** `m` applied first, then `current`: what `cm m` leaves (pdf.js's Util.transform). */
function multiply(current: Matrix, m: Matrix): Matrix {
  const [a1, b1, c1, d1, e1, f1] = current;
  const [a2, b2, c2, d2, e2, f2] = m;
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ];
}

/** The pdf.js operators the walk follows; without all of them, nothing is measured. */
const WALKED_OPS = [
  "save",
  "restore",
  "transform",
  "paintFormXObjectBegin",
  "paintFormXObjectEnd",
  "beginAnnotation",
  "endAnnotation",
  "paintImageXObject",
];

/**
 * The width each image of an operator list is drawn at on the page, in
 * the page's unit (points), by pdf.js object key: the operators are
 * walked with the transformation matrix as a canvas would apply it
 * (`q`/`Q`, `cm`, a form's matrix, an annotation's), and an image covers
 * the unit square under that matrix, so its width on the page is
 * |a| + |c|. An image drawn twice keeps its widest. `ops` is pdf.js's
 * `OPS` table; anything unexpected yields fewer entries, never a guess.
 */
export function drawnWidthsOf(fnArray: unknown, argsArray: unknown, ops: unknown): Map<string, number> {
  const drawn = new Map<string, number>();
  const codes = looseOf(ops);
  if (!codes || !Array.isArray(fnArray) || !Array.isArray(argsArray)) return drawn;
  if (!WALKED_OPS.every((name) => typeof codes[name] === "number")) return drawn;
  const {
    save,
    restore,
    transform,
    paintFormXObjectBegin,
    paintFormXObjectEnd,
    beginAnnotation,
    endAnnotation,
    paintImageXObject,
  } = codes;
  const stack: Matrix[] = [];
  let ctm: Matrix = IDENTITY;
  for (let i = 0; i < fnArray.length; i++) {
    const fn: unknown = fnArray[i];
    const entry: unknown = argsArray[i];
    const args: unknown[] = Array.isArray(entry) ? entry : [];
    if (fn === save) {
      stack.push(ctm);
    } else if (fn === restore || fn === paintFormXObjectEnd || fn === endAnnotation) {
      ctm = stack.pop() ?? ctm;
    } else if (fn === transform) {
      const m = matrixOf(args);
      if (m) ctm = multiply(ctm, m);
    } else if (fn === paintFormXObjectBegin) {
      stack.push(ctm);
      const m = matrixOf(args[0]);
      if (m) ctm = multiply(ctm, m);
    } else if (fn === beginAnnotation) {
      // An annotation is drawn from the page's initial state, then its
      // rectangle's transform and its appearance's matrix.
      stack.push(ctm);
      ctm = IDENTITY;
      for (const value of [args[2], args[3]]) {
        const m = matrixOf(value);
        if (m) ctm = multiply(ctm, m);
      }
    } else if (fn === paintImageXObject) {
      const key = args[0];
      if (typeof key !== "string") continue;
      const width = Math.abs(ctm[0]) + Math.abs(ctm[2]);
      if (Number.isFinite(width)) drawn.set(key, Math.max(drawn.get(key) ?? 0, width));
    }
  }
  return drawn;
}

/** pdf.js's `page.objs`: `has` says whether an object is settled (decoded, or skipped), `get` answers a settled one and throws on the rest. */
interface PageObjectsLike {
  has?: (key: string) => boolean;
  get?: (key: string) => unknown;
}

/** The pdf.js page calls the geometry and the images need, as methods so `this` stays bound. */
interface PageProxyLike {
  view?: unknown;
  getOperatorList?: () => Promise<unknown>;
  objs?: PageObjectsLike;
}

/** pdf.js's ImageKind by value: 1 GRAYSCALE_1BPP (its bits packed), 2 RGB_24BPP, 3 RGBA_32BPP. */
const CHANNELS_OF_KIND: Readonly<Record<number, 1 | 3 | 4>> = { 1: 1, 2: 3, 3: 4 };

/**
 * The images an operator list paints (`paintImageXObject`), as pdf.js
 * decoded them, in unpdf's shape (key, width, height, channels, data),
 * each key once in the order drawn. An object the store never settled
 * (an image over maxImageSize pdf.js skipped, or one still decoding) is
 * left out instead of ending the page (`objs.get` throws on it); so is
 * one that is not pixels of a known kind (a bitmap). A 1-bit mask keeps
 * its packed bits and is dropped by pageImageOf as another layout.
 */
export function decodedImagesOf(
  fnArray: unknown,
  argsArray: unknown,
  ops: unknown,
  objs: unknown,
): unknown[] {
  const codes = looseOf(ops);
  const store = looseOf(objs) as PageObjectsLike | null;
  const paint = codes?.["paintImageXObject"];
  if (typeof paint !== "number" || !Array.isArray(fnArray) || !Array.isArray(argsArray)) return [];
  if (!store || typeof store.has !== "function" || typeof store.get !== "function") return [];
  const seen = new Set<string>();
  const images: unknown[] = [];
  for (let i = 0; i < fnArray.length; i++) {
    if (fnArray[i] !== paint) continue;
    const entry: unknown = argsArray[i];
    const key = Array.isArray(entry) ? entry[0] : undefined;
    if (typeof key !== "string" || seen.has(key)) continue;
    seen.add(key);
    let image: unknown;
    try {
      if (!store.has(key)) continue;
      image = store.get(key);
    } catch {
      continue;
    }
    const decoded = looseOf(image);
    if (!decoded) continue;
    const kind = decoded["kind"];
    const channels = typeof kind === "number" ? CHANNELS_OF_KIND[kind] : undefined;
    if (channels === undefined) continue;
    images.push({
      key,
      width: decoded["width"],
      height: decoded["height"],
      channels,
      data: decoded["data"],
    });
  }
  return images;
}

interface DocumentProxyLike {
  getPage?: (pageNumber: number) => Promise<PageProxyLike>;
}

interface PageGeometry {
  /** The page's width in points (user space, as the matrices are), or null. */
  pageWidth: number | null;
  /** The width each image is drawn at, in points, by pdf.js object key. */
  drawn: Map<string, number>;
}

/**
 * The page's width and the width its images are drawn at, both in user
 * space; what the proxy cannot say stays unknown and the half-page rule
 * is then skipped, never guessed.
 */
async function pageGeometryOf(pdf: unknown, pageNumber: number): Promise<PageGeometry> {
  const geometry: PageGeometry = { pageWidth: null, drawn: new Map() };
  try {
    const proxy = pdf as DocumentProxyLike;
    if (typeof proxy.getPage !== "function") return geometry;
    const page = await proxy.getPage(pageNumber);
    const view = Array.isArray(page.view) ? page.view : [];
    const [x0, , x1] = view;
    if (typeof x0 !== "number" || typeof x1 !== "number" || !Number.isFinite(x1 - x0) || x1 === x0) {
      return geometry;
    }
    geometry.pageWidth = Math.abs(x1 - x0);
    if (typeof page.getOperatorList !== "function") return geometry;
    const list = looseOf(await page.getOperatorList());
    const pdfjs: unknown = await getResolvedPDFJS();
    geometry.drawn = drawnWidthsOf(list?.["fnArray"], list?.["argsArray"], looseOf(pdfjs)?.["OPS"]);
    return geometry;
  } catch {
    return geometry;
  }
}

/** The images drawn on the page as pdf.js decoded them (decodedImagesOf); none when the proxy cannot say. */
async function pageDecodedImagesOf(pdf: unknown, pageNumber: number): Promise<unknown[]> {
  const proxy = pdf as DocumentProxyLike;
  if (typeof proxy.getPage !== "function") return [];
  const page = await proxy.getPage(pageNumber);
  if (typeof page.getOperatorList !== "function") return [];
  const list = looseOf(await page.getOperatorList());
  const pdfjs: unknown = await getResolvedPDFJS();
  return decodedImagesOf(list?.["fnArray"], list?.["argsArray"], looseOf(pdfjs)?.["OPS"], page.objs);
}

/**
 * The images of page `pageNumber` (1-based) with the page's width and the
 * width each is drawn at, for the photo. `context` names the document in
 * the log. The caller treats a thrown error as "no photo" (pipeline.ts).
 */
export async function extractPageImages(
  buffer: Uint8Array,
  pageNumber = 1,
  context: LogFields = {},
): Promise<PageImages> {
  // pdf.js skips (with a warning) any image whose width * height exceeds
  // this, before decoding it: exactly the images isPhotoLike rejects (a
  // side over PHOTO_MAX_SIDE), so a page background or a 12 MP photo
  // costs neither the memory nor the time of its pixels.
  const pdf = await getDocumentProxy(new Uint8Array(buffer), { maxImageSize: PHOTO_MAX_SIDE * PHOTO_MAX_SIDE });
  try {
    const { pageWidth, drawn } = await pageGeometryOf(pdf, pageNumber);
    // Typed as unknown on purpose: the shape is checked, not trusted,
    // whatever this pdf.js answers.
    const answer: unknown = await pageDecodedImagesOf(pdf, pageNumber);
    const images = pageImagesOf(answer, context).map((image) => {
      const drawnWidth = drawn.get(image.key);
      return drawnWidth === undefined ? image : { ...image, drawnWidth };
    });
    return { pageWidth, images };
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
