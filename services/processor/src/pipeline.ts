/**
 * One document, end to end: claim, quota, download, sha256 (a duplicate
 * attaches to the existing candidate and stops), text layer or OCR,
 * normalisation, structuring (model when configured, regexes otherwise),
 * fingerprint and merge into the organisation's candidate, search text,
 * embedding (best effort), the candidate row, then the document row with
 * what was done. Any thrown error leaves the document `failed` with one
 * French sentence per failure class (messages.ts) and the real cause in
 * the log. Model and OCR spend is recorded in ai_usage as it happens.
 *
 * Everything with a side effect comes through `PipelineDeps`, so the
 * tests run the whole flow against an in-memory database and fake
 * extractors.
 */
import { createHash } from "node:crypto";

import type { ProcessorConfig } from "./config.js";
import {
  DuplicateFileError,
  type CandidateInsert,
  type CandidateWrite,
  type Db,
} from "./db.js";
import { logError, logInfo } from "./log.js";
import { FAILURE_MESSAGES } from "./messages.js";
import { countDocument, countModelCall, countOcrCall, countPages } from "./metrics.js";
import { ModelError, embedOne, vectorLiteral, type Usage } from "./model.js";
import { ocrPdf, type OcrResult } from "./ocr.js";
import { extractPdfText, looksScanned, normaliseText, readableChars, type PdfText } from "./pdf.js";
import {
  backfillContacts,
  embeddingTextOf,
  fingerprintOf,
  heuristicProfile,
  mergeProfiles,
  modelProfile,
  profileOfRow,
  searchTextOf,
  type Profile,
} from "./structure.js";
import type { AiUsageKind, DocumentRow, ExtractionMethod, StructuringMethod } from "./types.js";

export interface PipelineDeps {
  db: Db;
  config: ProcessorConfig;
  extractPdf: (buffer: Buffer) => Promise<PdfText>;
  /** Null when OCR is not configured: scanned PDFs end in needs_ocr. */
  ocr: ((buffer: Buffer) => Promise<OcrResult>) | null;
  /** Null without a model: the heuristic profile is used. */
  structure: ((text: string) => Promise<{ profile: Profile; usage: Usage }>) | null;
  /** Null without a model: candidates get no embedding. */
  embed: ((text: string) => Promise<{ vector: number[]; usage: Usage }>) | null;
  now: () => Date;
}

export function defaultDeps(config: ProcessorConfig, db: Db): PipelineDeps {
  const model = config.model;
  const ocr = config.ocr;
  return {
    db,
    config,
    extractPdf: (buffer) => extractPdfText(buffer),
    ocr: ocr ? (buffer) => ocrPdf(buffer, ocr) : null,
    structure: model ? (text) => modelProfile(text, model) : null,
    embed: model ? (text) => embedOne(text, model) : null,
    now: () => new Date(),
  };
}

export type ProcessOutcome =
  | "processed"
  | "duplicate"
  | "needs_ocr"
  | "quota"
  | "failed"
  | "skipped";

/** A failure with the sentence the person reads; the cause goes to the log. */
export class PipelineFailure extends Error {
  readonly userMessage: string;

  constructor(userMessage: string, options?: ErrorOptions) {
    super(userMessage, options);
    this.name = "PipelineFailure";
    this.userMessage = userMessage;
  }
}

/** Fewer readable characters than this after extraction (OCR included) is no CV. */
const MIN_USABLE_CHARS = 40;

export function failureMessageOf(error: unknown): string {
  if (error instanceof PipelineFailure) return error.userMessage;
  if (error instanceof ModelError) return FAILURE_MESSAGES.model;
  return FAILURE_MESSAGES.generic;
}

export function candidateFieldsOf(profile: Profile): CandidateWrite {
  return {
    full_name: profile.full_name,
    email: profile.email,
    phone: profile.phone,
    headline: profile.headline,
    location: profile.location,
    years_experience: profile.years_experience,
    availability: profile.availability,
    summary: profile.summary,
    skills: profile.skills,
    languages: profile.languages,
    experiences: profile.experiences,
    education: profile.education,
    links: profile.links,
    tags: profile.tags,
    confidence: profile.confidence,
  };
}

