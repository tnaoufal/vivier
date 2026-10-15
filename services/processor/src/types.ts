/**
 * Row shapes of the Vivier schema the processor reads and writes, copied
 * from the web app's `src/lib/db/types.ts` so this service stays
 * self-contained (it never imports from `vivier/src`); the types of the
 * analysis itself (the criteria, the role profile, the results, the
 * assessment, the triage, the run's status and stages) are the shared
 * package's, "@vivier/analysis", and are re-exported here. Column names
 * are the database's (snake_case); keep them in step with the migrations
 * under `supabase/migrations`.
 */
import type {
  AnalysisStage,
  AnalysisStatus,
  AssessmentProfile,
  BriefCriterion,
  MatchResult,
  RoleProfile,
  SearchMethod,
  TriageProfile,
  TriageVerdict,
} from "@vivier/analysis";

export type {
  AnalysisStage,
  AnalysisStatus,
  Assessment,
  BriefCriterion,
  MatchResult,
  RoleProfile,
  SearchMethod,
  TriageVerdict,
} from "@vivier/analysis";

export interface CandidateLanguage {
  name: string;
  /** CEFR level (A1..C2), "native", or free text as written. */
  level: string | null;
}

export interface CandidateExperience {
  title: string;
  company: string | null;
  /** ISO-like "YYYY-MM" or "YYYY", as read; null when unknown. */
  start: string | null;
  end: string | null;
  description: string | null;
}

export interface CandidateEducation {
  degree: string;
  school: string | null;
  year: string | null;
}

export interface CandidateLink {
  label: string;
  url: string;
}

export type CandidateSource = "upload" | "manual";
export type ConsentStatus = "unknown" | "given" | "withdrawn";
export type CandidateStatus = "active" | "archived";

/** The fields the structuring reads, each with a 0..1 confidence. */
export const CONFIDENCE_FIELDS = [
  "full_name",
  "email",
  "phone",
  "headline",
  "location",
  "years_experience",
  "availability",
  "summary",
  "skills",
  "languages",
  "experiences",
  "education",
] as const;

export type ConfidenceField = (typeof CONFIDENCE_FIELDS)[number];

export type ConfidenceMap = Partial<Record<ConfidenceField, number>>;

