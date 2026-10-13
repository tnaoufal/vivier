import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { loadConfig } from "../src/config.js";
import {
  DuplicateFileError,
  type CandidateInsert,
  type CandidateWrite,
  type Db,
  type DocumentPatch,
  type ExpiredCandidate,
} from "../src/db.js";
import { runMaintenance } from "../src/maintenance.js";
import { FAILURE_MESSAGES } from "../src/messages.js";
import { processDocument, type PipelineDeps } from "../src/pipeline.js";
import { emptyProfile, type Profile } from "../src/structure.js";
import type { AiUsageKind, CandidateRow, DocumentRow, OrganizationLimits } from "../src/types.js";

const ORG = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const NOW = "2026-10-13T10:00:00.000Z";

const SAMPLE_CV = `Marie Dupont
Contrôleuse de gestion senior
Paris, France
marie.dupont@example.com | +33 6 12 34 56 78

Expérience
2019 - 2024 Contrôleuse de gestion, Groupe Alpha, Paris
Pilotage budgétaire, reporting mensuel, consolidation, SAP et Excel au quotidien.
2015 - 2019 Analyste financière, Beta Conseil, Lyon
Analyses de rentabilité, business plans, suivi de trésorerie.

Formation
2015 Master Contrôle de gestion, Université Paris-Dauphine`;

function stripUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}

class FakeDb implements Db {
  readonly documents = new Map<string, DocumentRow>();
  readonly candidates = new Map<string, CandidateRow>();
  readonly embeddings = new Map<string, string | null>();
  readonly objects = new Map<string, Buffer>();
  readonly usage: Array<{ orgId: string; kind: AiUsageKind; model: string | null; tokensIn: number; tokensOut: number }> = [];
  readonly removed: string[] = [];
  organization: OrganizationLimits = { id: ORG, plan: "trial", cv_quota_month: 200, retention_months: 24 };
  processedThisMonth = 0;
  expired: ExpiredCandidate[] = [];
  private counter = 0;

  addDocument(overrides: Partial<DocumentRow>, bytes: Buffer): DocumentRow {
    this.counter += 1;
    const id = overrides.id ?? `33333333-3333-4333-8333-${String(this.counter).padStart(12, "0")}`;
    const row: DocumentRow = {
      id,
      org_id: ORG,
      candidate_id: null,
      storage_path: `${ORG}/${id}.pdf`,
      file_name: "cv.pdf",
      mime_type: "application/pdf",
      byte_size: bytes.byteLength,
      sha256: null,
      status: "queued",
      error: null,
      attempts: 0,
      page_count: null,
      text_chars: null,
      extracted_text: null,
      extraction_method: null,
      structuring_method: null,
      processed_at: null,
      uploaded_by: USER,
      created_at: NOW,
      updated_at: NOW,
      ...stripUndefined(overrides),
    };
    this.documents.set(id, row);
    this.objects.set(row.storage_path, bytes);
    return row;
  }

  async claimDocument(id: string): Promise<DocumentRow | null> {
    const current = this.documents.get(id);
    if (!current || current.status !== "queued") return null;
    const next: DocumentRow = { ...current, status: "processing", attempts: current.attempts + 1 };
    this.documents.set(id, next);
    return next;
  }

  async listQueued(limit: number): Promise<string[]> {
    return [...this.documents.values()]
      .filter((d) => d.status === "queued")
      .slice(0, limit)
      .map((d) => d.id);
  }

  async countQueued(): Promise<number> {
    return [...this.documents.values()].filter((d) => d.status === "queued").length;
  }

  async resetStale(_now: Date): Promise<{ requeued: number; failed: number }> {
    return { requeued: 0, failed: 0 };
  }

  async getDocument(id: string): Promise<DocumentRow | null> {
    return this.documents.get(id) ?? null;
  }

