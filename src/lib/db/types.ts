/**
 * Row types of the Vivier schema (supabase/migrations). Hand-written and
 * kept in step with the migration: the browser reads rows through
 * supabase-js under RLS, the server through the service client. Column
 * names are the database's (snake_case); the UI maps what it shows. The
 * types of the analysis (the criteria, the role profile, the verdicts,
 * the assessment, the triage, the run's status and stages) are the
 * shared package's (@vivier/analysis, used by the processor too) and
 * are re-exported here, so every import of them keeps its path.
 */
import type {
  AnalysisStage,
  AnalysisStatus,
  Assessment,
  AssessmentChallenge,
  AssessmentDecision,
  AssessmentDimension,
  AssessmentTier,
  BriefCriterion,
  CandidateEducation,
  CandidateExperience,
  CandidateLanguage,
  CriterionKind,
  CriterionResult,
  CriterionVerdict,
  DimensionScore,
  MatchResult,
  RequirementAssessment,
  RequirementMet,
  RoleProfile,
  RoleSeniority,
  SearchMethod,
  TriageVerdict,
} from "@vivier/analysis";

export type {
  AnalysisStage,
  AnalysisStatus,
  Assessment,
  AssessmentChallenge,
  AssessmentDecision,
  AssessmentDimension,
  AssessmentTier,
  BriefCriterion,
  CandidateEducation,
  CandidateExperience,
  CandidateLanguage,
  CriterionKind,
  CriterionResult,
  CriterionVerdict,
  DimensionScore,
  MatchResult,
  RequirementAssessment,
  RequirementMet,
  RoleProfile,
  RoleSeniority,
  SearchMethod,
  TriageVerdict,
};

export type Locale = "fr" | "en";

export type OrgRole = "owner" | "admin" | "member" | "viewer";

export const ROLE_RANK: Record<OrgRole, number> = { owner: 4, admin: 3, member: 2, viewer: 1 };

export function roleAtLeast(role: OrgRole | null | undefined, min: OrgRole): boolean {
  return role ? ROLE_RANK[role] >= ROLE_RANK[min] : false;
}

export type Plan = "trial" | "team" | "business";

export interface ProfileRow {
  id: string;
  email: string | null;
  display_name: string | null;
  locale: Locale;
  created_at: string;
  updated_at: string;
}