export interface CandidateRow {
  id: string;
  org_id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  headline: string | null;
  location: string | null;
  years_experience: number | null;
  availability: string | null;
  summary: string | null;
  skills: string[];
  languages: CandidateLanguage[];
  experiences: CandidateExperience[];
  education: CandidateEducation[];
  links: CandidateLink[];
  tags: string[];
  confidence: ConfidenceMap;
  source: CandidateSource;
  consent_status: ConsentStatus;
  consent_at: string | null;
  last_contact_at: string | null;
  status: CandidateStatus;
  fingerprint: string | null;
  search_text: string | null;
  /**
   * The digits of `phone`, computed by the database (a GENERATED column):
   * read for the phone-number deduplication, never written by anyone.
   */
  phone_digits: string | null;
  /**
   * `<org_id>/<candidate_id>.png` (or `.jpg`) in the private `photos`
   * bucket, read from page 1 of the CV; it identifies a person in the
   * interface and never reaches the model.
   */
  photo_path: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type DocumentStatus =
  | "queued"
  | "processing"
  | "processed"
  | "needs_ocr"
  | "failed"
  | "rejected";
/** What the classifier decided before structuring; null when never classified. */
export type DocumentKind = "cv" | "other";
export type ExtractionMethod = "pdf-text" | "ocr" | "none";
export type StructuringMethod = "model" | "heuristic";

export interface DocumentRow {
  id: string;
  org_id: string;
  candidate_id: string | null;
  /** Object key in the private `cvs` bucket: <org_id>/<document_id>.pdf */
  storage_path: string;
  file_name: string;
  mime_type: string;
  byte_size: number;
  sha256: string | null;
  status: DocumentStatus;
  /** A sentence for the person when status is failed, needs_ocr or rejected; never a stack. */
  error: string | null;
  attempts: number;
  page_count: number | null;
  text_chars: number | null;
  extracted_text: string | null;
  extraction_method: ExtractionMethod | null;
  structuring_method: StructuringMethod | null;
  document_kind: DocumentKind | null;
  processed_at: string | null;
  uploaded_by: string | null;
  created_at: string;
  updated_at: string;
}

export type Plan = "trial" | "team" | "business";

/** What the processor needs from `organizations`: the quota and the retention. */
export interface OrganizationLimits {
  id: string;
  plan: Plan;
  cv_quota_month: number;
  retention_months: number;
}

export type AiUsageKind =
  | "structure"
  | "embed"
  | "ocr"
  | "brief"
  | "explain"
  | "summary"
  | "assess"
  | "triage"
  | "screen";

/** The fixed width of every embedding column (mistral-embed; OpenAI models shortened to it). */
export const EMBEDDING_DIMENSIONS = 1024;

// ---------------------------------------------------------------------
// the analysis as a job: what the runner reads and writes
// ---------------------------------------------------------------------

/**
 * A whole-pool search as the runner works it: the job columns of
 * `searches`, never the results (getResults reads them apart, they can
 * weigh hundreds of kilobytes). The stored JSON columns come as they
 * are: the runner parses them with its own schemas.
 */
export interface SearchJobRow {
  id: string;
  org_id: string;
  brief_id: string | null;
  method: SearchMethod;
  /** The criteria of the time, as stored. */
  criteria: unknown;
  /** Null until the snapshot of the pool was taken (start_triage writes it, 0 for an empty pool). */
  pool_size: number | null;
  result_count: number;
  assessed_count: number;
  match_count: number;
  near_count: number;
  status: AnalysisStatus;
  stage: AnalysisStage | null;
  progress_done: number;
  progress_total: number;
  stop_requested: boolean;
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
  heartbeat_at: string | null;
  runner: string | null;
  analysis_model: string | null;
  ran_by: string | null;
  created_at: string;
}

/** What the runner writes on a run's row (the results go through merge_search_results, never here). */
export type SearchJobPatch = Partial<
  Pick<
    SearchJobRow,
    | "status"
    | "stage"
    | "progress_done"
    | "progress_total"
    | "stop_requested"
    | "error"
    | "started_at"
    | "finished_at"
    | "heartbeat_at"
    | "runner"
    | "analysis_model"
    | "pool_size"
  > & { criteria: BriefCriterion[] }
>;

export type BriefStatus = "draft" | "open" | "closed";

/** The brief a run reads: its text (the only source of its reading), its stored reading as JSON, its status. */
export interface BriefJobRow {
  id: string;
  org_id: string;
  title: string;
  description: string;
  /** The stored criteria, as they are: parsed by the runner. */
  criteria: unknown;
  /** The stored role profile, as it is: parsed by the runner. */
  role_profile: unknown;
  status: BriefStatus;
}

/** The one reading of a brief, saved in one write so a run never reads one without the other. */
export interface BriefJobPatch {
  role_profile?: RoleProfile;
  criteria?: BriefCriterion[];
}

/** One row of a search's snapshot (search_triage): the triage's verdict, then the screening's score. */
export interface TriageRow {
  search_id: string;
  org_id: string;
  candidate_id: string;
  verdict: TriageVerdict | null;
  reason: string | null;
  model: string | null;
  read_at: string | null;
  /** 0..100; null until screened, and for a card the model could not score. */
  score: number | null;
  score_reason: string | null;
  /** Set once the screening read the card, score or not (the first write wins). */
  scored_at: string | null;
  /** A person brought the profile back: the promotion always takes it. */
  forced: boolean;
  /** How many failed batches held the card. */
  attempts: number;
}

/** "pending": no verdict yet; "kept": yes or close (what the screening and the promotion read); a verdict: that one. */
export type TriageVerdictFilter = "pending" | "kept" | TriageVerdict;

export interface TriageFilter {
  verdict?: TriageVerdictFilter;
  /** True for the rows the screening has not read (scored_at null). */
  unscored?: boolean;
  limit: number;
  /** The page starts after this candidate id (keyset paging by candidate_id). */
  after?: string;
}

/** The snapshot's figures: `scored` counts the kept rows the screening read. */
export interface TriageCounts {
  total: number;
  pending: number;
  yes: number;
  close: number;
  no: number;
  unknown: number;
  scored: number;
}

/** One verdict written by record_triage. */
export interface TriageWrite {
  candidate_id: string;
  verdict: TriageVerdict;
  reason: string | null;
}

/** One score written by record_screen; a null score with a null reason marks a card the model could not score. */
export interface ScreenWrite {
  candidate_id: string;
  score: number | null;
  reason: string | null;
}

/** "card": the triage's columns (no contact, no link, no photo, no summary, no CV text); "full": what the assessment reads. */
export type ProfileColumns = "card" | "full";
export type CardProfile = TriageProfile & { org_id: string };
export type FullProfile = AssessmentProfile & { org_id: string };

/** A shortlist item of the brief as the carry of an assessment reads it: its match is the snapshot a member added it with. */
export interface ShortlistItemJobRow {
  id: string;
  org_id: string;
  shortlist_id: string;
  candidate_id: string;
  match: MatchResult | null;
}

/** A processed document of a candidate the photo pass may read the portrait from. */
export interface PhotoDocumentRow {
  id: string;
  storage_path: string;
  status: DocumentStatus;
  extraction_method: ExtractionMethod | null;
  processed_at: string | null;
}

/** A candidate without a photo the pass has not checked yet, with their processed documents, the most recently processed first. */
export interface PhotoCandidateRow {
  id: string;
  org_id: string;
  documents: PhotoDocumentRow[];
}