/** A failed usage row must not fail the document: logged and forgotten. */
async function recordUsageSafely(
  db: Db,
  orgId: string,
  kind: AiUsageKind,
  model: string | null,
  tokensIn: number,
  tokensOut: number,
): Promise<void> {
  try {
    await db.recordUsage(orgId, kind, model, tokensIn, tokensOut);
  } catch (error) {
    logError("usage_record_failed", error, { orgId, kind });
  }
}

export async function processDocument(id: string, deps: PipelineDeps): Promise<ProcessOutcome> {
  const startedAt = Date.now();
  let doc: DocumentRow | null;
  try {
    doc = await deps.db.claimDocument(id);
  } catch (error) {
    logError("claim_failed", error, { documentId: id });
    countDocument("skipped");
    return "skipped";
  }
  if (!doc) {
    logInfo("skipped", { documentId: id, reason: "not queued" });
    countDocument("skipped");
    return "skipped";
  }
  try {
    const outcome = await run(doc, deps);
    logInfo(outcome, { documentId: id, orgId: doc.org_id, ms: Date.now() - startedAt });
    return outcome;
  } catch (error) {
    logError("failed", error, {
      documentId: id,
      orgId: doc.org_id,
      attempts: doc.attempts,
      ms: Date.now() - startedAt,
    });
    countDocument("failed");
    try {
      await deps.db.updateDocument(id, { status: "failed", error: failureMessageOf(error) });
    } catch (updateError) {
      logError("failed_update", updateError, { documentId: id });
    }
    return "failed";
  }
}

