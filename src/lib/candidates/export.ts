/**
 * A candidate's data as one JSON file, built in the browser from the
 * rows the person can read: the profile, the list of its documents
 * (with the text extracted from each CV, which is the candidate's data
 * too) and, when the profile carries a photo, a signed link to it that
 * lives one hour (photos.ts). What was never read is absent or null, as
 * in the rows. The pure part is tested in export.test.ts; downloadJson()
 * is the browser side.
 */
import type { CandidateRow, DocumentRow } from "@/lib/db/types";

import type { ExportPhoto } from "./photos";

export type DocumentExportRow = Pick<
  DocumentRow,
  | "id"
  | "file_name"
  | "mime_type"
  | "byte_size"
  | "sha256"
  | "status"
  | "error"
  | "page_count"
  | "extracted_text"
  | "extraction_method"
  | "structuring_method"
  | "processed_at"
  | "created_at"
>;

export interface CandidateExport {
  format: "vivier.candidate";
  version: 1;
  exportedAt: string;
  candidate: Omit<CandidateRow, "search_text" | "fingerprint">;
  documents: DocumentExportRow[];
  /** The photo read from the CV, as a link valid one hour; null when the profile has none (or the link could not be signed). */
  photo: ExportPhoto | null;
}

export function buildExport(
  candidate: CandidateRow,
  documents: readonly DocumentRow[],
  now: Date = new Date(),
  photo: ExportPhoto | null = null,
): CandidateExport {
  const { search_text: _searchText, fingerprint: _fingerprint, ...rest } = candidate;
  return {
    format: "vivier.candidate",
    version: 1,
    exportedAt: now.toISOString(),
    candidate: rest,
    photo,
    documents: documents.map((d) => ({
      id: d.id,
      file_name: d.file_name,
      mime_type: d.mime_type,
      byte_size: d.byte_size,
      sha256: d.sha256,
      status: d.status,
      error: d.error,
      page_count: d.page_count,
      extracted_text: d.extracted_text,
      extraction_method: d.extraction_method,
      structuring_method: d.structuring_method,
      processed_at: d.processed_at,
      created_at: d.created_at,
    })),
  };
}

/** "candidat-ana-lu-3f2a1b.json": the name as a slug, then the start of the id. */
export function exportFileName(candidate: Pick<CandidateRow, "id" | "full_name">): string {
  const slug = (candidate.full_name ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const tail = candidate.id.replace(/-/g, "").slice(0, 6);
  return `candidat-${slug ? `${slug}-` : ""}${tail}.json`;
}

export function exportJson(data: CandidateExport): string {
  return JSON.stringify(data, null, 2);
}

/** Hands a JSON text to the browser as a file to save. */
export function downloadJson(fileName: string, json: string): void {
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
