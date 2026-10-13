/**
 * OCR for scanned PDFs through Mistral's OCR API (MISTRAL_OCR_API_KEY):
 * the whole PDF goes up as a data URL, the answer is one markdown block
 * per page. Capped at 20 MB and 90 s; the pipeline records the pages
 * processed as `ai_usage` of kind `ocr`. Without a key the pipeline never
 * calls this and marks scanned PDFs `needs_ocr` instead.
 */
import { z } from "zod";

import type { OcrConfig } from "./config.js";

export const OCR_MAX_BYTES = 20 * 1024 * 1024;
export const OCR_TIMEOUT_MS = 90_000;

export class OcrError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null = null, options?: ErrorOptions) {
    super(message, options);
    this.name = "OcrError";
    this.status = status;
  }
}

export interface OcrResult {
  text: string;
  pagesProcessed: number;
  model: string;
}

const AnswerSchema = z.object({
  pages: z
    .array(
      z.object({
        index: z.number().optional(),
        markdown: z.string().optional(),
      }),
    )
    .optional(),
  usage_info: z
    .object({
      pages_processed: z.number().optional(),
    })
    .optional(),
  model: z.string().optional(),
});

/** Drops the image references OCR markdown carries; the text stays as read. */
export function cleanOcrMarkdown(markdown: string): string {
  return markdown.replace(/!\[[^\]]*\]\([^)]*\)/g, "").trim();
}

export async function ocrPdf(
  buffer: Buffer,
  config: OcrConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<OcrResult> {
  if (buffer.byteLength > OCR_MAX_BYTES) {
    throw new OcrError(`The PDF exceeds the OCR cap of ${OCR_MAX_BYTES} bytes`);
  }
  const body = JSON.stringify({
    model: config.model,
    document: {
      type: "document_url",
      document_url: `data:application/pdf;base64,${buffer.toString("base64")}`,
    },
  });
  let response: Response;
  try {
    response = await fetchImpl(config.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body,
      signal: AbortSignal.timeout(OCR_TIMEOUT_MS),
    });
  } catch (error) {
    throw new OcrError("The OCR call failed", null, { cause: error });
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new OcrError(
      `The OCR API answered ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`,
      response.status,
    );
  }
  let json: unknown;
  try {
    json = await response.json();
  } catch (error) {
    throw new OcrError("The OCR API answered no JSON", response.status, { cause: error });
  }
  const parsed = AnswerSchema.safeParse(json);
  if (!parsed.success) {
    throw new OcrError("The OCR API answered an unexpected shape", response.status);
  }
  const pages = (parsed.data.pages ?? [])
    .map((page, position) => ({ index: page.index ?? position, markdown: page.markdown ?? "" }))
    .sort((a, b) => a.index - b.index);
  const text = pages
    .map((page) => cleanOcrMarkdown(page.markdown))
    .filter((page) => page.length > 0)
    .join("\n\n");
  return {
    text,
    pagesProcessed: parsed.data.usage_info?.pages_processed ?? pages.length,
    model: parsed.data.model ?? config.model,
  };
}
