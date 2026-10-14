/**
 * The pure side of the CV viewer: whether the browser can show a PDF
 * inline (else the viewer opens on the extracted text), the URL the
 * frame loads (the page fitted to the width), the extracted text as
 * paragraphs, and which of a profile's documents "Voir le CV" opens.
 * No React, no data access; tested in cv-viewer.test.ts.
 */
import type { DocumentRow } from "@/lib/db/types";

export type ViewerTab = "pdf" | "text";

/** The part of `navigator` the check reads, so a test hands in a fake. */
export interface PdfCapableNavigator {
  pdfViewerEnabled?: boolean | undefined;
  mimeTypes?: { namedItem(type: string): unknown } | undefined;
}

/**
 * True when the browser displays PDFs itself: the modern flag first,
 * then the registered MIME types; a browser that says neither is taken
 * at its word that it can (the text tab stays one click away). Null
 * (the server) cannot.
 */
export function canDisplayPdf(nav: PdfCapableNavigator | null | undefined): boolean {
  if (!nav) return false;
  if (typeof nav.pdfViewerEnabled === "boolean") return nav.pdfViewerEnabled;
  const types = nav.mimeTypes;
  if (types && typeof types.namedItem === "function") {
    const pdf = types.namedItem("application/pdf");
    return pdf !== null && pdf !== undefined;
  }
  return true;
}

/** The tab the viewer opens on: the PDF when the browser shows one, else the text. */
export function initialTab(pdfSupported: boolean): ViewerTab {
  return pdfSupported ? "pdf" : "text";
}

/** The URL the frame shows: the page fitted to the width (a fragment the browser's viewer reads); a URL that already carries a fragment is left alone. */
export function pdfFrameSrc(url: string): string {
  return url.includes("#") ? url : `${url}#view=FitH`;
}

/** The extracted text as paragraphs: blank lines split them, trailing spaces go, empties are dropped. */
export function textParagraphs(text: string | null | undefined): string[] {
  if (!text) return [];
  return text
    .replace(/\r\n?/g, "\n")
    .split(/\n[ \t]*\n+/)
    .map((paragraph) =>
      paragraph
        .split("\n")
        .map((line) => line.replace(/[ \t]+$/, ""))
        .join("\n")
        .trim(),
    )
    .filter((paragraph) => paragraph.length > 0);
}

/** The document "Voir le CV" opens: the newest one the service read, else the newest of any status; null without documents. */
export function primaryDocument<T extends Pick<DocumentRow, "status" | "created_at">>(
  documents: readonly T[],
): T | null {
  const newestFirst = [...documents].sort((a, b) => b.created_at.localeCompare(a.created_at));
  return newestFirst.find((document) => document.status === "processed") ?? newestFirst[0] ?? null;
}
