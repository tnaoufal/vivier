/**
 * The database, behind one small typed interface. supabase-js with the
 * service role key (RLS bypassed: every query names the organisation it
 * works on), untyped on the wire: results are cast to the row shapes of
 * types.ts here and nowhere else, so the pipeline stays strictly typed
 * and the fake in the tests implements the same `Db` interface.
 *
 * The claim is atomic through the `status = 'queued'` condition: two
 * processors asking for the same document see one empty answer. A
 * unique violation (23505) on `documents.sha256` is surfaced as
 * DuplicateFileError, the pipeline's "same file, same organisation" case.
 *
 * The candidate lookups the deduplication runs (dedup.ts) read the
 * contact columns: the email case-insensitively (ILIKE: it filters the
 * organisation's rows through the org_id index, the `lower(email)` index
 * cannot serve a pattern), the phone by the end of `phone_digits` (a
 * GENERATED column the database computes: never written here; a suffix
 * LIKE filters the organisation's rows the same way), the fingerprint
 * exactly through its index. Each one prefers an active candidate to an
 * archived one, so a fresh CV meets the person in the pool first.
 *
 * Storage: the CVs are read from the private `cvs` bucket, the photos
 * written to (and removed from) the private `photos` bucket; the web app
 * signs their URLs for the members.
 */
import { createClient } from "@supabase/supabase-js";

import type { SupabaseConfig } from "./config.js";
import { FAILURE_MESSAGES } from "./messages.js";
import type {
  AiUsageKind,
  CandidateRow,
  CandidateStatus,
  DocumentRow,
  OrganizationLimits,
} from "./types.js";

/** The private buckets the processor touches: the CVs it reads, the photos it writes. */
export type StorageBucket = "cvs" | "photos";
export const CV_BUCKET: StorageBucket = "cvs";
export const PHOTO_BUCKET: StorageBucket = "photos";
/** Claims before a stale document is left failed instead of re-queued. */
export const MAX_ATTEMPTS = 3;
/** A document in `processing` for longer than this lost its processor (crash, restart). */
export const STALE_AFTER_MS = 10 * 60_000;

export class DbError extends Error {
  readonly code: string | null;

  constructor(operation: string, message: string, code: string | null = null) {
    super(`${operation}: ${message}`);
    this.name = "DbError";
    this.code = code;
  }
}

/** Another document of the organisation already holds this sha256. */
export class DuplicateFileError extends DbError {
  constructor() {
    super("updateDocument", "another document of this organisation has the same content", "23505");
    this.name = "DuplicateFileError";
  }
}

export type DocumentPatch = Partial<
  Pick<
    DocumentRow,
    | "candidate_id"
    | "sha256"
    | "status"
    | "error"
    | "attempts"
    | "page_count"
    | "text_chars"
    | "extracted_text"
    | "extraction_method"
    | "structuring_method"
    | "document_kind"
    | "processed_at"
  >
>;

export type CandidateFields = Pick<
  CandidateRow,
  | "full_name"
  | "email"
  | "phone"
  | "headline"
  | "location"
  | "years_experience"
  | "availability"
  | "summary"
  | "skills"
  | "languages"
  | "experiences"
  | "education"
  | "links"
  | "tags"
  | "confidence"
>;

export type CandidateWrite = Partial<CandidateFields> & {
  fingerprint?: string | null;
  search_text?: string | null;
  /** The photo's key in the `photos` bucket; written once, when the candidate had none. */
  photo_path?: string | null;
  /** A pgvector literal ("[0.1,0.2,...]"); absent keeps the stored vector. */
  embedding?: string;
  /** Written only to put an archived candidate back in the pool when a fresh CV of theirs arrives. */
  status?: CandidateStatus;
  /** Computed by the database from `phone`: a write that carries it is refused by PostgREST. */
  phone_digits?: never;
};

export type CandidateInsert = CandidateWrite & {
  org_id: string;
  created_by: string | null;
  source: "upload";
};

