/**
 * PDF text: the text layer through unpdf (pdf.js without a DOM), a test
 * for a scanned PDF (no layer, or next to nothing per page) and the
 * normalisation every text goes through before it is stored or read by
 * the model: collapsed whitespace, line breaks kept, control characters
 * out, a hard cap on length.
 */
import { extractText, getDocumentProxy } from "unpdf";

export interface PdfText {
  pageCount: number;
  text: string;
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