  async updateDocument(id: string, patch: DocumentPatch): Promise<void> {
    const current = this.documents.get(id);
    if (!current) throw new Error(`document ${id} missing`);
    if (patch.sha256) {
      for (const other of this.documents.values()) {
        if (other.id !== id && other.org_id === current.org_id && other.sha256 === patch.sha256) {
          throw new DuplicateFileError();
        }
      }
    }
    this.documents.set(id, Object.assign({}, current, stripUndefined(patch), { updated_at: NOW }));
  }

  async findDocumentBySha256(orgId: string, sha256: string, excludeId: string): Promise<DocumentRow | null> {
    return (
      [...this.documents.values()].find((d) => d.org_id === orgId && d.sha256 === sha256 && d.id !== excludeId) ??
      null
    );
  }

  async findCandidateByFingerprint(orgId: string, fingerprint: string): Promise<CandidateRow | null> {
    return [...this.candidates.values()].find((c) => c.org_id === orgId && c.fingerprint === fingerprint) ?? null;
  }

  async insertCandidate(values: CandidateInsert): Promise<string> {
    this.counter += 1;
    const id = `44444444-4444-4444-8444-${String(this.counter).padStart(12, "0")}`;
    const row: CandidateRow = {
      id,
      org_id: values.org_id,
      full_name: values.full_name ?? null,
      email: values.email ?? null,
      phone: values.phone ?? null,
      headline: values.headline ?? null,
      location: values.location ?? null,
      years_experience: values.years_experience ?? null,
      availability: values.availability ?? null,
      summary: values.summary ?? null,
      skills: values.skills ?? [],
      languages: values.languages ?? [],
      experiences: values.experiences ?? [],
      education: values.education ?? [],
      links: values.links ?? [],
      tags: values.tags ?? [],
      confidence: values.confidence ?? {},
      source: values.source,
      consent_status: "unknown",
      consent_at: null,
      last_contact_at: null,
      status: "active",
      fingerprint: values.fingerprint ?? null,
      search_text: values.search_text ?? null,
      created_by: values.created_by,
      created_at: NOW,
      updated_at: NOW,
    };
    this.candidates.set(id, row);
    this.embeddings.set(id, values.embedding ?? null);
    return id;
  }

  async updateCandidate(id: string, patch: CandidateWrite): Promise<void> {
    const current = this.candidates.get(id);
    if (!current) throw new Error(`candidate ${id} missing`);
    const { embedding, ...rest } = patch;
    this.candidates.set(id, Object.assign({}, current, stripUndefined(rest), { updated_at: NOW }));
    if (embedding !== undefined) this.embeddings.set(id, embedding);
  }

  async getOrganization(_orgId: string): Promise<OrganizationLimits | null> {
    return this.organization;
  }

  async cvsProcessedThisMonth(_orgId: string): Promise<number> {
    return this.processedThisMonth;
  }

  async expiredCandidates(_limit: number): Promise<ExpiredCandidate[]> {
    return this.expired;
  }

  async listDocumentsOfCandidate(candidateId: string): Promise<Array<{ id: string; storage_path: string }>> {
    return [...this.documents.values()]
      .filter((d) => d.candidate_id === candidateId)
      .map((d) => ({ id: d.id, storage_path: d.storage_path }));
  }

  async deleteCandidate(id: string): Promise<void> {
    this.candidates.delete(id);
    this.embeddings.delete(id);
    for (const [key, d] of this.documents) if (d.candidate_id === id) this.documents.delete(key);
  }

  async recordUsage(orgId: string, kind: AiUsageKind, model: string | null, tokensIn: number, tokensOut: number): Promise<void> {
    this.usage.push({ orgId, kind, model, tokensIn, tokensOut });
  }

  async downloadObject(path: string): Promise<Buffer> {
    const bytes = this.objects.get(path);
    if (!bytes) throw new Error(`object ${path} missing`);
    return bytes;
  }

  async removeObjects(paths: string[]): Promise<void> {
    this.removed.push(...paths);
    for (const path of paths) this.objects.delete(path);
  }
}

function depsFor(db: FakeDb, overrides: Partial<PipelineDeps> = {}): PipelineDeps {
  return {
    db,
    config: loadConfig({ PROCESSOR_SHARED_SECRET: "x".repeat(32) }),
    extractPdf: async () => ({ pageCount: 2, text: SAMPLE_CV }),
    ocr: null,
    structure: null,
    embed: null,
    now: () => new Date(NOW),
    ...overrides,
  };
}