export interface ExpiredCandidate {
  candidate_id: string;
  org_id: string;
  reason: string;
}

export interface Db {
  /** Moves a queued document to processing (attempts + 1); null when it is not queued any more. */
  claimDocument(id: string): Promise<DocumentRow | null>;
  /** Oldest queued documents first. */
  listQueued(limit: number): Promise<string[]>;
  countQueued(): Promise<number>;
  /** Processing documents older than STALE_AFTER_MS: back to queued, or failed past MAX_ATTEMPTS. */
  resetStale(now: Date): Promise<{ requeued: number; failed: number }>;
  getDocument(id: string): Promise<DocumentRow | null>;
  updateDocument(id: string, patch: DocumentPatch): Promise<void>;
  findDocumentBySha256(orgId: string, sha256: string, excludeId: string): Promise<DocumentRow | null>;
  /** The candidate with this fingerprint: an active one first, then the most recently updated. */
  findCandidateByFingerprint(orgId: string, fingerprint: string): Promise<CandidateRow | null>;
  /** The candidate whose email is `email` whatever the case (exact, no wildcard): active first, then the most recently updated. */
  findCandidateByEmail(orgId: string, email: string): Promise<CandidateRow | null>;
  /** The candidate whose `phone_digits` ends with `digits` (the last nine): active first, then the most recently updated. */
  findCandidateByPhoneDigits(orgId: string, digits: string): Promise<CandidateRow | null>;
  /** The candidate a document was attached to before processing (same organisation), or null. */
  getCandidateById(orgId: string, id: string): Promise<CandidateRow | null>;
  /**
   * Active candidates with no vector, most recently updated first, from
   * the `offset`-th on: what the re-embed pass refreshes, page by page
   * when the first rows have nothing to embed.
   */
  listCandidatesWithoutEmbedding(limit: number, offset?: number): Promise<CandidateRow[]>;
  /** Answers the new row's id. */
  insertCandidate(values: CandidateInsert): Promise<string>;
  updateCandidate(id: string, patch: CandidateWrite): Promise<void>;
  getOrganization(orgId: string): Promise<OrganizationLimits | null>;
  cvsProcessedThisMonth(orgId: string): Promise<number>;
  expiredCandidates(limit: number): Promise<ExpiredCandidate[]>;
  listDocumentsOfCandidate(candidateId: string): Promise<Array<{ id: string; storage_path: string }>>;
  deleteCandidate(id: string): Promise<void>;
  recordUsage(
    orgId: string,
    kind: AiUsageKind,
    model: string | null,
    tokensIn: number,
    tokensOut: number,
  ): Promise<void>;
  /** The bytes of an object of the `cvs` bucket. */
  downloadObject(path: string): Promise<Buffer>;
  /** Writes (or replaces) one object of `bucket`. */
  uploadObject(bucket: StorageBucket, path: string, bytes: Uint8Array, contentType: string): Promise<void>;
  /** Removes objects of `bucket` (the `cvs` bucket when unsaid); nothing to remove is not an error. */
  removeObjects(paths: string[], bucket?: StorageBucket): Promise<void>;
}

interface QueryFailure {
  message: string;
  code?: string | null;
}

function fail(operation: string, error: QueryFailure): never {
  const code = typeof error.code === "string" ? error.code : null;
  throw new DbError(operation, error.message, code);
}

function rowsOf<T>(data: unknown): T[] {
  return Array.isArray(data) ? (data as T[]) : [];
}

function rowOf<T>(data: unknown): T | null {
  return data && typeof data === "object" ? (data as T) : null;
}

/**
 * A LIKE/ILIKE pattern that matches `value` literally: `%`, `_` and the
 * escape character itself are escaped (an email often holds an underscore,
 * which would otherwise match any character).
 */
