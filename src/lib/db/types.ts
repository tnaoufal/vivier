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
  /** `<org_id>/<candidate_id>.png` (or `.jpg` for a JPEG the OCR cut out) in the private `photos` bucket, read from page 1 of the CV; identification only, never sent to the model. */
  photo_path: string | null;
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

/**
 * "role" is the job itself (one per brief, judged first): its label is
 * the job as the team names it, its value the role's definition (job
 * family, core missions, equivalent titles) that the assessment reads.
 */
export type CriterionKind =
  | "role"
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
  /** Short label shown on chips, e.g. "Anglais courant"; for a role, the job title as the brief names it. */
  label: string;
  /** The value matched against the profile, e.g. "anglais" / "C1" / "5" (years); for a role, its definition (up to 600 characters). */
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
  /** Null until the first analysis derives it (or a person writes it). */
  role_profile: RoleProfile | null;
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

/** The model's answer on one requirement of the brief, with the evidence it quotes from the CV. */
export type RequirementMet = "yes" | "partial" | "no" | "unknown";

export interface RequirementAssessment {
  criterionId: string;
  met: RequirementMet;
  /** A short quote or fact from the profile; null when nothing in the CV speaks to it. */
  evidence: string | null;
  /** True when the evidence was not found in what the model was given: a "yes" so marked is read as "partial". */
  evidenceUnverified?: boolean;
}

/** The model's expert reading of a candidate against the whole brief. */
export type AssessmentDecision = "fit" | "borderline" | "no_fit";

/** One of the five dimensions a senior recruiter scores a profile on. */
export interface DimensionScore {
  /** 0..100 */
  score: number;
  /** One factual sentence in the brief's language. */
  note: string;
  /** A quote or fact from the profile; null when nothing speaks to it. */
  evidence: string | null;
  /** True when the evidence was not found in what the model was given: the score is then neutral at most. */
  evidenceUnverified?: boolean;
}

export type AssessmentDimension = "role" | "seniority" | "context" | "trajectory" | "achievements";

/** The shortlist tier the comparative pass gives: A present now, B worth a deeper look, C do not present. */
export type AssessmentTier = "A" | "B" | "C";

/** The second opinion on a retained profile: the reason not to present it, if any. */
export interface AssessmentChallenge {
  verdict: "confirmed" | "doubt";
  reason: string | null;
  evidence: string | null;
}

export interface Assessment {
  decision: AssessmentDecision;
  /** 0..100: the composite score computed in code (src/lib/briefs/scoring.ts), gated by the rules. */
  score: number;
  /** Two to four factual sentences for a hiring manager, in the brief's language. */
  summary: string;
  requirements: RequirementAssessment[];
  /** Which model answered, for the audit. */
  model: string;
  /** The model's own overall score, advisory; absent on assessments made before the dimensions. */
  modelScore?: number;
  /** The five dimensions with their evidence; absent on older assessments. */
  dimensions?: Record<AssessmentDimension, DimensionScore>;
  /** Facts in the profile's favour, as a recruiter would list them. */
  strengths?: string[];
  /** Reservations to weigh, never a protected characteristic, never a career break. */
  concerns?: string[];
  /** What to check in an interview. */
  questions?: string[];
  /** Set by the comparative pass over the retained profiles. */
  tier?: AssessmentTier;
  /** One line from the comparative pass: why this rank among the others. */
  rankNote?: string | null;
  /** Set by the second-opinion pass on retained profiles. */
  challenge?: AssessmentChallenge;
  /** How many of the model's sentences the filter withheld (a protected characteristic, a period without a position): the reading shown is incomplete by that much. */
  withheld?: number;
}

/** The structured understanding of the job, derived from the brief and edited by the team (briefs.role_profile). */
export type RoleSeniority = "junior" | "confirmed" | "senior" | "manager" | "executive";

export interface RoleProfile {
  /** The job as the team names it. */
  title: string;
  /** The domain written from what the job is in the market (e.g. "développement commercial B2B"). */
  domain: string;
  seniority: RoleSeniority;
  yearsMin: number | null;
  yearsMax: number | null;
  /** Three to six core missions that define the job. */
  missions: string[];
  equivalentTitles: string[];
  /** Neighbouring backgrounds that can succeed, each with what it lacks. */
  adjacentProfiles: string[];
  context: {
    sector: string | null;
    product: string | null;
    clients: string | null;
    /** Team size, budget, deal size, territory: the scope markers the brief states. */
    scope: string | null;
  };
  /** Deal-breakers in words, as the brief states them. */
  mustHaves: string[];
  niceToHaves: string[];
  /** What makes someone succeed in this job, as a senior recruiter would say it. */
  successFactors: string[];
  /** Points to verify in an interview with every candidate. */
  questions: string[];
  /** What the brief does not state and the model had to assume (the exact métier, the level, the scope): for the team to confirm before a CV is read. */
  assumptions: string[];
  /** Which model wrote it, and when; edits by the team keep these. */
  model: string | null;
  createdAt: string;
}

/** A candidate near another one (similar_candidates). */
export interface SimilarCandidate {
  candidate_id: string;
  similarity: number;
  method: "embedding" | "skills";
}

export interface MatchResult {
  candidateId: string;
  /** 0..100 over the criteria that could be evaluated (the deterministic pass). */
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
  /** The model's expert assessment; absent when no model answered (text-only mode). */
  assessment?: Assessment;
  /**
   * The criteria the verdicts and the assessment refer to, as they were
   * when the search ran: carried by the snapshot a shortlist item keeps
   * (shortlist_items.match) so the board and the dossier read it against
   * the right brief. Absent in a search's own results (the row holds
   * them) and in items stored before.
   */
  criteria?: BriefCriterion[];
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
  /** Active candidates in the pool when the search ran; null for rows stored before the column existed. */
  pool_size: number | null;
  /** Profiles read in full, matches (decision fit) and near profiles (borderline), kept by merge_search_results so a list never reads the results. */
  assessed_count: number;
  match_count: number;
  near_count: number;
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

export type AiUsageKind = "structure" | "embed" | "ocr" | "brief" | "explain" | "summary" | "assess";

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
