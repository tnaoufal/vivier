/**
 * The types of the analysis, shared by the web app and the processor:
 * the brief's criteria and role profile, the deterministic verdicts,
 * the model's assessment and its passes, the triage, and the minimal
 * profile shapes the pure functions read (what a candidate row carries
 * of a person, never a name in a payload). The web app's row types
 * (src/lib/db/types.ts) re-export every one of these; the processor's
 * import them from "@vivier/analysis". Nothing here depends on a
 * runtime.
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

/** The brief as the pure functions read it: its title and its text, the only source of every reading. */
export interface BriefSource {
  title: string;
  description: string;
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
  /** True when the evidence was not found in what the model was given: a "yes" so marked is read as "partial" (a "yes" on years alone the profile's years confirm shows those years instead, unmarked). */
  evidenceUnverified?: boolean;
}

/** One row of a requirement list as a page shows it: what requirementRows() builds, the app shell's RequirementRow shape. */
export interface RequirementRow {
  id: string;
  label: string;
  required: boolean;
  met: RequirementMet;
  evidence: string | null;
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

/** What a second opinion's doubt is about: another métier, a required requirement not met, the seniority, facts of the CV that do not add up, the context. */
export type ChallengeKind = "metier" | "requirement" | "seniority" | "contradiction" | "context";

/** The second opinion on a retained profile: the reason not to present it, if any. */
export interface AssessmentChallenge {
  verdict: "confirmed" | "doubt";
  /** What a doubt is about, as the second reading classed it; absent on a confirmation, and on a doubt it did not class or stored before the kinds. */
  kind?: ChallengeKind;
  reason: string | null;
  evidence: string | null;
}

export interface Assessment {
  decision: AssessmentDecision;
  /** 0..100: the composite score computed in code (scoring.ts), gated by the rules. */
  score: number;
  /** Two to four factual sentences for a hiring manager, in the brief's language. */
  summary: string;
  requirements: RequirementAssessment[];
  /** Which model answered, for the audit. */
  model: string;
  /** The model's own overall score, advisory; absent on assessments made before the dimensions. */
  modelScore?: number;
  /** The model's own decision before the rules (fit, borderline, no_fit), for the audit; absent on older assessments. */
  modelDecision?: AssessmentDecision;
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
  /**
   * fnv1a32 of the brief's title and description the profile was read
   * from (briefSourceHash, role-profile.ts): a search reads the brief
   * again only when its text changed. Absent on a profile written
   * before the hash existed, which is read again once.
   */
  sourceHash?: string;
}

/**
 * The triage's answer on one profile: the job itself or the same job
 * under another name (yes), an adjacent background or the job held
 * earlier (close), another job (no), a card too thin to judge (unknown,
 * read in full rather than dropped).
 */
export type TriageVerdict = "yes" | "close" | "no" | "unknown";

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
  /**
   * The triage's verdict on the profile's métier and its short reason,
   * set when a whole-pool search promoted the entry for the full
   * reading; absent on results of older searches and of the text or
   * hybrid paths.
   */
  triage?: { verdict: TriageVerdict; reason: string | null };
  /**
   * The screening's score against the brief's reading (0..100, null when
   * the card could not be scored) and its short reason, carried on the
   * entry by the promotion; absent on results of searches run before the
   * screening existed.
   */
  screen?: { score: number | null; reason: string | null };
}

/** "triage": the whole active pool sorted by métier first, then only the kept profiles read in full. */
export type SearchMethod = "hybrid" | "text" | "triage";

/** The columns the matching reads; the server selects exactly these. */
export interface MatchProfile {
  id: string;
  headline: string | null;
  summary: string | null;
  skills: string[];
  languages: CandidateLanguage[];
  location: string | null;
  years_experience: number | null;
  availability: string | null;
  education: CandidateEducation[];
  experiences: CandidateExperience[];
  search_text: string | null;
}

/**
 * The columns the assessment reads: the matching's (the dated
 * experiences among them) and the name, which never leaves: the payload
 * strips it out of every text it sends.
 */
export type AssessmentProfile = MatchProfile & { full_name: string | null };

/**
 * The columns the triage loads: the name and the place are read only so
 * the card's texts can be cleaned of them (a headline often ends with
 * the city); neither ever leaves. Never the contact details, the links,
 * the photo, the summary or the CV text.
 */
export interface TriageProfile {
  id: string;
  full_name: string | null;
  location: string | null;
  headline: string | null;
  years_experience: number | null;
  experiences: CandidateExperience[];
  education: CandidateEducation[];
  skills: string[];
}
