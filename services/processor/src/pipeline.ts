/**
 * One document, end to end: claim, quota, download, sha256 (a duplicate
 * attaches to the existing candidate and stops), text layer or OCR,
 * normalisation, structuring (model when configured, regexes otherwise;
 * a file the model says is not a CV is set aside `rejected` with the
 * sentence that says so, and no candidate is touched), then, one
 * organisation at a time (mutex.ts), the candidate the person already is
 * (dedup.ts: pinned, email, phone, fingerprint), the merge into it, the
 * search text and the candidate row; then, outside the lock and best
 * effort, the photo (photo.ts: a portrait among the first page's images,
 * written to the `photos` bucket when the candidate has none; it never
 * reaches the model) and the embedding, and the document row with what
 * was done. Any thrown error leaves the document `failed` with one
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
  PHOTO_BUCKET,
  type CandidateInsert,
  type CandidateWrite,
  type Db,
} from "./db.js";
import { findExistingCandidate, type DedupKey } from "./dedup.js";
import {
  embeddingFixSentence,
  isDimensionMismatch,
  noteEmbeddingFailure,
  noteEmbeddingSuccess,
} from "./embedding.js";
import { logError, logInfo, type LogFields } from "./log.js";
import { FAILURE_MESSAGES } from "./messages.js";
import { countDocument, countModelCall, countOcrCall, countPages } from "./metrics.js";
import { ModelError, embedOne, vectorLiteral, type Embedder } from "./model.js";
import { KeyedMutex } from "./mutex.js";
import { ocrPdf, type OcrResult } from "./ocr.js";
import {
  extractPageImages,
  extractPdfText,
  looksScanned,
  normaliseText,
  readableChars,
  type PageImages,
  type PdfText,
} from "./pdf.js";
import { choosePhoto, photoFileOf, photoPathOf, type PhotoFile } from "./photo.js";
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
  type StructuredAnswer,
} from "./structure.js";
import type { DocumentKind, DocumentRow, ExtractionMethod, StructuringMethod } from "./types.js";
import { usageRecorderOf } from "./usage.js";

export interface PipelineDeps {
  db: Db;
  config: ProcessorConfig;
  extractPdf: (buffer: Buffer) => Promise<PdfText>;
  /**
   * The images of page 1 of a PDF with a text layer, for the photo; a
   * thrown error means no photo. `context` names the document in the log.
   */
  pageImages: (buffer: Buffer, context: LogFields) => Promise<PageImages>;
  /** Null when OCR is not configured: scanned PDFs end in needs_ocr. */
  ocr: ((buffer: Buffer) => Promise<OcrResult>) | null;
  /** Null without a model: the heuristic profile is used and nothing is classified. */
  structure: ((text: string) => Promise<StructuredAnswer>) | null;
  /** Null without a model: candidates get no embedding. */
  embed: Embedder | null;
  now: () => Date;
}

export function defaultDeps(config: ProcessorConfig, db: Db): PipelineDeps {
  const model = config.model;
  const ocr = config.ocr;
  return {
    db,
    config,
    extractPdf: (buffer) => extractPdfText(buffer),
    pageImages: (buffer, context) => extractPageImages(buffer, 1, context),
    ocr: ocr ? (buffer) => ocrPdf(buffer, ocr) : null,
    structure: model ? (text) => modelProfile(text, model) : null,
    embed: model ? (text) => embedOne(text, model) : null,
    now: () => new Date(),
  };
}

export type ProcessOutcome =
  | "processed"
  | "rejected"
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

/**
 * The lookup of the person and the write of their row run one
 * organisation at a time: with several documents in flight, two exports
 * of one CV would otherwise both find nobody and both insert, and no
 * database key refuses the second one (an email or a phone is often
 * null). One process on Railway, so an in-process lock is enough.
 */