function modelAnswer(overrides: Partial<Profile> = {}): { profile: Profile; usage: { model: string; tokensIn: number; tokensOut: number } } {
  return {
    profile: {
      ...emptyProfile(),
      full_name: "Marie Dupont",
      headline: "Contrôleuse de gestion senior",
      location: "Paris",
      skills: ["SQL", "excel"],
      experiences: [
        { title: "Contrôleuse de gestion", company: "Groupe Alpha", start: "2019", end: null, description: null },
      ],
      confidence: { full_name: 0.95, headline: 0.9, location: 0.9, skills: 0.9, experiences: 0.85 },
      ...overrides,
    },
    usage: { model: "mistral-small-latest", tokensIn: 1200, tokensOut: 300 },
  };
}

beforeAll(() => {
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterAll(() => {
  vi.restoreAllMocks();
});

describe("processDocument", () => {
  it("processes a text PDF without a model: heuristic profile, candidate and document written", async () => {
    const db = new FakeDb();
    const doc = db.addDocument({ file_name: "CV_Marie_Dupont.pdf" }, Buffer.from("pdf-one"));
    const outcome = await processDocument(doc.id, depsFor(db));
    expect(outcome).toBe("processed");

    const updated = db.documents.get(doc.id);
    expect(updated?.status).toBe("processed");
    expect(updated?.error).toBeNull();
    expect(updated?.attempts).toBe(1);
    expect(updated?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(updated?.page_count).toBe(2);
    expect(updated?.text_chars).toBeGreaterThan(100);
    expect(updated?.extracted_text).toContain("Marie Dupont");
    expect(updated?.extraction_method).toBe("pdf-text");
    expect(updated?.structuring_method).toBe("heuristic");
    expect(updated?.processed_at).toBe(NOW);

    const candidate = db.candidates.get(updated?.candidate_id ?? "");
    expect(candidate?.full_name).toBe("Marie Dupont");
    expect(candidate?.email).toBe("marie.dupont@example.com");
    expect(candidate?.phone).toBe("+33 6 12 34 56 78");
    expect(candidate?.fingerprint).toBe("marie.dupont@example.com");
    expect(candidate?.confidence).toEqual({ email: 0.9, phone: 0.6, full_name: 0.3 });
    expect(candidate?.source).toBe("upload");
    expect(candidate?.created_by).toBe(USER);
    expect(candidate?.search_text).toContain("Marie Dupont");
    expect(db.embeddings.get(candidate?.id ?? "")).toBeNull();
    expect(db.usage).toEqual([]);
  });

  it("refuses a document when the organisation's monthly quota is reached, without counting an attempt", async () => {
    const db = new FakeDb();
    db.processedThisMonth = 200;
    const doc = db.addDocument({}, Buffer.from("pdf-one"));
    expect(await processDocument(doc.id, depsFor(db))).toBe("quota");
    const updated = db.documents.get(doc.id);
    expect(updated?.status).toBe("failed");
    expect(updated?.error).toBe(FAILURE_MESSAGES.quota);
    expect(updated?.attempts).toBe(0);
    expect(updated?.sha256).toBeNull();
    expect(db.candidates.size).toBe(0);
  });

  it("attaches a duplicate file to the existing candidate without processing it again", async () => {
    const db = new FakeDb();
    const first = db.addDocument({}, Buffer.from("same-bytes"));
    const second = db.addDocument({}, Buffer.from("same-bytes"));
    expect(await processDocument(first.id, depsFor(db))).toBe("processed");
    expect(await processDocument(second.id, depsFor(db))).toBe("duplicate");
    const a = db.documents.get(first.id);
    const b = db.documents.get(second.id);
    expect(b?.status).toBe("processed");
    expect(b?.candidate_id).toBe(a?.candidate_id);
    expect(b?.extraction_method).toBe("none");
    expect(b?.structuring_method).toBeNull();
    expect(b?.processed_at).toBeNull();
    expect(b?.error).toBeNull();
    expect(db.candidates.size).toBe(1);
  });

  it("marks a scanned PDF needs_ocr when OCR is not configured", async () => {
    const db = new FakeDb();
    const doc = db.addDocument({}, Buffer.from("scan"));
    const outcome = await processDocument(
      doc.id,
      depsFor(db, { extractPdf: async () => ({ pageCount: 3, text: "   \n " }) }),
    );
    expect(outcome).toBe("needs_ocr");
    const updated = db.documents.get(doc.id);
    expect(updated?.status).toBe("needs_ocr");
    expect(updated?.error).toBe(FAILURE_MESSAGES.scanned);
    expect(updated?.page_count).toBe(3);
    expect(updated?.extraction_method).toBe("none");
    expect(db.candidates.size).toBe(0);
  });

  it("runs OCR on a scanned PDF when configured and records the pages", async () => {
    const db = new FakeDb();
    const doc = db.addDocument({}, Buffer.from("scan"));
    const outcome = await processDocument(
      doc.id,
      depsFor(db, {
        extractPdf: async () => ({ pageCount: 3, text: "" }),
        ocr: async () => ({ text: SAMPLE_CV, pagesProcessed: 3, model: "mistral-ocr-latest" }),
      }),
    );
    expect(outcome).toBe("processed");
    const updated = db.documents.get(doc.id);
    expect(updated?.extraction_method).toBe("ocr");
    expect(updated?.structuring_method).toBe("heuristic");
    expect(db.usage).toEqual([{ orgId: ORG, kind: "ocr", model: "mistral-ocr-latest", tokensIn: 3, tokensOut: 0 }]);
    expect(db.candidates.size).toBe(1);
  });

  it("uses the model and the embedding when configured, backfills contacts and merges a second CV", async () => {
    const db = new FakeDb();
    const vector = Array.from({ length: 1024 }, (_, i) => (i === 0 ? 0.5 : 0));
    const first = db.addDocument({}, Buffer.from("pdf-one"));
    const deps = depsFor(db, {
      structure: async () => modelAnswer(),
      embed: async () => ({ vector, usage: { model: "mistral-embed", tokensIn: 80, tokensOut: 0 } }),
    });
    expect(await processDocument(first.id, deps)).toBe("processed");

    const doc = db.documents.get(first.id);
    expect(doc?.structuring_method).toBe("model");
    const candidate = db.candidates.get(doc?.candidate_id ?? "");
    expect(candidate?.headline).toBe("Contrôleuse de gestion senior");
    expect(candidate?.email).toBe("marie.dupont@example.com");
    expect(candidate?.confidence).toEqual({
      full_name: 0.95,
      headline: 0.9,
      location: 0.9,
      skills: 0.9,
      experiences: 0.85,
      email: 0.9,
      phone: 0.6,
    });
    const embedding = db.embeddings.get(candidate?.id ?? "");
    expect(embedding?.startsWith("[0.500000,0.000000,")).toBe(true);
    expect(embedding?.split(",")).toHaveLength(1024);
    expect(db.usage.map((u) => u.kind)).toEqual(["structure", "embed"]);

    const second = db.addDocument({}, Buffer.from("pdf-two"));
    const merged = await processDocument(
      second.id,
      depsFor(db, {
        structure: async () =>
          modelAnswer({
            headline: "Autre titre",
            summary: "Dix ans de contrôle de gestion.",
            skills: ["sql", "Power BI"],
            confidence: { headline: 0.5, summary: 0.9, skills: 0.9 },
          }),
        embed: deps.embed,
      }),
    );
    expect(merged).toBe("processed");
    expect(db.candidates.size).toBe(1);
    const updated = db.candidates.get(candidate?.id ?? "");
    expect(db.documents.get(second.id)?.candidate_id).toBe(candidate?.id);
    expect(updated?.headline).toBe("Contrôleuse de gestion senior");
    expect(updated?.summary).toBe("Dix ans de contrôle de gestion.");
    expect(updated?.skills).toEqual(["SQL", "excel", "Power BI"]);
    expect(updated?.confidence.headline).toBe(0.9);
  });

  it("keeps the document processed when the embedding call fails", async () => {
    const db = new FakeDb();
    const doc = db.addDocument({}, Buffer.from("pdf-one"));
    const outcome = await processDocument(
      doc.id,
      depsFor(db, {
        structure: async () => modelAnswer(),
        embed: async () => {
          throw new Error("embedding down");
        },
      }),
    );
    expect(outcome).toBe("processed");
    const candidateId = db.documents.get(doc.id)?.candidate_id ?? "";
    expect(db.embeddings.get(candidateId)).toBeNull();
    expect(db.usage.map((u) => u.kind)).toEqual(["structure"]);
  });

  it("fails with one sentence per failure class and keeps the cause out of the row", async () => {
    const db = new FakeDb();
    const unreadable = db.addDocument({}, Buffer.from("broken"));
    expect(
      await processDocument(
        unreadable.id,
        depsFor(db, {
          extractPdf: async () => {
            throw new Error("Invalid PDF structure");
          },
        }),
      ),
    ).toBe("failed");
    expect(db.documents.get(unreadable.id)?.error).toBe(FAILURE_MESSAGES.unreadable);

    const noModel = db.addDocument({}, Buffer.from("pdf-two"));
    expect(
      await processDocument(
        noModel.id,
        depsFor(db, {
          structure: async () => {
            throw new Error("401 Unauthorized");
          },
        }),
      ),
    ).toBe("failed");
    expect(db.documents.get(noModel.id)?.error).toBe(FAILURE_MESSAGES.model);
    expect(db.documents.get(noModel.id)?.status).toBe("failed");

    const missing = db.addDocument({ storage_path: `${ORG}/missing.pdf` }, Buffer.from("x"));
    db.objects.delete(`${ORG}/missing.pdf`);
    expect(await processDocument(missing.id, depsFor(db))).toBe("failed");
    expect(db.documents.get(missing.id)?.error).toBe(FAILURE_MESSAGES.generic);
  });

  it("skips a document that is not queued", async () => {
    const db = new FakeDb();
    const doc = db.addDocument({ status: "processing", attempts: 1 }, Buffer.from("pdf"));
    expect(await processDocument(doc.id, depsFor(db))).toBe("skipped");
    expect(db.documents.get(doc.id)?.attempts).toBe(1);
    expect(await processDocument("55555555-5555-4555-8555-555555555555", depsFor(db))).toBe("skipped");
  });
});

describe("runMaintenance", () => {
  it("removes the files, then the candidate, and reports", async () => {
    const db = new FakeDb();
    const doc = db.addDocument({}, Buffer.from("pdf-one"));
    await processDocument(doc.id, depsFor(db));
    const candidateId = db.documents.get(doc.id)?.candidate_id ?? "";
    db.expired = [{ candidate_id: candidateId, org_id: ORG, reason: "retention" }];
    const report = await runMaintenance({ db, now: () => new Date(NOW) });
    expect(report).toMatchObject({ purged: 1, filesRemoved: 1, failed: 0, ranAt: NOW });
    expect(db.removed).toEqual([doc.storage_path]);
    expect(db.candidates.size).toBe(0);
    expect(db.documents.size).toBe(0);
  });

  it("leaves a candidate whose files could not be removed for the next pass", async () => {
    const db = new FakeDb();
    const doc = db.addDocument({}, Buffer.from("pdf-one"));
    await processDocument(doc.id, depsFor(db));
    const candidateId = db.documents.get(doc.id)?.candidate_id ?? "";
    db.expired = [{ candidate_id: candidateId, org_id: ORG, reason: "consent_withdrawn" }];
    db.removeObjects = async () => {
      throw new Error("storage down");
    };
    const report = await runMaintenance({ db, now: () => new Date(NOW) });
    expect(report).toMatchObject({ purged: 0, filesRemoved: 0, failed: 1 });
    expect(db.candidates.size).toBe(1);
  });
});
