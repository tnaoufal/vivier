import { describe, expect, it } from "vitest";

import { canDisplayPdf, initialTab, pdfFrameSrc, primaryDocument, textParagraphs } from "./cv-viewer";

describe("canDisplayPdf", () => {
  it("trusts the modern flag first", () => {
    expect(canDisplayPdf({ pdfViewerEnabled: true })).toBe(true);
    expect(canDisplayPdf({ pdfViewerEnabled: false, mimeTypes: { namedItem: () => ({}) } })).toBe(false);
  });

  it("falls back to the registered MIME types, then to yes", () => {
    expect(canDisplayPdf({ mimeTypes: { namedItem: (type) => (type === "application/pdf" ? {} : null) } })).toBe(true);
    expect(canDisplayPdf({ mimeTypes: { namedItem: () => null } })).toBe(false);
    expect(canDisplayPdf({})).toBe(true);
    expect(canDisplayPdf(null)).toBe(false);
    expect(canDisplayPdf(undefined)).toBe(false);
  });

  it("opens on the tab the browser can show", () => {
    expect(initialTab(true)).toBe("pdf");
    expect(initialTab(false)).toBe("text");
  });
});

describe("pdfFrameSrc", () => {
  it("fits the page to the width and leaves an existing fragment alone", () => {
    expect(pdfFrameSrc("https://s/cv.pdf?token=abc")).toBe("https://s/cv.pdf?token=abc#view=FitH");
    expect(pdfFrameSrc("https://s/cv.pdf#page=2")).toBe("https://s/cv.pdf#page=2");
  });
});

describe("textParagraphs", () => {
  it("splits on blank lines, keeps the lines of a paragraph, drops empties", () => {
    expect(textParagraphs("Ana Lu  \r\nDesigner\n\n\nParis\n \nFin")).toEqual(["Ana Lu\nDesigner", "Paris", "Fin"]);
    expect(textParagraphs("   ")).toEqual([]);
    expect(textParagraphs(null)).toEqual([]);
    expect(textParagraphs(undefined)).toEqual([]);
  });
});

describe("primaryDocument", () => {
  const doc = (id: string, status: "processed" | "queued" | "failed", created_at: string) => ({ id, status, created_at });

  it("prefers the newest document the service read", () => {
    const docs = [doc("old", "processed", "2026-01-01"), doc("new", "processed", "2026-03-01"), doc("q", "queued", "2026-04-01")];
    expect(primaryDocument(docs)?.id).toBe("new");
  });

  it("else takes the newest of any status, and null without documents", () => {
    expect(primaryDocument([doc("f", "failed", "2026-01-01"), doc("q", "queued", "2026-02-01")])?.id).toBe("q");
    expect(primaryDocument([])).toBeNull();
  });
});