const candidateWrites = new KeyedMutex();

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
  const recordUsage = usageRecorderOf(db);

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
      if (other?.status === "rejected") {
        // The same file was set aside already: so is this copy, with the
        // same sentence, at no cost (no model call, no processed_at). A
        // "processed" copy leading to no candidate would say nothing.
        await db.updateDocument(doc.id, {
          status: "rejected",
          document_kind: "other",
          error: FAILURE_MESSAGES.notCv,
          extraction_method: "none",
          structuring_method: null,
        });
        countDocument("rejected");
        logInfo("rejected", {
          documentId: doc.id,
          orgId: doc.org_id,
          duplicateOf: other.id,
          reason: "the same file was set aside",
        });
        return "rejected";
      }
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
  /** The OCR answer, kept for its first page's images (the photo). */
  let ocrAnswer: OcrResult | null = null;

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
    await recordUsage(doc.org_id, "ocr", {
      model: ocr.model,
      tokensIn: ocr.pagesProcessed,
      tokensOut: 0,
    });
    text = ocr.text;
    extractionMethod = "ocr";
    ocrAnswer = ocr;
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
  // Only the model classifies; the heuristic path cannot tell a CV from a
  // letter, so it never sets a document aside and leaves the kind unknown.
  let documentKind: DocumentKind | null = null;
  if (deps.structure) {
    let answer: StructuredAnswer;
    try {
      answer = await deps.structure(text);
      countModelCall("structure", true);
    } catch (error) {
      countModelCall("structure", false);
      throw new PipelineFailure(FAILURE_MESSAGES.model, { cause: error });
    }
    await recordUsage(doc.org_id, "structure", answer.usage);
    if (answer.classification.kind === "other") {
      // Set aside, not failed: the text and the reason are kept so the
      // person sees why, and can re-queue it if the model was wrong. The
      // candidate it may have been pinned to is left as it was, untouched.
      await db.updateDocument(doc.id, {
        status: "rejected",
        document_kind: "other",
        error: FAILURE_MESSAGES.notCv,
        page_count: pageCount,
        text_chars: text.length,
        extracted_text: text.slice(0, config.maxTextChars),
        extraction_method: extractionMethod,
        structuring_method: "model",
        processed_at: deps.now().toISOString(),
      });
      countDocument("rejected");
      logInfo("rejected", {
        documentId: doc.id,
        orgId: doc.org_id,
        reason: answer.classification.reason,
      });
      return "rejected";
    }
    profile = backfillContacts(answer.profile, heuristic);
    structuringMethod = "model";
    documentKind = "cv";
  } else {
    profile = heuristic;
    structuringMethod = "heuristic";
  }

  // A document uploaded from a profile page carries that candidate's id: the
  // person chose the target. Otherwise the contact details, then the
  // fingerprint, say whether this person is already in the pool. The
  // fingerprint stored is the merged profile's: the surest identity known.
  const written = await candidateWrites.run(doc.org_id, () => writeCandidate(db, doc, profile));
  const { candidateId, merged } = written;

  // The photo, outside the lock and never fatal: a candidate found with a
  // photo keeps it (the first reading identified them); one without gets
  // the portrait of this CV's first page, when there is one. The file goes
  // to the bucket, the key to the row, and nothing of it to any model.
  let photo = false;
  if (written.photoPath === null) {
    const file = await findPhoto(deps, doc, buffer, ocrAnswer);
    if (file) photo = await writePhoto(db, doc, candidateId, file);
  }

  // Only once the row exists, outside the lock (the call takes a while and
  // must not hold the organisation's other documents), and never fatal: a
  // candidate without a vector is found by text until the re-embed pass or
  // the next document refreshes it. The vector is the merged profile's,
  // what a brief's search compares with. A wrong-width answer is a
  // configuration mistake the log names in full and /health shows
  // (embedding.ts).
  let embedded = false;
  if (deps.embed) {
    const embeddingText = embeddingTextOf(merged);
    if (embeddingText) {
      let embedding: string | null = null;
      try {
        const { vector, usage } = await deps.embed(embeddingText);
        countModelCall("embed", true);
        noteEmbeddingSuccess();
        embedding = vectorLiteral(vector);
        await recordUsage(doc.org_id, "embed", usage);
      } catch (error) {
        countModelCall("embed", false);
        noteEmbeddingFailure(error);
        if (isDimensionMismatch(error)) {
          logError("embedding_mismatch", error, {
            documentId: doc.id,
            orgId: doc.org_id,
            fix: embeddingFixSentence(config.model?.embeddingModel ?? null, error.dimensions),
          });
        } else {
          logError("embedding_failed", error, { documentId: doc.id, orgId: doc.org_id });
        }
      }
      if (embedding !== null) {
        try {
          await db.updateCandidate(candidateId, { embedding });
          embedded = true;
        } catch (error) {
          // The re-embed pass computes it again: one call lost, no candidate.
          logError("embedding_write_failed", error, { documentId: doc.id, orgId: doc.org_id, candidateId });
        }
      }
    }
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
    document_kind: documentKind,
    processed_at: deps.now().toISOString(),
  });
  countDocument("processed");
  logInfo("candidate_written", {
    documentId: doc.id,
    orgId: doc.org_id,
    candidateId,
    merged: written.matchedBy !== null,
    matchedBy: written.matchedBy,
    reactivated: written.reactivated,
    structuringMethod,
    extractionMethod,
    pages: pageCount,
    textChars: text.length,
    embedding: embedded,
    photo,
  });
  return "processed";
}