export function likeLiteral(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

export function createDb(config: SupabaseConfig): Db {
  const client = createClient(config.url, config.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const getDocument: Db["getDocument"] = async (id) => {
    const { data, error } = await client.from("documents").select("*").eq("id", id).maybeSingle();
    if (error) fail("getDocument", error);
    return rowOf<DocumentRow>(data);
  };

  const updateDocument: Db["updateDocument"] = async (id, patch) => {
    const { error } = await client.from("documents").update(patch).eq("id", id);
    if (error) {
      if (error.code === "23505") throw new DuplicateFileError();
      fail("updateDocument", error);
    }
  };

  return {
    getDocument,
    updateDocument,

    claimDocument: async (id) => {
      // PostgREST cannot add one to a column in place: the row is read for
      // its attempts, and the `status = 'queued'` condition keeps the
      // claim atomic (a second claimer updates no row).
      const current = await getDocument(id);
      if (!current || current.status !== "queued") return null;
      const { data, error } = await client
        .from("documents")
        .update({ status: "processing", attempts: current.attempts + 1 })
        .eq("id", id)
        .eq("status", "queued")
        .select("*");
      if (error) fail("claimDocument", error);
      return rowsOf<DocumentRow>(data)[0] ?? null;
    },

    listQueued: async (limit) => {
      const { data, error } = await client
        .from("documents")
        .select("id")
        .eq("status", "queued")
        .order("created_at", { ascending: true })
        .limit(Math.max(1, Math.floor(limit)));
      if (error) fail("listQueued", error);
      return rowsOf<{ id: string }>(data).map((row) => row.id);
    },

    countQueued: async () => {
      const { count, error } = await client
        .from("documents")
        .select("id", { count: "exact", head: true })
        .eq("status", "queued");
      if (error) fail("countQueued", error);
      return typeof count === "number" ? count : 0;
    },

    resetStale: async (now) => {
      const cutoff = new Date(now.getTime() - STALE_AFTER_MS).toISOString();
      const exhausted = await client
        .from("documents")
        .update({ status: "failed", error: FAILURE_MESSAGES.generic })
        .eq("status", "processing")
        .lt("updated_at", cutoff)
        .gte("attempts", MAX_ATTEMPTS)
        .select("id");
      if (exhausted.error) fail("resetStale", exhausted.error);
      const requeued = await client
        .from("documents")
        .update({ status: "queued" })
        .eq("status", "processing")
        .lt("updated_at", cutoff)
        .lt("attempts", MAX_ATTEMPTS)
        .select("id");
      if (requeued.error) fail("resetStale", requeued.error);
      return {
        requeued: rowsOf(requeued.data).length,
        failed: rowsOf(exhausted.data).length,
      };
    },

    findDocumentBySha256: async (orgId, sha256, excludeId) => {
      const { data, error } = await client
        .from("documents")
        .select("*")
        .eq("org_id", orgId)
        .eq("sha256", sha256)
        .neq("id", excludeId)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (error) fail("findDocumentBySha256", error);
      return rowOf<DocumentRow>(data);
    },

    // 'active' sorts before 'archived': an active namesake wins over an
    // archived one, and the archived one is only met when it is alone.
    findCandidateByFingerprint: async (orgId, fingerprint) => {
      const { data, error } = await client
        .from("candidates")
        .select("*")
        .eq("org_id", orgId)
        .eq("fingerprint", fingerprint)
        .order("status", { ascending: true })
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) fail("findCandidateByFingerprint", error);
      return rowOf<CandidateRow>(data);
    },

    findCandidateByEmail: async (orgId, email) => {
      const { data, error } = await client
        .from("candidates")
        .select("*")
        .eq("org_id", orgId)
        .ilike("email", likeLiteral(email))
        .order("status", { ascending: true })
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) fail("findCandidateByEmail", error);
      return rowOf<CandidateRow>(data);
    },

    findCandidateByPhoneDigits: async (orgId, digits) => {
      const { data, error } = await client
        .from("candidates")
        .select("*")
        .eq("org_id", orgId)
        .like("phone_digits", `%${likeLiteral(digits)}`)
        .order("status", { ascending: true })
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) fail("findCandidateByPhoneDigits", error);
      return rowOf<CandidateRow>(data);
    },

    getCandidateById: async (orgId, id) => {
      const { data, error } = await client
        .from("candidates")
        .select("*")
        .eq("org_id", orgId)
        .eq("id", id)
        .maybeSingle();
      if (error) fail("getCandidateById", error);
      return rowOf<CandidateRow>(data);
    },

    listCandidatesWithoutEmbedding: async (limit, offset = 0) => {
      const size = Math.max(1, Math.floor(limit));
      const from = Math.max(0, Math.floor(offset));
      const { data, error } = await client
        .from("candidates")
        .select("*")
        .eq("status", "active")
        .is("embedding", null)
        .order("updated_at", { ascending: false })
        .range(from, from + size - 1);
      if (error) fail("listCandidatesWithoutEmbedding", error);
      return rowsOf<CandidateRow>(data);
    },

    insertCandidate: async (values) => {
      const { data, error } = await client.from("candidates").insert(values).select("id").single();
      if (error) fail("insertCandidate", error);
      const id = rowOf<{ id?: unknown }>(data)?.id;
      if (typeof id !== "string") throw new DbError("insertCandidate", "no id answered");
      return id;
    },

    updateCandidate: async (id, patch) => {
      const { error } = await client.from("candidates").update(patch).eq("id", id);
      if (error) fail("updateCandidate", error);
    },

    getOrganization: async (orgId) => {
      const { data, error } = await client
        .from("organizations")
        .select("id, plan, cv_quota_month, retention_months")
        .eq("id", orgId)
        .maybeSingle();
      if (error) fail("getOrganization", error);
      return rowOf<OrganizationLimits>(data);
    },

    cvsProcessedThisMonth: async (orgId) => {
      const { data, error } = await client.rpc("cvs_processed_this_month", { p_org: orgId });
      if (error) fail("cvsProcessedThisMonth", error);
      const count = Number(data ?? 0);
      return Number.isFinite(count) ? count : 0;
    },

    expiredCandidates: async (limit) => {
      const { data, error } = await client.rpc("expired_candidates", {
        p_limit: Math.max(1, Math.floor(limit)),
      });
      if (error) fail("expiredCandidates", error);
      return rowsOf<ExpiredCandidate>(data).filter(
        (row) => typeof row.candidate_id === "string" && typeof row.org_id === "string",
      );
    },

    listDocumentsOfCandidate: async (candidateId) => {
      const { data, error } = await client
        .from("documents")
        .select("id, storage_path")
        .eq("candidate_id", candidateId);
      if (error) fail("listDocumentsOfCandidate", error);
      return rowsOf<{ id: string; storage_path: string }>(data);
    },

    deleteCandidate: async (id) => {
      const { error } = await client.from("candidates").delete().eq("id", id);
      if (error) fail("deleteCandidate", error);
    },

    recordUsage: async (orgId, kind, model, tokensIn, tokensOut) => {
      const { error } = await client.from("ai_usage").insert({
        org_id: orgId,
        kind,
        model,
        tokens_in: Math.max(0, Math.floor(tokensIn)),
        tokens_out: Math.max(0, Math.floor(tokensOut)),
      });
      if (error) fail("recordUsage", error);
    },

    downloadObject: async (path) => {
      const { data, error } = await client.storage.from(CV_BUCKET).download(path);
      if (error) fail("downloadObject", { message: error.message });
      if (!data) throw new DbError("downloadObject", "no content answered");
      return Buffer.from(await data.arrayBuffer());
    },

    uploadObject: async (bucket, path, bytes, contentType) => {
      const { error } = await client.storage.from(bucket).upload(path, bytes, { contentType, upsert: true });
      if (error) fail("uploadObject", { message: error.message });
    },

    removeObjects: async (paths, bucket = CV_BUCKET) => {
      if (paths.length === 0) return;
      const { error } = await client.storage.from(bucket).remove(paths);
      if (error) fail("removeObjects", { message: error.message });
    },
  };
}
