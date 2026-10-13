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
import { embeddingStatus, resetEmbeddingStatus } from "../src/embedding.js";
import {
  REEMBED_BATCH,
  REEMBED_MAX_PAGES,
  runMaintenance,
  type MaintenanceDeps,
} from "../src/maintenance.js";
import { FAILURE_MESSAGES } from "../src/messages.js";
import { readMetrics, resetMetrics } from "../src/metrics.js";
import { ModelError, type Embedding } from "../src/model.js";
import { processDocument, type PipelineDeps } from "../src/pipeline.js";
import {
  emptyProfile,
  type DocumentClassification,
  type Profile,
  type StructuredAnswer,
} from "../src/structure.js";
import type { AiUsageKind, CandidateRow, DocumentRow, OrganizationLimits } from "../src/types.js";
import { usageRecorderOf } from "../src/usage.js";

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

/** A CV text without an email or a phone number, long enough not to look scanned. */
const BARE_CV = `Marie Dupont
Contrôleuse de gestion senior
Paris, France

Expérience
Contrôleuse de gestion, Groupe Alpha, Paris
Pilotage budgétaire, reporting mensuel, consolidation, SAP et Excel au quotidien.
Analyste financière, Beta Conseil, Lyon
Analyses de rentabilité, business plans, suivi de trésorerie.`;

const VECTOR = Array.from({ length: 1024 }, (_, i) => (i === 0 ? 0.5 : 0));
const EMBED_USAGE = { model: "mistral-embed", tokensIn: 80, tokensOut: 0 };

function stripUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/** What the database's GENERATED column computes from `phone`. */
function phoneDigits(phone: string | null | undefined): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  return digits ? digits : null;
}