/**
 * The portrait of the first page as a file, or null: the largest image
 * that fits, from the OCR answer when the PDF was scanned (as the OCR cut
 * it out), else from the PDF's own images (downscaled and encoded as a
 * PNG). A failure to read the images is a log line and no photo: the
 * document is processed all the same.
 */
async function findPhoto(
  deps: PipelineDeps,
  doc: DocumentRow,
  buffer: Buffer,
  ocrAnswer: OcrResult | null,
): Promise<PhotoFile | null> {
  try {
    if (ocrAnswer) {
      const page = ocrAnswer.firstPage;
      if (!page) return null;
      const image = choosePhoto(page.images, page.pageWidth);
      return image ? { bytes: image.bytes, contentType: image.contentType } : null;
    }
    const page = await deps.pageImages(buffer, { documentId: doc.id, orgId: doc.org_id });
    const image = choosePhoto(page.images, page.pageWidth);
    return image ? photoFileOf(image) : null;
  } catch (error) {
    logError("photo_read_failed", error, { documentId: doc.id, orgId: doc.org_id });
    return null;
  }
}

/** Uploads the photo and writes its key on the row; false, logged, when either failed. */
async function writePhoto(db: Db, doc: DocumentRow, candidateId: string, file: PhotoFile): Promise<boolean> {
  const path = photoPathOf(doc.org_id, candidateId, file.contentType);
  try {
    await db.uploadObject(PHOTO_BUCKET, path, file.bytes, file.contentType);
    await db.updateCandidate(candidateId, { photo_path: path });
  } catch (error) {
    logError("photo_write_failed", error, { documentId: doc.id, orgId: doc.org_id, candidateId });
    return false;
  }
  logInfo("photo_written", {
    documentId: doc.id,
    orgId: doc.org_id,
    candidateId,
    contentType: file.contentType,
    bytes: file.bytes.byteLength,
  });
  return true;
}

interface CandidateWritten {
  candidateId: string;
  /** The profile the row now holds: the new reading merged into the existing one, or the reading alone. */
  merged: Profile;
  /** The key that found the existing candidate; null when a row was inserted. */
  matchedBy: DedupKey | null;
  /** True when the candidate found was archived and this CV put them back in the pool. */
  reactivated: boolean;
  /** The photo the candidate already had; null for a new row or one without. */
  photoPath: string | null;
}

/**
 * The section the organisation's lock covers: who this person already is,
 * the merge, and the row (updated or inserted, without the embedding).
 */
async function writeCandidate(db: Db, doc: DocumentRow, profile: Profile): Promise<CandidateWritten> {
  const match = await findExistingCandidate(db, doc.org_id, doc, profile);
  const existing = match?.candidate ?? null;
  const merged = existing ? mergeProfiles(profileOfRow(existing), profile) : profile;
  const write: CandidateWrite = {
    ...candidateFieldsOf(merged),
    fingerprint: fingerprintOf(merged),
    search_text: searchTextOf(merged),
  };
  if (existing) {
    // A fresh CV of an archived person puts them back in the pool: the
    // document would otherwise be "processed" into a row no search shows.
    const reactivated = existing.status === "archived";
    if (reactivated) write.status = "active";
    await db.updateCandidate(existing.id, write);
    if (reactivated) {
      logInfo("candidate_reactivated", { documentId: doc.id, orgId: doc.org_id, candidateId: existing.id });
    }
    return {
      candidateId: existing.id,
      merged,
      matchedBy: match?.by ?? null,
      reactivated,
      photoPath: existing.photo_path,
    };
  }
  const insert: CandidateInsert = {
    ...write,
    org_id: doc.org_id,
    created_by: doc.uploaded_by,
    source: "upload",
  };
  return {
    candidateId: await db.insertCandidate(insert),
    merged,
    matchedBy: null,
    reactivated: false,
    photoPath: null,
  };
}