export interface OrganizationRow {
  id: string;
  name: string;
  slug: string;
  locale: Locale;
  retention_months: number;
  plan: Plan;
  seat_limit: number;
  cv_quota_month: number;
  /** Candidates' photos are shown in the interface; a team that practises anonymous CVs turns it off. */
  show_photos: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface MembershipRow {
  org_id: string;
  user_id: string;
  role: OrgRole;
  created_at: string;
}

export interface InvitationRow {
  id: string;
  org_id: string;
  email: string;
  role: Exclude<OrgRole, "owner">;
  invited_by: string | null;
  expires_at: string;
  accepted_at: string | null;
  created_at: string;
}

export type CandidateSource = "upload" | "manual";
export type ConsentStatus = "unknown" | "given" | "withdrawn";
export type CandidateStatus = "active" | "archived";

/** The fields the structuring reads, each with a 0..1 confidence. */
export type ConfidenceMap = Partial<
  Record<
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
    | "education",
    number
  >
>;

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
  /** `<org_id>/<candidate_id>.png` (or `.jpg` for a JPEG the OCR cut out) in the private `photos` bucket, read from page 1 of the CV; identification only, never sent to the model. */
  photo_path: string | null;
  /** When the processor last looked for a portrait in the candidate's CV (the maintenance pass reads every candidate without a photo once); null until then. */
  photo_checked_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** What the browser inserts for a candidate typed in by hand. */
export type CandidateInsert = Pick<CandidateRow, "org_id" | "created_by"> &
  Partial<
    Pick<
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
      | "source"
      | "consent_status"
      | "consent_at"
      | "last_contact_at"
    >
  >;

export type DocumentStatus = "queued" | "processing" | "processed" | "needs_ocr" | "failed" | "rejected";
/** What the classifier decided before structuring; null when never classified. */
export type DocumentKind = "cv" | "other";
export type ExtractionMethod = "pdf-text" | "ocr" | "none";
export type StructuringMethod = "model" | "heuristic";

export interface DocumentRow {
  id: string;
  org_id: string;
  candidate_id: string | null;
  storage_path: string;
  file_name: string;
  mime_type: string;
  byte_size: number;
  sha256: string | null;
  status: DocumentStatus;
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

export type BriefStatus = "draft" | "open" | "closed";

export interface BriefRow {
  id: string;
  org_id: string;
  title: string;
  description: string;
  criteria: BriefCriterion[];
  /** Null until the first analysis derives it (or a person writes it). */
  role_profile: RoleProfile | null;
  status: BriefStatus;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** A candidate near another one (similar_candidates). */
export interface SimilarCandidate {
  candidate_id: string;
  similarity: number;
  method: "embedding" | "skills";
  /** The neighbour's years of experience as the function read them; null when the profile states none, or when an older version of the function answered. */
  years_experience: number | null;
}

/** One profile of a whole-pool search's snapshot (search_triage); verdict null until the triage read it. Written by the service role only. */
export interface SearchTriageRow {
  search_id: string;
  org_id: string;
  candidate_id: string;
  verdict: TriageVerdict | null;
  /** At most 300 characters in the database; the triage clips it shorter. */
  reason: string | null;
  model: string | null;
  read_at: string | null;
  /** The screening's score 0..100 against the brief's reading; null until screened, and for a card the model could not score. */
  score: number | null;
  /** The screening's reason, twelve words at most (300 characters in the database). */
  score_reason: string | null;
  /** When the screening read the card; null until then (the first write wins). */
  scored_at: string | null;
  /** True when a person brought the profile back to be read in full: the promotion always takes it. */
  forced: boolean;
  /** How many times a batch holding the card failed; the runner settles a card past the limit. */
  attempts: number;
}

export interface SearchRow {
  id: string;
  org_id: string;
  brief_id: string | null;
  query: string;
  criteria: BriefCriterion[];
  results: MatchResult[];
  result_count: number;
  method: SearchMethod;
  /** Active candidates in the pool when the search ran; null for rows stored before the column existed. */
  pool_size: number | null;
  /** Profiles read in full, matches (decision fit) and near profiles (borderline), kept by merge_search_results so a list never reads the results. */
  assessed_count: number;
  match_count: number;
  near_count: number;
  /** The run as a job of the processor: queued by runSearch, running once claimed, then stopped, done or failed; rows stored before the job existed read done. */
  status: AnalysisStatus;
  /** The stage the run is at while running, the last one reached otherwise; null before the first. */
  stage: AnalysisStage | null;
  /** The stage's own progress: items settled and items of the stage (progressOf() makes the bar's percent of them). */
  progress_done: number;
  progress_total: number;
  /** Set by a person through a server function; the runner stops at its next step. */
  stop_requested: boolean;
  /** One sentence for the team when the run failed; null otherwise. */
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
  /** Written by the runner as it works; a running row whose heartbeat is stale is claimed again. */
  heartbeat_at: string | null;
  /** The processor instance that holds the run. */
  runner: string | null;
  /** The chat model the run's calls went to. */
  analysis_model: string | null;
  ran_by: string | null;
  created_at: string;
}

export interface ShortlistRow {
  id: string;
  org_id: string;
  brief_id: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type ShortlistItemStatus = "to_review" | "retained" | "dismissed";

export interface ShortlistItemRow {
  id: string;
  org_id: string;
  shortlist_id: string;
  candidate_id: string;
  status: ShortlistItemStatus;
  position: number;
  match: MatchResult | null;
  note: string | null;
  assigned_to: string | null;
  added_by: string | null;
  decided_by: string | null;
  decided_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CommentRow {
  id: string;
  org_id: string;
  shortlist_item_id: string | null;
  candidate_id: string | null;
  brief_id: string | null;
  author_id: string;
  body: string;
  mentions: string[];
  created_at: string;
  updated_at: string;
}

export interface VoteRow {
  shortlist_item_id: string;
  org_id: string;
  user_id: string;
  value: -1 | 1;
  created_at: string;
}

export type ActivityKind =
  | "shortlist.added"
  | "shortlist.removed"
  | "shortlist.status"
  | "shortlist.assigned"
  | "comment.added"
  | "brief.created"
  | "brief.status"
  | "document.uploaded"
  | "document.processed"
  | "document.failed"
  | "document.needs_ocr"
  | "document.rejected"
  | "candidate.active"
  | "candidate.archived"
  | "candidate.consent"
  | "candidate.deleted"
  | "share.created"
  | "share.revoked"
  | "share.sent"
  | "member.invited"
  | "member.joined"
  | "member.removed";

export interface ActivityRow {
  id: number;
  org_id: string;
  actor_id: string | null;
  kind: ActivityKind | string;
  target_type: string;
  target_id: string | null;
  brief_id: string | null;
  candidate_id: string | null;
  payload: Record<string, unknown>;
  created_at: string;
}

/** One requirement of the brief as the dossier shows it for a candidate. */
export interface ShareRequirement {
  label: string;
  required: boolean;
  met: RequirementMet;
  /** A short quote or fact from the CV; null when it says nothing about it. */
  evidence: string | null;
}

/** The brief as it was when the share was created: the dossier's cover reads it. */
export interface ShareBrief {
  title: string;
  /** The description, clipped: the cover's "what we looked for". */
  summary: string;
  requirements: { label: string; required: boolean }[];
}

export interface ShareItem {
  candidateId: string;
  name: string;
  headline: string | null;
  location: string | null;
  yearsExperience: number | null;
  availability: string | null;
  /** The first skills and the languages as the CV states them. */
  skills: string[];
  languages: string[];
  /** Edited by the team before sending; drafted by the model when one answers. */
  summary: string;
  strengths: string[];
  attention: string[];
  /** What to verify in an interview, from the assessment; empty for shares made before. */
  questions: string[];
  /** The assessment's fit score 0..100, null when no model assessed the candidate. */
  score: number | null;
  decision: AssessmentDecision | null;
  /** One row per requirement of the brief, from the assessment (or the deterministic verdicts). */
  requirements: ShareRequirement[];
  /** The CV shown on the page through a signed link, when include_cvs. */
  documentId: string | null;
}

export interface ShareRow {
  id: string;
  org_id: string;
  shortlist_id: string;
  title: string;
  intro: string;
  items: ShareItem[];
  /** Null for shares created before the dossier. */
  brief: ShareBrief | null;
  include_cvs: boolean;
  expires_at: string;
  revoked_at: string | null;
  view_count: number;
  last_viewed_at: string | null;
  created_by: string | null;
  created_at: string;
}

export type EmailSendStatus = "queued" | "sent" | "failed";

export interface EmailSendRow {
  id: string;
  org_id: string;
  kind: "share" | "invitation";
  share_id: string | null;
  invitation_id: string | null;
  to_email: string;
  subject: string;
  status: EmailSendStatus;
  provider_id: string | null;
  error: string | null;
  sent_at: string | null;
  created_by: string | null;
  created_at: string;
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

export interface AiUsageRow {
  id: number;
  org_id: string;
  kind: AiUsageKind;
  model: string | null;
  tokens_in: number;
  tokens_out: number;
  created_at: string;
}

/** The fixed width of every embedding column (mistral-embed; OpenAI models shortened to it). */
export const EMBEDDING_DIMENSIONS = 1024;
