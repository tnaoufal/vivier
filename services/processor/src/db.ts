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
 *
 * The analysis as a job (evolution 7): the runner claims the queued
 * searches and the running ones whose heartbeat went stale (one
 * conditional PATCH each, so two processors never hold the same run),
 * reads and writes the job columns of `searches`, the brief's reading,
 * the snapshot's rows (search_triage: the verdicts through record_triage,
 * the scores through record_screen, both first-write-wins in the
 * database), the profiles as cards (the triage's columns only: no
 * contact, no link, no photo, no summary, no CV text) or in full, the
 * results through merge_search_results, and the shortlist items an
 * assessment is carried to. The photo pass reads the candidates without
 * a photo it has not checked, with their processed documents.
 */
import { createClient } from "@supabase/supabase-js";

import type { SupabaseConfig } from "./config.js";
import { FAILURE_MESSAGES } from "./messages.js";
import type {
  AiUsageKind,
  BriefJobPatch,
  BriefJobRow,
  CandidateRow,
  CandidateStatus,
  CardProfile,
  DocumentRow,
  FullProfile,
  MatchResult,
  OrganizationLimits,
  PhotoCandidateRow,
  PhotoDocumentRow,
  ProfileColumns,
  ScreenWrite,
  SearchJobPatch,
  SearchJobRow,
  ShortlistItemJobRow,
  TriageCounts,
  TriageFilter,
  TriageRow,
  TriageWrite,
} from "./types.js";

/** The private buckets the processor touches: the CVs it reads, the photos it writes. */
export type StorageBucket = "cvs" | "photos";
export const CV_BUCKET: StorageBucket = "cvs";
export const PHOTO_BUCKET: StorageBucket = "photos";
/** Claims before a stale document is left failed instead of re-queued. */
export const MAX_ATTEMPTS = 3;
/** A document in `processing` for longer than this lost its processor (crash, restart). */
export const STALE_AFTER_MS = 10 * 60_000;

/** The job columns of a search: never its results, which getResults reads apart. */
const SEARCH_JOB_COLUMNS =
  "id,org_id,brief_id,method,criteria,pool_size,result_count,assessed_count,match_count,near_count,status,stage,progress_done,progress_total,stop_requested,error,started_at,finished_at,heartbeat_at,runner,analysis_model,ran_by,created_at";
const BRIEF_JOB_COLUMNS = "id,org_id,title,description,criteria,role_profile,status";
const TRIAGE_COLUMNS =
  "search_id,org_id,candidate_id,verdict,reason,model,read_at,score,score_reason,scored_at,forced,attempts";
/** The triage's columns (TRIAGE_PROFILE_COLUMNS of the package, with the organisation): the name and the place only to take them out of the card. */
const CARD_COLUMNS =
  "id,org_id,full_name,location,headline,years_experience,experiences,education,skills";
/** What the assessment reads (PROFILE_COLUMNS of the web app's briefs.functions.ts): never the email or the phone. */
const FULL_COLUMNS =
  "id,org_id,full_name,headline,summary,skills,languages,location,years_experience,availability,education,experiences,search_text";
