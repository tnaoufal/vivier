import { describe, expect, it } from "vitest";

import type { OcrConfig } from "../src/config.js";
import { OcrError, cleanOcrMarkdown, decodeOcrImage, ocrImageOf, ocrPdf } from "../src/ocr.js";
import { PHOTO_MAX_BYTES } from "../src/photo.js";

const CONFIG: OcrConfig = { apiKey: "secret", url: "https://api.mistral.ai/v1/ocr", model: "mistral-ocr-latest" };

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0xff, 0xd9]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

function dataUrl(bytes: Buffer, type = "image/jpeg"): string {
  return `data:${type};base64,${bytes.toString("base64")}`;
}

/** A fetch that records the request and answers `answer` as JSON. */
function fetchAnswering(answer: unknown, status = 200) {
  const calls: Array<{ url: string; body: unknown; headers: Record<string, string> }> = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(input),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
      headers: (init?.headers ?? {}) as Record<string, string>,
    });
    return new Response(JSON.stringify(answer), { status, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  return { impl, calls };
}

describe("decodeOcrImage and ocrImageOf", () => {
  it("decodes a data URL or bare base64 into JPEG or PNG bytes, and nothing else", () => {
    expect(decodeOcrImage(dataUrl(JPEG))?.contentType).toBe("image/jpeg");
    expect(decodeOcrImage(dataUrl(JPEG))?.bytes.equals(JPEG)).toBe(true);
    expect(decodeOcrImage(JPEG.toString("base64"))?.contentType).toBe("image/jpeg");
    expect(decodeOcrImage(dataUrl(PNG, "image/png"))?.contentType).toBe("image/png");
    // The declared type does not matter, the bytes do.
    expect(decodeOcrImage(dataUrl(PNG, "image/jpeg"))?.contentType).toBe("image/png");
    expect(decodeOcrImage(dataUrl(Buffer.from("GIF89a"), "image/gif"))).toBeNull();
    expect(decodeOcrImage("")).toBeNull();
    expect(decodeOcrImage(null)).toBeNull();
    expect(decodeOcrImage(undefined)).toBeNull();
    expect(decodeOcrImage("data:image/jpeg;base64,")).toBeNull();
  });

  it("refuses a file the bucket would refuse", () => {
    const huge = Buffer.concat([JPEG, Buffer.alloc(PHOTO_MAX_BYTES)]);
    expect(decodeOcrImage(dataUrl(huge))).toBeNull();
  });

  it("reads the size from the bounding box and drops an image without one", () => {
    const image = ocrImageOf({
      id: "img-0.jpeg",
      top_left_x: 40,
      top_left_y: 60.4,
      bottom_right_x: 340,
      bottom_right_y: 460,
      image_base64: dataUrl(JPEG),
    });
    expect(image).toMatchObject({ width: 300, height: 400, drawnWidth: 300, contentType: "image/jpeg" });
    expect(ocrImageOf({ image_base64: dataUrl(JPEG) })).toBeNull();
    expect(ocrImageOf({ top_left_x: 0, top_left_y: 0, bottom_right_x: 0, bottom_right_y: 10, image_base64: dataUrl(JPEG) })).toBeNull();
    expect(ocrImageOf({ top_left_x: 0, top_left_y: 0, bottom_right_x: 10, bottom_right_y: 10, image_base64: null })).toBeNull();
  });
});

describe("ocrPdf", () => {
  it("asks for the images, joins the pages' text without image references, and keeps the first page's images", async () => {
    const { impl, calls } = fetchAnswering({
      model: "mistral-ocr-2505",
      usage_info: { pages_processed: 2 },
      pages: [
        {
          index: 1,
          markdown: "Page two ![img-1.jpeg](img-1.jpeg) text",
          images: [
            { id: "img-1.jpeg", top_left_x: 0, top_left_y: 0, bottom_right_x: 300, bottom_right_y: 400, image_base64: dataUrl(JPEG) },
          ],
          dimensions: { dpi: 200, height: 2339, width: 1654 },
        },
        {
          index: 0,
          markdown: "# Marie Dupont\n![img-0.jpeg](img-0.jpeg)\nContrôleuse de gestion",
          images: [
            { id: "logo", top_left_x: 0, top_left_y: 0, bottom_right_x: 400, bottom_right_y: 100, image_base64: dataUrl(PNG, "image/png") },
            { id: "img-0.jpeg", top_left_x: 1200, top_left_y: 100, bottom_right_x: 1500, bottom_right_y: 500, image_base64: dataUrl(JPEG) },
            { id: "broken", top_left_x: 0, top_left_y: 0, bottom_right_x: 100, bottom_right_y: 100, image_base64: "data:image/jpeg;base64,!!!" },
          ],
          dimensions: { dpi: 200, height: 2339, width: 1654 },
        },
      ],
    });
    const result = await ocrPdf(Buffer.from("%PDF-1.4"), CONFIG, impl);
    expect(result.text).toBe("# Marie Dupont\n\nContrôleuse de gestion\n\nPage two  text");
    expect(result.pagesProcessed).toBe(2);
    expect(result.model).toBe("mistral-ocr-2505");
    expect(result.firstPage?.pageWidth).toBe(1654);
    expect(result.firstPage?.images.map((image) => [image.width, image.height, image.contentType])).toEqual([
      [400, 100, "image/png"],
      [300, 400, "image/jpeg"],
    ]);
    expect(result.firstPage?.images[1]?.bytes.equals(JPEG)).toBe(true);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(CONFIG.url);
    expect(calls[0]?.headers["Authorization"]).toBe("Bearer secret");
    expect(calls[0]?.body).toMatchObject({
      model: "mistral-ocr-latest",
      include_image_base64: true,
      document: { type: "document_url", document_url: `data:application/pdf;base64,${Buffer.from("%PDF-1.4").toString("base64")}` },
    });
  });

  it("answers no first page without pages, and an unknown page width without dimensions", async () => {
    const empty = await ocrPdf(Buffer.from("x"), CONFIG, fetchAnswering({ pages: [] }).impl);
    expect(empty.firstPage).toBeNull();
    expect(empty.text).toBe("");
    expect(empty.pagesProcessed).toBe(0);
    const bare = await ocrPdf(Buffer.from("x"), CONFIG, fetchAnswering({ pages: [{ markdown: "Only text" }] }).impl);
    expect(bare.firstPage).toEqual({ pageWidth: null, images: [] });
    expect(bare.text).toBe("Only text");
  });

  it("turns an HTTP error or an unexpected shape into an OcrError", async () => {
    await expect(ocrPdf(Buffer.from("x"), CONFIG, fetchAnswering({ error: "nope" }, 401).impl)).rejects.toBeInstanceOf(OcrError);
    await expect(ocrPdf(Buffer.from("x"), CONFIG, fetchAnswering({ pages: "no" }).impl)).rejects.toBeInstanceOf(OcrError);
    expect(cleanOcrMarkdown("a ![x](y) b")).toBe("a  b");
  });
});