async function run(doc: DocumentRow, deps: PipelineDeps): Promise<ProcessOutcome> {
  const { db, config } = deps;

  // Quota first: nothing is downloaded or spent for an organisation at its cap.
  const org = await db.getOrganization(doc.org_id);
  if (!org) {
    throw new PipelineFailure(FAILURE_MESSAGES.generic, {
      cause: new Error(`organisation ${doc.org_id} not found`),
    });
  }
  const used = await db.cvsProcessedThisMonth(org.id);
  if (used >= org.cv_quota_month) {
    // Not an attempt against the document: the claim's increment is undone.
    await db.updateDocument(doc.id, {
      status: "failed",
      error: FAILURE_MESSAGES.quota,
      attempts: Math.max(0, doc.attempts - 1),
    });
    countDocument("quotaRefused");
    logInfo("quota_refused", { documentId: doc.id, orgId: org.id, used, quota: org.cv_quota_month });
    return "quota";
  }

  const buffer = await db.downloadObject(doc.storage_path);
  const sha256 = createHash("sha256").update(buffer).digest("hex");
  if (doc.sha256 !== sha256) {
    try {
      await db.updateDocument(doc.id, { sha256 });
    } catch (error) {
      if (!(error instanceof DuplicateFileError)) throw error;
      const other = await db.findDocumentBySha256(doc.org_id, sha256, doc.id);
      await db.updateDocument(doc.id, {
        candidate_id: other?.candidate_id ?? null,
        status: "processed",
        error: null,
        extraction_method: "none",
        structuring_method: null,
      });
      countDocument("duplicates");
      logInfo("duplicate", {
        documentId: doc.id,
        orgId: doc.org_id,
        duplicateOf: other?.id ?? null,
        candidateId: other?.candidate_id ?? null,
      });
      return "duplicate";
    }
  }

  let extracted: PdfText;
  try {
    extracted = await deps.extractPdf(buffer);
  } catch (error) {
    throw new PipelineFailure(FAILURE_MESSAGES.unreadable, { cause: error });
  }
  const pageCount = extracted.pageCount;
  countPages(pageCount);
  let text = extracted.text;
  let extractionMethod: ExtractionMethod = "pdf-text";

  if (looksScanned(text, pageCount)) {
    if (!deps.ocr) {
      await db.updateDocument(doc.id, {
        status: "needs_ocr",
        error: FAILURE_MESSAGES.scanned,
        page_count: pageCount,
        text_chars: readableChars(text),
        extraction_method: "none",
      });
      countDocument("needsOcr");
      return "needs_ocr";
    }
    let ocr: OcrResult;
    try {
      ocr = await deps.ocr(buffer);
      countOcrCall(true);
    } catch (error) {
      countOcrCall(false);
      throw new PipelineFailure(FAILURE_MESSAGES.generic, { cause: error });
    }
    // OCR is billed by the page: the pages go in tokens_in, the only count the row holds.
    await recordUsageSafely(db, doc.org_id, "ocr", ocr.model, ocr.pagesProcessed, 0);
    text = ocr.text;
    extractionMethod = "ocr";
  }

  text = normaliseText(text, config.maxTextChars);
  if (readableChars(text) < MIN_USABLE_CHARS) {
    throw new PipelineFailure(FAILURE_MESSAGES.unreadable, {
      cause: new Error(`no readable text after ${extractionMethod}`),
    });
  }

  const heuristic = heuristicProfile(text, doc.file_name);
  let profile: Profile;
  let structuringMethod: StructuringMethod;
  if (deps.structure) {
    let answer: { profile: Profile; usage: Usage };
    try {
      answer = await deps.structure(text);
      countModelCall("structure", true);
    } catch (error) {
      countModelCall("structure", false);
      throw new PipelineFailure(FAILURE_MESSAGES.model, { cause: error });
    }
    await recordUsageSafely(
      db,
      doc.org_id,
      "structure",
      answer.usage.model,
      answer.usage.tokensIn,
      answer.usage.tokensOut,
    );
    profile = backfillContacts(answer.profile, heuristic);
    structuringMethod = "model";
  } else {
    profile = heuristic;
    structuringMethod = "heuristic";
  }

  const fingerprint = fingerprintOf(profile);
  const existing = fingerprint ? await db.findCandidateByFingerprint(doc.org_id, fingerprint) : null;
  const merged = existing ? mergeProfiles(profileOfRow(existing), profile) : profile;
  const searchText = searchTextOf(merged);

  // Only after a successful structuring, and never fatal: a candidate
  // without a vector is found by text until the next document refreshes it.
  let embedding: string | null = null;
  if (deps.embed) {
    const embeddingText = embeddingTextOf(merged);
    if (embeddingText) {
      try {
        const { vector, usage } = await deps.embed(embeddingText);
        countModelCall("embed", true);
        embedding = vectorLiteral(vector);
        await recordUsageSafely(db, doc.org_id, "embed", usage.model, usage.tokensIn, usage.tokensOut);
      } catch (error) {
        countModelCall("embed", false);
        logError("embedding_failed", error, { documentId: doc.id, orgId: doc.org_id });
      }
    }
  }

  const write: CandidateWrite = {
    ...candidateFieldsOf(merged),
    fingerprint,
    search_text: searchText,
  };
  if (embedding) write.embedding = embedding;

  let candidateId: string;
  if (existing) {
    await db.updateCandidate(existing.id, write);
    candidateId = existing.id;
  } else {
    const insert: CandidateInsert = {
      ...write,
      org_id: doc.org_id,
      created_by: doc.uploaded_by,
      source: "upload",
    };
    candidateId = await db.insertCandidate(insert);
  }

  await db.updateDocument(doc.id, {
    candidate_id: candidateId,
    status: "processed",
    error: null,
    page_count: pageCount,
    text_chars: text.length,
    extracted_text: text.slice(0, config.maxTextChars),
    extraction_method: extractionMethod,
    structuring_method: structuringMethod,
    processed_at: deps.now().toISOString(),
  });
  countDocument("processed");
  logInfo("candidate_written", {
    documentId: doc.id,
    orgId: doc.org_id,
    candidateId,
    merged: Boolean(existing),
    structuringMethod,
    extractionMethod,
    pages: pageCount,
    textChars: text.length,
    embedding: embedding !== null,
  });
  return "processed";
}
