/**
 * OCR for scanned PDFs through Mistral's OCR API (MISTRAL_OCR_API_KEY):
 * the whole PDF goes up as a data URL, the answer is one markdown block
 * per page. Capped at 20 MB and 90 s; the pipeline records the pages
 * processed as `ai_usage` of kind `ocr`. Without a key the pipeline never
 * calls this and marks scanned PDFs `needs_ocr` instead.
 *
 * The call asks for the images the OCR found (`include_image_base64`)
 * and keeps those of the first page, decoded, with their size on the
 * page: the candidate's photo is chosen among them (photo.ts). The text
 * the model later reads never carries them (the image references are
 * stripped from the markdown), and they are stored as the OCR answered
 * them, JPEG or PNG, never decoded here.
 */
import { z } from "zod";

import type { OcrConfig } from "./config.js";
import {
  PHOTO_MAX_BYTES,
  sniffImageType,
  type ImageGeometry,
  type ImagesOfPage,
  type PhotoContentType,
} from "./photo.js";

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

/** An image the OCR cut out of a page, as it answered it. */
export interface OcrImage extends ImageGeometry {
  bytes: Buffer;
  contentType: PhotoContentType;
}

export interface OcrResult {
  text: string;
  pagesProcessed: number;
  model: string;
  /**
   * The first page's images and its width, in the OCR's pixels, for the
   * photo only; null when the answer named no first page.
   */
  firstPage: ImagesOfPage<OcrImage> | null;
}

const coordinate = z.number().nullable().optional();

const ImageSchema = z.object({
  id: z.string().nullable().optional(),
  top_left_x: coordinate,
  top_left_y: coordinate,
  bottom_right_x: coordinate,
  bottom_right_y: coordinate,
  image_base64: z.string().nullable().optional(),
});

const AnswerSchema = z.object({
  pages: z
    .array(
      z.object({
        index: z.number().optional(),
        markdown: z.string().optional(),
        images: z.array(ImageSchema).nullable().optional(),
        dimensions: z
          .object({
            dpi: coordinate,
            height: coordinate,
            width: coordinate,
          })
          .nullable()
          .optional(),
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

type OcrImageAnswer = z.output<typeof ImageSchema>;

/**
 * The bytes of an `image_base64` value (a data URL or bare base64) when
 * they are a JPEG or a PNG under the bucket's cap, else null.
 */
export function decodeOcrImage(value: string | null | undefined): Pick<OcrImage, "bytes" | "contentType"> | null {
  if (!value) return null;
  const comma = value.indexOf(",");
  const base64 = value.startsWith("data:") && comma > 0 ? value.slice(comma + 1) : value;
  const bytes = Buffer.from(base64.trim(), "base64");
  if (bytes.byteLength === 0 || bytes.byteLength > PHOTO_MAX_BYTES) return null;
  const contentType = sniffImageType(bytes);
  return contentType ? { bytes, contentType } : null;
}

/**
 * One answered image with its size on the page, or null when it has no
 * usable bytes or box. The box is where the page draws it, in the OCR's
 * pixels like the page's width, so it is also its drawn width.
 */
export function ocrImageOf(answer: OcrImageAnswer): OcrImage | null {
  const decoded = decodeOcrImage(answer.image_base64);
  if (!decoded) return null;
  const { top_left_x: x0, top_left_y: y0, bottom_right_x: x1, bottom_right_y: y1 } = answer;
  if (typeof x0 !== "number" || typeof y0 !== "number" || typeof x1 !== "number" || typeof y1 !== "number") {
    return null;
  }
  const width = Math.round(x1 - x0);
  const height = Math.round(y1 - y0);
  if (width <= 0 || height <= 0) return null;
  return { ...decoded, width, height, drawnWidth: width };
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
    // The images the OCR cut out, for the candidate's photo (photo.ts);
    // the text keeps none of them.
    include_image_base64: true,
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
    .map((page, position) => ({ ...page, index: page.index ?? position }))
    .sort((a, b) => a.index - b.index);
  const text = pages
    .map((page) => cleanOcrMarkdown(page.markdown ?? ""))
    .filter((page) => page.length > 0)
    .join("\n\n");
  const first = pages[0];
  const pageWidth = first?.dimensions?.width;
  const firstPage: ImagesOfPage<OcrImage> | null = first
    ? {
        pageWidth: typeof pageWidth === "number" && pageWidth > 0 ? pageWidth : null,
        images: (first.images ?? []).map(ocrImageOf).filter((image): image is OcrImage => image !== null),
      }
    : null;
  return {
    text,
    pagesProcessed: parsed.data.usage_info?.pages_processed ?? pages.length,
    model: parsed.data.model ?? config.model,
    firstPage,
  };
}