/** The most ids one query names (the gateway refuses a URL past 16 KB). */
const IDS_PER_QUERY = 100;
/** The most entries one merge_search_results call carries. */
const MERGE_CHUNK = 200;
/** The verdicts of the profiles the screening and the promotion read. */
const KEPT_VERDICTS = ["yes", "close"];

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
  /** When a portrait was last looked for in the candidate's CV (the photo pass, or the pipeline that just read one). */
  photo_checked_at?: string | null;
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
  findDocumentBySha256(
    orgId: string,
    sha256: string,
    excludeId: string,
  ): Promise<DocumentRow | null>;
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
  listDocumentsOfCandidate(
    candidateId: string,
  ): Promise<Array<{ id: string; storage_path: string }>>;
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
  uploadObject(
    bucket: StorageBucket,
    path: string,
    bytes: Uint8Array,
    contentType: string,
  ): Promise<void>;
  /** Removes objects of `bucket` (the `cvs` bucket when unsaid); nothing to remove is not an error. */
  removeObjects(paths: string[], bucket?: StorageBucket): Promise<void>;

  // --- the analysis as a job ---------------------------------------------
  /**
   * Up to `limit` runs to work on, oldest first: the queued rows, and the
   * running rows whose heartbeat is older than `staleBefore` (or missing:
   * a crash, a redeploy). Each one is set to running under `runner` with a
   * fresh heartbeat (and a start time when it had none) in one PATCH
   * conditioned on the state it was read in, so two processors never hold
   * the same run. Answers the rows as claimed.
   */
  claimAnalyses(runner: string, staleBefore: Date, limit: number): Promise<SearchJobRow[]>;
  getSearch(id: string): Promise<SearchJobRow | null>;
  patchSearch(id: string, patch: SearchJobPatch): Promise<void>;
  getBrief(id: string): Promise<BriefJobRow | null>;
  /** The one reading of a brief, the profile and the criteria in one write. */
  patchBrief(id: string, patch: BriefJobPatch): Promise<void>;
  /** The snapshot of the pool (start_triage): one row per active candidate the search lacks; answers how many were added. */
  startTriage(orgId: string, searchId: string): Promise<number>;
  /** The snapshot's rows that match the filter, ordered by candidate id, `limit` at most, from after `after`. */
  listTriage(searchId: string, filter: TriageFilter): Promise<TriageRow[]>;
  countTriage(searchId: string): Promise<TriageCounts>;
  /** The verdicts written in one statement (record_triage: the first write wins); answers how many rows took one. */
  recordTriage(
    orgId: string,
    searchId: string,
    model: string | null,
    rows: readonly TriageWrite[],
  ): Promise<number>;
  /** The scores written in one statement (record_screen: the first write wins); answers how many rows took one. */
  recordScreen(orgId: string, searchId: string, rows: readonly ScreenWrite[]): Promise<number>;
  /** One more failed batch on these cards (bump_triage_attempts); answers how many rows it touched. */
  bumpAttempts(searchId: string, candidateIds: readonly string[]): Promise<number>;
  /**
   * The active profiles among `ids` of the organisation, in lots of
   * IDS_PER_QUERY: "card" reads the triage's columns alone (never the
   * contacts, the links, the photo, the summary or the CV text), "full"
   * what the assessment reads. One archived or erased since is absent.
   */
  loadProfiles(orgId: string, ids: readonly string[], columns: "card"): Promise<CardProfile[]>;
  loadProfiles(orgId: string, ids: readonly string[], columns: "full"): Promise<FullProfile[]>;
  /** The entries written into the search's results (merge_search_results, MERGE_CHUNK a call); answers the entries the row holds after. */
  mergeResults(orgId: string, searchId: string, entries: readonly MatchResult[]): Promise<number>;
  /** The search's stored results (an empty list for a row without any). */
  getResults(searchId: string): Promise<MatchResult[]>;
  /** The items of the brief's shortlist for these candidates (none when the brief has no shortlist). */
  listShortlistItemsFor(
    orgId: string,
    briefId: string,
    candidateIds: readonly string[],
  ): Promise<ShortlistItemJobRow[]>;
  patchShortlistItemMatch(id: string, orgId: string, match: MatchResult): Promise<void>;

  // --- the photos ---------------------------------------------------------
  /** Up to `limit` candidates with no photo and no check yet that have a processed document, their processed documents newest first. */
  listCandidatesForPhoto(limit: number): Promise<PhotoCandidateRow[]>;
  /** The candidate was looked at: no portrait, or none worth keeping; never looked at again by the pass. */
  markPhotoChecked(id: string): Promise<void>;
  /** The portrait's key, and the check with it. */
  setPhotoPath(id: string, path: string): Promise<void>;
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

  /** Lots of IDS_PER_QUERY ids, so no URL names more than a hundred. */
  const lotsOf = (ids: readonly string[]): string[][] => {
    const unique = [...new Set(ids)];
    const out: string[][] = [];
    for (let index = 0; index < unique.length; index += IDS_PER_QUERY)
      out.push(unique.slice(index, index + IDS_PER_QUERY));
    return out;
  };

  function loadProfiles(
    orgId: string,
    ids: readonly string[],
    columns: "card",
  ): Promise<CardProfile[]>;
  function loadProfiles(
    orgId: string,
    ids: readonly string[],
    columns: "full",
  ): Promise<FullProfile[]>;
  async function loadProfiles(
    orgId: string,
    ids: readonly string[],
    columns: ProfileColumns,
  ): Promise<CardProfile[] | FullProfile[]> {
    const select = columns === "card" ? CARD_COLUMNS : FULL_COLUMNS;
    const out: (CardProfile | FullProfile)[] = [];
    for (const lot of lotsOf(ids)) {
      const { data, error } = await client
        .from("candidates")
        .select(select)
        .eq("org_id", orgId)
        .eq("status", "active")
        .in("id", lot);
      if (error) fail("loadProfiles", error);
      for (const row of rowsOf<CardProfile | FullProfile>(data)) {
        if (row.org_id === orgId) out.push(row);
      }
    }
    return out as CardProfile[] | FullProfile[];
  }

  /** The number an RPC answered, 0 for anything else. */
  const countOf = (value: unknown): number => {
    const count = Number(value ?? 0);
    return Number.isFinite(count) ? count : 0;
  };

  /** A HEAD count on search_triage: every row, the unread ones, the kept ones the screening read, or one verdict's. */
  const triageCount = async (
    searchId: string,
    kind: "total" | "pending" | "scored" | TriageWrite["verdict"],
  ): Promise<number> => {
    let query = client
      .from("search_triage")
      .select("candidate_id", { count: "exact", head: true })
      .eq("search_id", searchId);
    if (kind === "pending") query = query.is("verdict", null);
    else if (kind === "scored")
      query = query.in("verdict", KEPT_VERDICTS).not("scored_at", "is", null);
    else if (kind !== "total") query = query.eq("verdict", kind);
    const { count, error } = await query;
    if (error) fail("countTriage", error);
    return typeof count === "number" ? Math.max(0, count) : 0;
  };

  return {
    loadProfiles,
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

    claimAnalyses: async (runner, staleBefore, limit) => {
      const cutoff = staleBefore.toISOString();
      const size = Math.max(1, Math.floor(limit));
      const stale = `and(status.eq.running,or(heartbeat_at.is.null,heartbeat_at.lt.${cutoff}))`;
      const { data, error } = await client
        .from("searches")
        .select(SEARCH_JOB_COLUMNS)
        .or(`status.eq.queued,${stale}`)
        .order("created_at", { ascending: true })
        .limit(size);
      if (error) fail("claimAnalyses", error);
      const claimed: SearchJobRow[] = [];
      const now = new Date().toISOString();
      for (const row of rowsOf<SearchJobRow>(data)) {
        const patch: SearchJobPatch = { status: "running", runner, heartbeat_at: now };
        if (!row.started_at) patch.started_at = now;
        // The claim holds only when the row is still as it was read: a
        // queued row still queued, a stale row still stale.
        const update = client.from("searches").update(patch).eq("id", row.id);
        const conditioned =
          row.status === "queued"
            ? update.eq("status", "queued")
            : update.eq("status", "running").or(`heartbeat_at.is.null,heartbeat_at.lt.${cutoff}`);
        const taken = await conditioned.select(SEARCH_JOB_COLUMNS);
        if (taken.error) fail("claimAnalyses", taken.error);
        const won = rowsOf<SearchJobRow>(taken.data)[0];
        if (won) claimed.push(won);
      }
      return claimed;
    },

    getSearch: async (id) => {
      const { data, error } = await client
        .from("searches")
        .select(SEARCH_JOB_COLUMNS)
        .eq("id", id)
        .maybeSingle();
      if (error) fail("getSearch", error);
      return rowOf<SearchJobRow>(data);
    },

    patchSearch: async (id, patch) => {
      const { error } = await client.from("searches").update(patch).eq("id", id);
      if (error) fail("patchSearch", error);
    },

    getBrief: async (id) => {
      const { data, error } = await client
        .from("briefs")
        .select(BRIEF_JOB_COLUMNS)
        .eq("id", id)
        .maybeSingle();
      if (error) fail("getBrief", error);
      return rowOf<BriefJobRow>(data);
    },

    patchBrief: async (id, patch) => {
      const { error } = await client.from("briefs").update(patch).eq("id", id);
      if (error) fail("patchBrief", error);
    },

    startTriage: async (orgId, searchId) => {
      const { data, error } = await client.rpc("start_triage", {
        p_org: orgId,
        p_search: searchId,
      });
      if (error) fail("startTriage", error);
      return countOf(data);
    },

    listTriage: async (searchId, filter) => {
      let query = client.from("search_triage").select(TRIAGE_COLUMNS).eq("search_id", searchId);
      if (filter.verdict === "pending") query = query.is("verdict", null);
      else if (filter.verdict === "kept") query = query.in("verdict", KEPT_VERDICTS);
      else if (filter.verdict) query = query.eq("verdict", filter.verdict);
      if (filter.unscored) query = query.is("scored_at", null);
      if (filter.after !== undefined) query = query.gt("candidate_id", filter.after);
      const { data, error } = await query
        .order("candidate_id", { ascending: true })
        .limit(Math.max(1, Math.floor(filter.limit)));
      if (error) fail("listTriage", error);
      return rowsOf<TriageRow>(data);
    },

    countTriage: async (searchId) => {
      const [total, pending, yes, close, no, unknown, scored] = await Promise.all([
        triageCount(searchId, "total"),
        triageCount(searchId, "pending"),
        triageCount(searchId, "yes"),
        triageCount(searchId, "close"),
        triageCount(searchId, "no"),
        triageCount(searchId, "unknown"),
        triageCount(searchId, "scored"),
      ]);
      return { total, pending, yes, close, no, unknown, scored };
    },

    recordTriage: async (orgId, searchId, model, rows) => {
      if (!rows.length) return 0;
      const { data, error } = await client.rpc("record_triage", {
        p_org: orgId,
        p_search: searchId,
        p_model: model,
        p_rows: rows.map((row) => ({
          candidate_id: row.candidate_id,
          verdict: row.verdict,
          reason: row.reason,
        })),
      });
      if (error) fail("recordTriage", error);
      return countOf(data);
    },

    recordScreen: async (orgId, searchId, rows) => {
      if (!rows.length) return 0;
      const { data, error } = await client.rpc("record_screen", {
        p_org: orgId,
        p_search: searchId,
        p_rows: rows.map((row) => ({
          candidate_id: row.candidate_id,
          score: row.score,
          reason: row.reason,
        })),
      });
      if (error) fail("recordScreen", error);
      return countOf(data);
    },

    bumpAttempts: async (searchId, candidateIds) => {
      const ids = [...new Set(candidateIds)];
      if (!ids.length) return 0;
      const { data, error } = await client.rpc("bump_triage_attempts", {
        p_search: searchId,
        p_candidates: ids,
      });
      if (error) fail("bumpAttempts", error);
      return countOf(data);
    },

    mergeResults: async (orgId, searchId, entries) => {
      let held = 0;
      for (let start = 0; start < entries.length; start += MERGE_CHUNK) {
        const { data, error } = await client.rpc("merge_search_results", {
          p_org: orgId,
          p_search: searchId,
          p_results: entries.slice(start, start + MERGE_CHUNK),
        });
        if (error) fail("mergeResults", error);
        held = countOf(data);
      }
      return held;
    },

    getResults: async (searchId) => {
      const { data, error } = await client
        .from("searches")
        .select("results")
        .eq("id", searchId)
        .maybeSingle();
      if (error) fail("getResults", error);
      const results = rowOf<{ results?: unknown }>(data)?.results;
      return Array.isArray(results) ? (results as MatchResult[]) : [];
    },

    listShortlistItemsFor: async (orgId, briefId, candidateIds) => {
      const shortlist = await client
        .from("shortlists")
        .select("id")
        .eq("org_id", orgId)
        .eq("brief_id", briefId)
        .limit(1)
        .maybeSingle();
      if (shortlist.error) fail("listShortlistItemsFor", shortlist.error);
      const shortlistId = rowOf<{ id?: unknown }>(shortlist.data)?.id;
      if (typeof shortlistId !== "string") return [];
      const out: ShortlistItemJobRow[] = [];
      for (const lot of lotsOf(candidateIds)) {
        const { data, error } = await client
          .from("shortlist_items")
          .select("id,org_id,shortlist_id,candidate_id,match")
          .eq("org_id", orgId)
          .eq("shortlist_id", shortlistId)
          .in("candidate_id", lot);
        if (error) fail("listShortlistItemsFor", error);
        out.push(...rowsOf<ShortlistItemJobRow>(data));
      }
      return out;
    },

    patchShortlistItemMatch: async (id, orgId, match) => {
      const { error } = await client
        .from("shortlist_items")
        .update({ match })
        .eq("id", id)
        .eq("org_id", orgId);
      if (error) fail("patchShortlistItemMatch", error);
    },

    listCandidatesForPhoto: async (limit) => {
      // The inner join keeps only the candidates with a processed document,
      // and the embedded rows are those documents, newest first.
      const { data, error } = await client
        .from("candidates")
        .select("id,org_id,documents!inner(id,storage_path,status,extraction_method,processed_at)")
        .is("photo_path", null)
        .is("photo_checked_at", null)
        .eq("documents.status", "processed")
        .order("processed_at", { referencedTable: "documents", ascending: false })
        .limit(Math.max(1, Math.floor(limit)));
      if (error) fail("listCandidatesForPhoto", error);
      return rowsOf<{ id: string; org_id: string; documents?: unknown }>(data)
        .filter((row) => typeof row.id === "string" && typeof row.org_id === "string")
        .map((row) => ({
          id: row.id,
          org_id: row.org_id,
          documents: (Array.isArray(row.documents) ? row.documents : []).filter(
            (document): document is PhotoDocumentRow =>
              Boolean(document) &&
              typeof document === "object" &&
              typeof (document as PhotoDocumentRow).storage_path === "string",
          ),
        }));
    },

    markPhotoChecked: async (id) => {
      const { error } = await client
        .from("candidates")
        .update({ photo_checked_at: new Date().toISOString() })
        .eq("id", id);
      if (error) fail("markPhotoChecked", error);
    },

    setPhotoPath: async (id, path) => {
      const { error } = await client
        .from("candidates")
        .update({ photo_path: path, photo_checked_at: new Date().toISOString() })
        .eq("id", id);
      if (error) fail("setPhotoPath", error);
    },

    downloadObject: async (path) => {
      const { data, error } = await client.storage.from(CV_BUCKET).download(path);
      if (error) fail("downloadObject", { message: error.message });
      if (!data) throw new DbError("downloadObject", "no content answered");
      return Buffer.from(await data.arrayBuffer());
    },

    uploadObject: async (bucket, path, bytes, contentType) => {
      const { error } = await client.storage
        .from(bucket)
        .upload(path, bytes, { contentType, upsert: true });
      if (error) fail("uploadObject", { message: error.message });
    },

    removeObjects: async (paths, bucket = CV_BUCKET) => {
      if (paths.length === 0) return;
      const { error } = await client.storage.from(bucket).remove(paths);
      if (error) fail("removeObjects", { message: error.message });
    },
  };
}
