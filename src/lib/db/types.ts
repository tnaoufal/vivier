/**
 * Row types of the Vivier schema (supabase/migrations). Hand-written and
 * kept in step with the migration: the browser reads rows through
 * supabase-js under RLS, the server through the service client. Column
 * names are the database's (snake_case); the UI maps what it shows.
 */

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

export type DocumentStatus = "queued" | "processing" | "processed" | "needs_ocr" | "failed";
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
  processed_at: string | null;
  uploaded_by: string | null;
  created_at: string;
  updated_at: string;
}

export type CriterionKind =
  | "skill"
  | "experience"
  | "language"
  | "location"
  | "education"
  | "availability"
  | "other";

export interface BriefCriterion {
  id: string;
  kind: CriterionKind;
  /** Short label shown on chips, e.g. "Anglais courant". */
  label: string;
  /** The value matched against the profile, e.g. "anglais" / "C1" / "5" (years). */
  value: string;
  required: boolean;
  /** 1 nice to have, 2 important, 3 essential. */
  weight: 1 | 2 | 3;
}

export type BriefStatus = "draft" | "open" | "closed";

export interface BriefRow {
  id: string;
  org_id: string;
  title: string;
  description: string;
  criteria: BriefCriterion[];
  status: BriefStatus;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** What one criterion says about one candidate. "not_stated" never counts against them. */
export type CriterionVerdict = "match" | "partial" | "missing" | "not_stated";

export interface CriterionResult {
  criterionId: string;
  verdict: CriterionVerdict;
  /** What in the profile the verdict rests on, quoted or named; null when nothing. */
  evidence: string | null;
}

export interface MatchResult {
  candidateId: string;
  /** 0..100 over the criteria that could be evaluated. */
  score: number;
  /** 0..1: the share of criteria the profile says something about. */
  coverage: number;
  /** A required criterion is missing. */
  blocked: boolean;
  verdicts: CriterionResult[];
  /** Two or three factual sentences from the model, null when no model answered. */
  why: string | null;
  /** How the candidate was retrieved before scoring. */
  retrieval: { textRank: number | null; vectorRank: number | null };
}

export type SearchMethod = "hybrid" | "text";

export interface SearchRow {
  id: string;
  org_id: string;
  brief_id: string | null;
  query: string;
  criteria: BriefCriterion[];
  results: MatchResult[];
  result_count: number;
  method: SearchMethod;
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

export interface ShareItem {
  candidateId: string;
  name: string;
  headline: string | null;
  /** Edited by the team before sending; drafted by the model when one answers. */
  summary: string;
  strengths: string[];
  attention: string[];
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

export type AiUsageKind = "structure" | "embed" | "ocr" | "brief" | "explain" | "summary";

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
