/**
 * Row shapes of the Vivier schema the processor reads and writes, copied
 * from the web app's `src/lib/db/types.ts` so this service stays
 * self-contained (it never imports from `vivier/src`). Column names are
 * the database's (snake_case); keep them in step with the migrations
 * under `supabase/migrations`.
 */

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
  | "assess";

/** The fixed width of every embedding column (mistral-embed; OpenAI models shortened to it). */
export const EMBEDDING_DIMENSIONS = 1024;