function experience(company: string | null): Profile["experiences"][number] {
  return { title: "Contrôleuse de gestion", company, start: "2019", end: null, description: null };
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
      document_kind: null,
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

  private firstCandidate(matches: (row: CandidateRow) => boolean): CandidateRow | null {
    return [...this.candidates.values()].find(matches) ?? null;
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
    return this.firstCandidate((c) => c.org_id === orgId && c.fingerprint === fingerprint);
  }

  async findCandidateByEmail(orgId: string, email: string): Promise<CandidateRow | null> {
    const key = email.toLowerCase();
    return this.firstCandidate((c) => c.org_id === orgId && (c.email ?? "").toLowerCase() === key);
  }

  async findCandidateByPhoneDigits(orgId: string, digits: string): Promise<CandidateRow | null> {
    return this.firstCandidate(
      (c) => c.org_id === orgId && c.phone_digits !== null && c.phone_digits.endsWith(digits),
    );
  }

  async getCandidateById(orgId: string, id: string): Promise<CandidateRow | null> {
    const row = this.candidates.get(id);
    return row && row.org_id === orgId ? row : null;
  }

  async listCandidatesWithoutEmbedding(limit: number, offset = 0): Promise<CandidateRow[]> {
    return [...this.candidates.values()]
      .filter((c) => c.status === "active" && this.embeddings.get(c.id) === null)
      .slice(offset, offset + limit);
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
      phone_digits: phoneDigits(values.phone),
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
    const next: CandidateRow = Object.assign({}, current, stripUndefined(rest), { updated_at: NOW });
    next.phone_digits = phoneDigits(next.phone);
    this.candidates.set(id, next);
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

function modelAnswer(
  overrides: Partial<Profile> = {},
  classification: DocumentClassification = { kind: "cv", reason: null },
): StructuredAnswer {
  return {
    profile: {
      ...emptyProfile(),
      full_name: "Marie Dupont",
      headline: "Contrôleuse de gestion senior",
      location: "Paris",
      skills: ["SQL", "excel"],
      experiences: [experience("Groupe Alpha")],
      confidence: { full_name: 0.95, headline: 0.9, location: 0.9, skills: 0.9, experiences: 0.85 },
      ...overrides,
    },
    usage: { model: "mistral-small-latest", tokensIn: 1200, tokensOut: 300 },
    classification,
  };
}

async function fakeEmbed(_text: string): Promise<Embedding> {
  return { vector: VECTOR, usage: EMBED_USAGE };
}

function maintenanceDeps(db: FakeDb, overrides: Partial<MaintenanceDeps> = {}): MaintenanceDeps {
  return {
    db,
    now: () => new Date(NOW),
    embed: null,
    recordUsage: usageRecorderOf(db),
    embeddingModel: "mistral-embed",
    ...overrides,
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
    expect(updated?.document_kind).toBeNull();
    expect(updated?.processed_at).toBe(NOW);

    const candidate = db.candidates.get(updated?.candidate_id ?? "");
    expect(candidate?.full_name).toBe("Marie Dupont");
    expect(candidate?.email).toBe("marie.dupont@example.com");
    expect(candidate?.phone).toBe("+33 6 12 34 56 78");
    expect(candidate?.phone_digits).toBe("33612345678");
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
    const first = db.addDocument({}, Buffer.from("pdf-one"));
    const deps = depsFor(db, { structure: async () => modelAnswer(), embed: fakeEmbed });
    expect(await processDocument(first.id, deps)).toBe("processed");

    const doc = db.documents.get(first.id);
    expect(doc?.structuring_method).toBe("model");
    expect(doc?.document_kind).toBe("cv");
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

  it("keeps the document processed when the embedding call fails, and /health learns of it", async () => {
    resetEmbeddingStatus();
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
    expect(embeddingStatus()).toBe("unavailable");

    const wrongWidth = db.addDocument({}, Buffer.from("pdf-two"));
    await processDocument(
      wrongWidth.id,
      depsFor(db, {
        structure: async () => modelAnswer(),
        embed: async () => {
          throw new ModelError("The embedding model answered 256 dimensions", { dimensions: 256 });
        },
      }),
    );
    expect(db.documents.get(wrongWidth.id)?.status).toBe("processed");
    expect(embeddingStatus()).toBe("mismatch");

    const fixed = db.addDocument({}, Buffer.from("pdf-three"));
    await processDocument(fixed.id, depsFor(db, { structure: async () => modelAnswer(), embed: fakeEmbed }));
    expect(embeddingStatus()).toBe("ok");
  });

  it("sets aside a document the model says is not a CV, without creating or touching a candidate", async () => {
    resetMetrics();
    const db = new FakeDb();
    const doc = db.addDocument({ file_name: "lettre.pdf" }, Buffer.from("letter"));
    const embed = vi.fn(fakeEmbed);
    const outcome = await processDocument(
      doc.id,
      depsFor(db, {
        structure: async () =>
          modelAnswer({}, { kind: "other", reason: "A cover letter: no experiences, no education." }),
        embed,
      }),
    );
    expect(outcome).toBe("rejected");

    const updated = db.documents.get(doc.id);
    expect(updated?.status).toBe("rejected");
    expect(updated?.document_kind).toBe("other");
    expect(updated?.error).toBe(FAILURE_MESSAGES.notCv);
    expect(updated?.candidate_id).toBeNull();
    expect(updated?.extracted_text).toContain("Marie Dupont");
    expect(updated?.text_chars).toBeGreaterThan(100);
    expect(updated?.page_count).toBe(2);
    expect(updated?.extraction_method).toBe("pdf-text");
    expect(updated?.structuring_method).toBe("model");
    expect(updated?.processed_at).toBe(NOW);
    expect(db.candidates.size).toBe(0);
    expect(embed).not.toHaveBeenCalled();
    expect(db.usage.map((u) => u.kind)).toEqual(["structure"]);
    expect(readMetrics().documents.rejected).toBe(1);
  });

  it("keeps a pinned document's candidate as it was when the file is set aside", async () => {
    const db = new FakeDb();
    const candidateId = await db.insertCandidate({
      org_id: ORG,
      created_by: USER,
      source: "upload",
      full_name: "Marie Dupont",
      email: "marie.dupont@example.com",
      headline: "Contrôleuse de gestion senior",
      fingerprint: "marie.dupont@example.com",
    });
    const before = db.candidates.get(candidateId);
    const doc = db.addDocument({ candidate_id: candidateId }, Buffer.from("diploma"));
    const outcome = await processDocument(
      doc.id,
      depsFor(db, {
        structure: async () => modelAnswer({}, { kind: "other", reason: "A diploma." }),
      }),
    );
    expect(outcome).toBe("rejected");
    const updated = db.documents.get(doc.id);
    expect(updated?.status).toBe("rejected");
    expect(updated?.candidate_id).toBe(candidateId);
    expect(db.candidates.size).toBe(1);
    expect(db.candidates.get(candidateId)).toEqual(before);
  });

  it("never sets a document aside without a model: the heuristic cannot tell", async () => {
    const db = new FakeDb();
    const doc = db.addDocument({ file_name: "lettre.pdf" }, Buffer.from("letter"));
    expect(await processDocument(doc.id, depsFor(db))).toBe("processed");
    expect(db.documents.get(doc.id)?.document_kind).toBeNull();
    expect(db.candidates.size).toBe(1);
  });

  it("merges a second export of the same person through the email, whatever its case", async () => {
    const db = new FakeDb();
    const first = db.addDocument({}, Buffer.from("export-one"));
    expect(await processDocument(first.id, depsFor(db, { structure: async () => modelAnswer() }))).toBe(
      "processed",
    );
    const candidateId = db.documents.get(first.id)?.candidate_id ?? "";
    expect(db.candidates.get(candidateId)?.email).toBe("marie.dupont@example.com");

    const second = db.addDocument({}, Buffer.from("export-two"));
    const outcome = await processDocument(
      second.id,
      depsFor(db, {
        extractPdf: async () => ({ pageCount: 1, text: BARE_CV }),
        structure: async () =>
          modelAnswer({ full_name: "M. Dupont", email: "Marie.Dupont@EXAMPLE.com", phone: null }),
      }),
    );
    expect(outcome).toBe("processed");
    expect(db.candidates.size).toBe(1);
    expect(db.documents.get(second.id)?.candidate_id).toBe(candidateId);
  });

  it("merges through the phone number when the email is missing and the number is written differently", async () => {
    const db = new FakeDb();
    const first = db.addDocument({}, Buffer.from("export-one"));
    await processDocument(first.id, depsFor(db, { structure: async () => modelAnswer() }));
    const candidateId = db.documents.get(first.id)?.candidate_id ?? "";
    expect(db.candidates.get(candidateId)?.phone).toBe("+33 6 12 34 56 78");

    const second = db.addDocument({}, Buffer.from("export-two"));
    const outcome = await processDocument(
      second.id,
      depsFor(db, {
        extractPdf: async () => ({ pageCount: 1, text: BARE_CV }),
        structure: async () => modelAnswer({ full_name: "M. Dupont", email: null, phone: "06.12.34.56.78" }),
      }),
    );
    expect(outcome).toBe("processed");
    expect(db.candidates.size).toBe(1);
    expect(db.documents.get(second.id)?.candidate_id).toBe(candidateId);
  });

  it("merges namesakes only when the latest company agrees; a name alone never merges", async () => {
    const db = new FakeDb();
    const bare = (company: string | null, fullName = "Marie Dupont") =>
      depsFor(db, {
        extractPdf: async () => ({ pageCount: 1, text: BARE_CV }),
        structure: async () =>
          modelAnswer({
            full_name: fullName,
            email: null,
            phone: null,
            experiences: company === null ? [] : [experience(company)],
          }),
      });

    const alpha = db.addDocument({}, Buffer.from("alpha-one"));
    await processDocument(alpha.id, bare("Groupe Alpha"));
    const alphaId = db.documents.get(alpha.id)?.candidate_id ?? "";
    expect(db.candidates.get(alphaId)?.fingerprint).toBe("marie dupont|groupe alpha");

    const alphaAgain = db.addDocument({}, Buffer.from("alpha-two"));
    await processDocument(alphaAgain.id, bare("Groupe ALPHA", "Marie DUPONT"));
    expect(db.documents.get(alphaAgain.id)?.candidate_id).toBe(alphaId);
    expect(db.candidates.size).toBe(1);

    const beta = db.addDocument({}, Buffer.from("beta"));
    await processDocument(beta.id, bare("Beta Conseil"));
    expect(db.documents.get(beta.id)?.candidate_id).not.toBe(alphaId);
    expect(db.candidates.size).toBe(2);

    const nameOnly = db.addDocument({}, Buffer.from("name-only"));
    await processDocument(nameOnly.id, bare(null));
    expect(db.candidates.size).toBe(3);
    expect(db.candidates.get(db.documents.get(nameOnly.id)?.candidate_id ?? "")?.fingerprint).toBeNull();
  });

  it("merges into the pinned candidate before any contact detail", async () => {
    const db = new FakeDb();
    const other = db.addDocument({}, Buffer.from("other-person"));
    await processDocument(
      other.id,
      depsFor(db, {
        extractPdf: async () => ({ pageCount: 1, text: BARE_CV }),
        structure: async () => modelAnswer({ full_name: "Jean Martin", email: "jean.martin@example.com" }),
      }),
    );
    const otherId = db.documents.get(other.id)?.candidate_id ?? "";
    const pinnedId = await db.insertCandidate({
      org_id: ORG,
      created_by: USER,
      source: "upload",
      full_name: "Marie Dupont",
      fingerprint: null,
    });

    const doc = db.addDocument({ candidate_id: pinnedId }, Buffer.from("pinned"));
    await processDocument(
      doc.id,
      depsFor(db, {
        extractPdf: async () => ({ pageCount: 1, text: BARE_CV }),
        structure: async () => modelAnswer({ email: "jean.martin@example.com" }),
      }),
    );
    expect(db.documents.get(doc.id)?.candidate_id).toBe(pinnedId);
    expect(db.candidates.size).toBe(2);
    expect(db.candidates.get(otherId)?.full_name).toBe("Jean Martin");
    expect(db.candidates.get(pinnedId)?.headline).toBe("Contrôleuse de gestion senior");
  });

  it("ends two exports of the same person processed at once in one candidate", async () => {
    const db = new FakeDb();
    const one = db.addDocument({}, Buffer.from("export-one"));
    const two = db.addDocument({}, Buffer.from("export-two"));
    // The model answers both documents at once (a barrier), so both reach
    // the lookup together: without the lock, each finds nobody and inserts.
    const waiting: Array<() => void> = [];
    const structure = (): Promise<StructuredAnswer> =>
      new Promise((resolve) => {
        waiting.push(() => resolve(modelAnswer()));
        if (waiting.length === 2) for (const answer of waiting) answer();
      });
    const outcomes = await Promise.all([
      processDocument(one.id, depsFor(db, { structure, embed: fakeEmbed })),
      processDocument(two.id, depsFor(db, { structure, embed: fakeEmbed })),
    ]);
    expect(outcomes).toEqual(["processed", "processed"]);
    expect(db.candidates.size).toBe(1);
    const candidateId = db.documents.get(one.id)?.candidate_id ?? "";
    expect(db.documents.get(two.id)?.candidate_id).toBe(candidateId);
    expect(db.embeddings.get(candidateId)?.split(",")).toHaveLength(1024);
    expect(db.usage.map((u) => u.kind)).toEqual(["structure", "structure", "embed", "embed"]);
  });

  it("sets aside a second copy of a file that was set aside, with the same sentence and at no cost", async () => {
    resetMetrics();
    const db = new FakeDb();
    const letter = db.addDocument({ file_name: "lettre.pdf" }, Buffer.from("same-letter"));
    const other = async (): Promise<StructuredAnswer> =>
      modelAnswer({}, { kind: "other", reason: "A cover letter." });
    expect(await processDocument(letter.id, depsFor(db, { structure: other }))).toBe("rejected");

    const again = db.addDocument({ file_name: "lettre (1).pdf" }, Buffer.from("same-letter"));
    const structure = vi.fn(other);
    expect(await processDocument(again.id, depsFor(db, { structure }))).toBe("rejected");
    const copy = db.documents.get(again.id);
    expect(copy?.status).toBe("rejected");
    expect(copy?.document_kind).toBe("other");
    expect(copy?.error).toBe(FAILURE_MESSAGES.notCv);
    expect(copy?.candidate_id).toBeNull();
    expect(copy?.extraction_method).toBe("none");
    expect(copy?.structuring_method).toBeNull();
    expect(copy?.processed_at).toBeNull();
    expect(structure).not.toHaveBeenCalled();
    expect(db.candidates.size).toBe(0);
    expect(db.usage.map((u) => u.kind)).toEqual(["structure"]);
    expect(readMetrics().documents).toMatchObject({ rejected: 2, duplicates: 0 });
  });

  it("puts an archived candidate back in the pool when a fresh CV of theirs arrives", async () => {
    const db = new FakeDb();
    const archivedId = await db.insertCandidate({
      org_id: ORG,
      created_by: USER,
      source: "upload",
      full_name: "Marie Dupont",
      email: "marie.dupont@example.com",
      fingerprint: "marie.dupont@example.com",
    });
    const row = db.candidates.get(archivedId);
    if (row) row.status = "archived";

    const doc = db.addDocument({}, Buffer.from("fresh-cv"));
    expect(await processDocument(doc.id, depsFor(db, { structure: async () => modelAnswer() }))).toBe(
      "processed",
    );
    expect(db.candidates.size).toBe(1);
    expect(db.documents.get(doc.id)?.candidate_id).toBe(archivedId);
    expect(db.candidates.get(archivedId)?.status).toBe("active");
    expect(db.candidates.get(archivedId)?.headline).toBe("Contrôleuse de gestion senior");
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
    const report = await runMaintenance(maintenanceDeps(db));
    expect(report).toMatchObject({
      purged: 1,
      filesRemoved: 1,
      failed: 0,
      reembedded: 0,
      reembedFailed: 0,
      ranAt: NOW,
    });
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
    const report = await runMaintenance(maintenanceDeps(db));
    expect(report).toMatchObject({ purged: 0, filesRemoved: 0, failed: 1 });
    expect(db.candidates.size).toBe(1);
  });

  it("gives a vector to the active candidates without one and records the spend", async () => {
    const db = new FakeDb();
    const withText = await db.insertCandidate({
      org_id: ORG,
      created_by: USER,
      source: "upload",
      headline: "Contrôleuse de gestion",
      skills: ["SQL"],
    });
    const empty = await db.insertCandidate({ org_id: ORG, created_by: USER, source: "upload" });
    const archived = await db.insertCandidate({
      org_id: ORG,
      created_by: USER,
      source: "upload",
      headline: "Archivée",
    });
    const archivedRow = db.candidates.get(archived);
    if (archivedRow) archivedRow.status = "archived";
    const already = await db.insertCandidate({
      org_id: ORG,
      created_by: USER,
      source: "upload",
      headline: "Déjà vectorisée",
      embedding: "[1,2]",
    });

    const embed = vi.fn(fakeEmbed);
    const report = await runMaintenance(maintenanceDeps(db, { embed }));
    expect(report).toMatchObject({ reembedded: 1, reembedFailed: 0 });
    expect(embed).toHaveBeenCalledTimes(1);
    expect(embed).toHaveBeenCalledWith(expect.stringContaining("Contrôleuse de gestion"));
    expect(db.embeddings.get(withText)?.split(",")).toHaveLength(1024);
    expect(db.embeddings.get(empty)).toBeNull();
    expect(db.embeddings.get(archived)).toBeNull();
    expect(db.embeddings.get(already)).toBe("[1,2]");
    expect(db.usage).toEqual([{ orgId: ORG, kind: "embed", model: "mistral-embed", tokensIn: 80, tokensOut: 0 }]);
  });

  it("pages past the candidates with nothing to embed to reach the ones below them", async () => {
    const db = new FakeDb();
    for (let i = 0; i < REEMBED_BATCH + 50; i++) {
      await db.insertCandidate({ org_id: ORG, created_by: USER, source: "upload", full_name: `Personne ${i}` });
    }
    const below = await db.insertCandidate({
      org_id: ORG,
      created_by: USER,
      source: "upload",
      headline: "Tout en bas de la liste",
    });
    const embed = vi.fn(fakeEmbed);
    const report = await runMaintenance(maintenanceDeps(db, { embed }));
    expect(report).toMatchObject({ reembedded: 1, reembedFailed: 0, reembedSkipped: REEMBED_BATCH + 50 });
    expect(embed).toHaveBeenCalledTimes(1);
    expect(db.embeddings.get(below)?.split(",")).toHaveLength(1024);
  });

  it("reads at most REEMBED_MAX_PAGES pages in one pass", async () => {
    const db = new FakeDb();
    const empty = REEMBED_MAX_PAGES * REEMBED_BATCH;
    for (let i = 0; i < empty; i++) {
      await db.insertCandidate({ org_id: ORG, created_by: USER, source: "upload", full_name: `Personne ${i}` });
    }
    const beyond = await db.insertCandidate({ org_id: ORG, created_by: USER, source: "upload", headline: "Au-delà" });
    const embed = vi.fn(fakeEmbed);
    const report = await runMaintenance(maintenanceDeps(db, { embed }));
    expect(report).toMatchObject({ reembedded: 0, reembedFailed: 0, reembedSkipped: empty });
    expect(embed).not.toHaveBeenCalled();
    expect(db.embeddings.get(beyond)).toBeNull();
  });

  it("skips the re-embed pass without a model", async () => {
    const db = new FakeDb();
    await db.insertCandidate({ org_id: ORG, created_by: USER, source: "upload", headline: "Sans vecteur" });
    const report = await runMaintenance(maintenanceDeps(db));
    expect(report).toMatchObject({ reembedded: 0, reembedFailed: 0 });
    expect(db.usage).toEqual([]);
  });

  it("stops the pass at the first wrong-width answer and goes on after any other failure", async () => {
    resetEmbeddingStatus();
    const db = new FakeDb();
    for (const headline of ["Première", "Deuxième", "Troisième"]) {
      await db.insertCandidate({ org_id: ORG, created_by: USER, source: "upload", headline });
    }

    const mismatch = vi.fn(async (_text: string): Promise<Embedding> => {
      throw new ModelError("The embedding model answered 256 dimensions", { dimensions: 256 });
    });
    const stopped = await runMaintenance(maintenanceDeps(db, { embed: mismatch }));
    expect(stopped).toMatchObject({ reembedded: 0, reembedFailed: 1 });
    expect(mismatch).toHaveBeenCalledTimes(1);
    expect(embeddingStatus()).toBe("mismatch");
    expect(db.usage).toEqual([]);

    let calls = 0;
    const flaky = async (text: string): Promise<Embedding> => {
      calls += 1;
      if (calls === 1) throw new Error("embedding down");
      return fakeEmbed(text);
    };
    const partial = await runMaintenance(maintenanceDeps(db, { embed: flaky }));
    expect(partial).toMatchObject({ reembedded: 2, reembedFailed: 1 });
    expect(calls).toBe(3);
    expect(embeddingStatus()).toBe("ok");
    expect([...db.embeddings.values()].filter((v) => v !== null)).toHaveLength(2);
  });
});
