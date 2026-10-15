import { describe, expect, it } from "vitest";

import type { CandidateRow, DocumentRow } from "@/lib/db/types";
import { buildExport, exportFileName, exportJson } from "./export";

const candidate: CandidateRow = {
  id: "3f2a1b9c-0000-4000-8000-000000000000",
  org_id: "o1",
  full_name: "Éléonore Da Silva",
  email: null,
  phone: null,
  headline: null,
  location: null,
  years_experience: null,
  availability: null,
  summary: null,
  skills: [],
  languages: [],
  experiences: [],
  education: [],
  links: [],
  tags: ["finance"],
  confidence: {},
  source: "manual",
  consent_status: "given",
  consent_at: "2026-10-01T00:00:00Z",
  last_contact_at: null,
  status: "active",
  fingerprint: "secret-key",
  photo_path: null,
  photo_checked_at: null,
  search_text: "index text",
  created_by: "u1",
  created_at: "2026-10-13T08:00:00Z",
  updated_at: "2026-10-13T08:00:00Z",
};

const document: DocumentRow = {
  id: "d1",
  org_id: "o1",
  candidate_id: candidate.id,
  storage_path: "o1/d1.pdf",
  document_kind: "cv",
  file_name: "cv.pdf",
  mime_type: "application/pdf",
  byte_size: 1234,
  sha256: null,
  status: "processed",
  error: null,
  attempts: 1,
  page_count: 2,
  text_chars: 10,
  extracted_text: "hello",
  extraction_method: "pdf-text",
  structuring_method: "model",
  processed_at: "2026-10-13T09:00:00Z",
  uploaded_by: "u1",
  created_at: "2026-10-13T08:30:00Z",
  updated_at: "2026-10-13T09:00:00Z",
};

describe("buildExport", () => {
  it("keeps the profile and the documents, not the index columns nor the object key", () => {
    const data = buildExport(candidate, [document], new Date("2026-10-13T10:00:00Z"));
    expect(data.exportedAt).toBe("2026-10-13T10:00:00.000Z");
    expect("search_text" in data.candidate).toBe(false);
    expect("fingerprint" in data.candidate).toBe(false);
    expect(data.candidate.tags).toEqual(["finance"]);
    expect(data.documents[0]?.extracted_text).toBe("hello");
    expect("storage_path" in (data.documents[0] ?? {})).toBe(false);
    expect(data.photo).toBeNull();
    expect(JSON.parse(exportJson(data))).toEqual(data);
  });

  it("carries the photo as a signed link when the profile has one", () => {
    const photo = {
      path: "o1/c1.png",
      url: "https://signed/c1.png",
      expiresAt: "2026-10-13T11:00:00.000Z",
    };
    const data = buildExport(
      { ...candidate, photo_path: "o1/c1.png" },
      [],
      new Date("2026-10-13T10:00:00Z"),
      photo,
    );
    expect(data.photo).toEqual(photo);
    expect(data.candidate.photo_path).toBe("o1/c1.png");
  });
});

describe("exportFileName", () => {
  it("slugs the name and keeps the start of the id", () => {
    expect(exportFileName(candidate)).toBe("candidat-eleonore-da-silva-3f2a1b.json");
    expect(exportFileName({ id: candidate.id, full_name: null })).toBe("candidat-3f2a1b.json");
  });
});
