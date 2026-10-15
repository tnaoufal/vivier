import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { z, ZodTypeAny } from "zod";

import {
  assessmentSystemPrompt,
  challengeSystemPrompt,
  PROMOTE_MAX,
  rankingSystemPrompt,
  screenSystemPrompt,
  THIN_CARD_REASON,
  triageSystemPrompt,
  UNREADABLE_REASON,
} from "@vivier/analysis";

import { AnalysisRunner, runAnalysis } from "../src/analysis/runner.js";
import type { ModelRequest, RunnerDeps } from "../src/analysis/steps.js";
import type {
  CandidateInsert,
  CandidateWrite,
  Db,
  DocumentPatch,
  ExpiredCandidate,
  StorageBucket,
} from "../src/db.js";
import { ModelError, type JsonAnswer } from "../src/model.js";
import type {
  AiUsageKind,
  BriefJobPatch,
  BriefJobRow,
  CandidateRow,
  CardProfile,
  DocumentRow,
  FullProfile,
  MatchResult,
  OrganizationLimits,
  PhotoCandidateRow,
  ProfileColumns,
  ScreenWrite,
  SearchJobPatch,
  SearchJobRow,
  ShortlistItemJobRow,
  TriageCounts,
  TriageFilter,
  TriageRow,
  TriageWrite,
} from "../src/types.js";
import { usageRecorderOf } from "../src/usage.js";

const ORG = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const BRIEF = "55555555-5555-4555-8555-555555555555";
const SEARCH = "66666666-6666-4666-8666-666666666666";
const SHORTLIST = "77777777-7777-4777-8777-777777777777";
const NOW = "2026-10-15T10:00:00.000Z";
const MODEL = "fake-analysis-model";
/** What an answered call bills, and what a failed one billed before it failed (two completions, as model.ts makes before it gives up). */
const ANSWERED_USAGE = { model: MODEL, tokensIn: 100, tokensOut: 50 };
const FAILED_USAGE = { model: MODEL, tokensIn: 200, tokensOut: 100 };

/** The pool: 95 profiles; the thin ones have nothing to judge; one was brought back by a person; one is forced in. */
const POOL = 95;
const THIN = new Set([10, 30, 50, 70, 90]);
const PRESET_CLOSE = 72;
const FORCED_YES = 3;

/** Skills that tell the fake model what to do with a card or a profile. */
const MARK_SPLIT = "marque-scission";
const MARK_UNREADABLE = "marque-illisible";
const MARK_RETRY = "marque-relecture";
const MARK_FAIL = "marque-echec";
const MARK_DOUBT = "marque-doute";

function candidateId(index: number): string {
  return `44444444-4444-4444-8444-${String(index).padStart(12, "0")}`;
}

function stripUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/** Yes-type profiles do the job, close-type an adjacent one, no-type another job; even ones list SAP (the brief's must-have). */
function headlineOf(index: number): string {
  if (index <= 50) return "Contrôleuse de gestion senior";
  if (index <= 70) return "Analyste financière";
  return "Développeuse web";
}

function markersOf(index: number, marked: boolean): string[] {
  if (!marked) return [];
  if (index === 43) return [MARK_SPLIT];
  if (index === 86) return [MARK_UNREADABLE];
  if (index === 68) return [MARK_RETRY];
  if (index === 69) return [MARK_FAIL];
  if (index === 66) return [MARK_DOUBT];
  return [];
}

function candidateOf(index: number, marked: boolean): CandidateRow {
  const id = candidateId(index);
  const thin = THIN.has(index);
  const headline = headlineOf(index);
  return {
    id,
    org_id: ORG,
    full_name: "Camille Durandel",
    email: `camille${index}@example.com`,
    phone: `+33 6 12 34 56 ${String(10 + (index % 90)).padStart(2, "0")}`,
    headline: thin ? null : headline,
    location: "Lyon, France",
    years_experience: thin ? null : index,
    availability: null,
    summary: thin ? null : `Camille Durandel, ${headline} à Lyon.`,
    skills: thin ? [] : [...(index % 2 === 0 ? ["SAP"] : []), "Excel", ...markersOf(index, marked)],
    languages: [{ name: "anglais", level: "C1" }],
    experiences: thin
      ? []
      : [
          {
            title: headline,
            company: `Groupe ${index}`,
            start: "2019",
            end: null,
            description: "Pilotage budgétaire et reporting mensuel.",
          },
          {
            title: "Assistante de gestion",
            company: "Beta Conseil",
            start: "2015",
            end: "2019",
            description: null,
          },
        ],
    education: thin ? [] : [{ degree: "Master CCA", school: "Université Lyon 3", year: "2015" }],
    links: [{ label: "LinkedIn", url: "https://www.linkedin.com/in/camille-durandel" }],
    tags: [],
    confidence: {},
    source: "upload",
    consent_status: "unknown",
    consent_at: null,
    last_contact_at: null,
    status: "active",
    fingerprint: null,
    search_text: `Camille Durandel\n${headline}\nLyon, France\ncamille${index}@example.com\n+33 6 12 34 56 78\nPilotage budgétaire et reporting mensuel.`,
    phone_digits: "33612345678",
    photo_path: `${ORG}/${id}.png`,
    created_by: USER,
    created_at: NOW,
    updated_at: NOW,
  };
}

function briefOf(): BriefJobRow {
  return {
    id: BRIEF,
    org_id: ORG,
    title: "Contrôleur de gestion H/F",
    description:
      "Nous recherchons un contrôleur de gestion senior, 5 ans d'expérience au minimum, pour le pilotage budgétaire d'un groupe industriel. SAP indispensable.",
    criteria: [],
    role_profile: null,
    status: "open",
  };
}

function searchOf(overrides: Partial<SearchJobRow> = {}): SearchJobRow {
  return {
    id: SEARCH,
    org_id: ORG,
    brief_id: BRIEF,
    method: "triage",
    criteria: [],
    pool_size: 0,
    result_count: 0,
    assessed_count: 0,
    match_count: 0,
    near_count: 0,
    status: "queued",
    stage: null,
    progress_done: 0,
    progress_total: 0,
    stop_requested: false,
    error: null,
    started_at: null,
    finished_at: null,
    heartbeat_at: null,
    runner: null,
    analysis_model: null,
    ran_by: USER,
    created_at: NOW,
    ...stripUndefined(overrides),
  };
}

function triageRowOf(
  searchId: string,
  candidate: string,
  overrides: Partial<TriageRow> = {},
): TriageRow {
  return {
    search_id: searchId,
    org_id: ORG,
    candidate_id: candidate,
    verdict: null,
    reason: null,
    model: null,
    read_at: null,
    score: null,
    score_reason: null,
    scored_at: null,
    forced: false,
    attempts: 0,
    ...stripUndefined(overrides),
  };
}

function notUsed(): never {
  throw new Error("not used by the analysis");
}

/** A turn of the event loop: what was queued behind the promises in flight has run. */
function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** The in-memory database of the runner: the searches, the briefs, the snapshot rows, the results, the shortlist items; the documents are not part of a run. */
class FakeDb implements Db {
  readonly candidates = new Map<string, CandidateRow>();
  readonly searches = new Map<string, SearchJobRow>();
  readonly briefs = new Map<string, BriefJobRow>();
  readonly triage = new Map<string, TriageRow>();
  readonly results = new Map<string, MatchResult[]>();
  readonly shortlists = new Map<string, string>();
  readonly shortlistItems = new Map<string, ShortlistItemJobRow>();
  readonly usage: Array<{
    orgId: string;
    kind: AiUsageKind;
    model: string | null;
    tokensIn: number;
    tokensOut: number;
  }> = [];
  /** Every patch written on a searches row, in order. */
  readonly patches: SearchJobPatch[] = [];

  async claimDocument(): Promise<DocumentRow | null> {
    return notUsed();
  }
  async listQueued(): Promise<string[]> {
    return notUsed();
  }
  async countQueued(): Promise<number> {
    return notUsed();
  }
  async resetStale(): Promise<{ requeued: number; failed: number }> {
    return notUsed();
  }
  async getDocument(): Promise<DocumentRow | null> {
    return notUsed();
  }
  async updateDocument(_id: string, _patch: DocumentPatch): Promise<void> {
    return notUsed();
  }
  async findDocumentBySha256(): Promise<DocumentRow | null> {
    return notUsed();
  }
  async findCandidateByFingerprint(): Promise<CandidateRow | null> {
    return notUsed();
  }
  async findCandidateByEmail(): Promise<CandidateRow | null> {
    return notUsed();
  }
  async findCandidateByPhoneDigits(): Promise<CandidateRow | null> {
    return notUsed();
  }
  async getCandidateById(): Promise<CandidateRow | null> {
    return notUsed();
  }
  async listCandidatesWithoutEmbedding(): Promise<CandidateRow[]> {
    return notUsed();
  }
  async insertCandidate(_values: CandidateInsert): Promise<string> {
    return notUsed();
  }
  async updateCandidate(_id: string, _patch: CandidateWrite): Promise<void> {
    return notUsed();
  }
  async getOrganization(): Promise<OrganizationLimits | null> {
    return notUsed();
  }
  async cvsProcessedThisMonth(): Promise<number> {
    return notUsed();
  }
  async expiredCandidates(): Promise<ExpiredCandidate[]> {
    return notUsed();
  }
  async listDocumentsOfCandidate(): Promise<Array<{ id: string; storage_path: string }>> {
    return notUsed();
  }
  async deleteCandidate(): Promise<void> {
    return notUsed();
  }
  async downloadObject(): Promise<Buffer> {
    return notUsed();
  }
  async uploadObject(_bucket: StorageBucket): Promise<void> {
    return notUsed();
  }
  async removeObjects(): Promise<void> {
    return notUsed();
  }
  async listCandidatesForPhoto(): Promise<PhotoCandidateRow[]> {
    return notUsed();
  }
  async markPhotoChecked(): Promise<void> {
    return notUsed();
  }
  async setPhotoPath(): Promise<void> {
    return notUsed();
  }

  async recordUsage(
    orgId: string,
    kind: AiUsageKind,
    model: string | null,
    tokensIn: number,
    tokensOut: number,
  ): Promise<void> {
    this.usage.push({ orgId, kind, model, tokensIn, tokensOut });
  }

  async claimAnalyses(runner: string, staleBefore: Date, limit: number): Promise<SearchJobRow[]> {
    const cutoff = staleBefore.getTime();
    const claimed: SearchJobRow[] = [];
    const rows = [...this.searches.values()].sort((a, b) =>
      a.created_at.localeCompare(b.created_at),
    );
    for (const row of rows) {
      if (claimed.length >= limit) break;
      const stale =
        row.status === "running" &&
        (row.heartbeat_at === null || Date.parse(row.heartbeat_at) < cutoff);
      if (row.status !== "queued" && !stale) continue;
      const next: SearchJobRow = {
        ...row,
        status: "running",
        runner,
        heartbeat_at: NOW,
        started_at: row.started_at ?? NOW,
      };
      this.searches.set(row.id, next);
      claimed.push(next);
    }
    return claimed;
  }

  async getSearch(id: string): Promise<SearchJobRow | null> {
    return this.searches.get(id) ?? null;
  }

  async patchSearch(id: string, patch: SearchJobPatch): Promise<void> {
    const current = this.searches.get(id);
    if (!current) throw new Error(`search ${id} missing`);
    this.patches.push(patch);
    this.searches.set(id, Object.assign({}, current, stripUndefined(patch)));
  }

  async getBrief(id: string): Promise<BriefJobRow | null> {
    return this.briefs.get(id) ?? null;
  }

  async patchBrief(id: string, patch: BriefJobPatch): Promise<void> {
    const current = this.briefs.get(id);
    if (!current) throw new Error(`brief ${id} missing`);
    this.briefs.set(id, Object.assign({}, current, stripUndefined(patch)));
  }

  async startTriage(orgId: string, searchId: string): Promise<number> {
    const search = this.searches.get(searchId);
    if (!search || search.org_id !== orgId) throw new Error("search not found");
    let inserted = 0;
    for (const candidate of this.candidates.values()) {
      if (candidate.org_id !== orgId || candidate.status !== "active") continue;
      const key = `${searchId}:${candidate.id}`;
      if (this.triage.has(key)) continue;
      this.triage.set(key, triageRowOf(searchId, candidate.id));
      inserted += 1;
    }
    this.searches.set(searchId, { ...search, pool_size: this.triageRows(searchId).length });
    return inserted;
  }

  triageRows(searchId: string): TriageRow[] {
    return [...this.triage.values()]
      .filter((row) => row.search_id === searchId)
      .sort((a, b) => a.candidate_id.localeCompare(b.candidate_id));
  }

  row(index: number, searchId: string = SEARCH): TriageRow {
    const row = this.triage.get(`${searchId}:${candidateId(index)}`);
    if (!row) throw new Error(`no triage row for ${index}`);
    return row;
  }

  async listTriage(searchId: string, filter: TriageFilter): Promise<TriageRow[]> {
    let rows = this.triageRows(searchId);
    const verdict = filter.verdict;
    if (verdict === "pending") rows = rows.filter((row) => row.verdict === null);
    else if (verdict === "kept")
      rows = rows.filter((row) => row.verdict === "yes" || row.verdict === "close");
    else if (verdict) rows = rows.filter((row) => row.verdict === verdict);
    if (filter.unscored) rows = rows.filter((row) => row.scored_at === null);
    const after = filter.after;
    if (after !== undefined) rows = rows.filter((row) => row.candidate_id > after);
    return rows.slice(0, Math.max(1, filter.limit));
  }

  async countTriage(searchId: string): Promise<TriageCounts> {
    const rows = this.triageRows(searchId);
    const of = (verdict: TriageRow["verdict"]) =>
      rows.filter((row) => row.verdict === verdict).length;
    return {
      total: rows.length,
      pending: of(null),
      yes: of("yes"),
      close: of("close"),
      no: of("no"),
      unknown: of("unknown"),
      scored: rows.filter(
        (row) => (row.verdict === "yes" || row.verdict === "close") && row.scored_at !== null,
      ).length,
    };
  }

  async recordTriage(
    orgId: string,
    searchId: string,
    model: string | null,
    rows: readonly TriageWrite[],
  ): Promise<number> {
    let updated = 0;
    for (const write of rows) {
      const key = `${searchId}:${write.candidate_id}`;
      const row = this.triage.get(key);
      if (!row || row.org_id !== orgId || row.verdict !== null) continue;
      this.triage.set(key, {
        ...row,
        verdict: write.verdict,
        reason: write.reason === null ? null : write.reason.slice(0, 300),
        model,
        read_at: NOW,
      });
      updated += 1;
    }
    return updated;
  }

  async recordScreen(
    orgId: string,
    searchId: string,
    rows: readonly ScreenWrite[],
  ): Promise<number> {
    let updated = 0;
    for (const write of rows) {
      const key = `${searchId}:${write.candidate_id}`;
      const row = this.triage.get(key);
      if (!row || row.org_id !== orgId || row.score !== null || row.scored_at !== null) continue;
      this.triage.set(key, {
        ...row,
        score: write.score,
        score_reason: write.reason === null ? null : write.reason.slice(0, 300),
        scored_at: NOW,
      });
      updated += 1;
    }
    return updated;
  }

  async bumpAttempts(searchId: string, candidateIds: readonly string[]): Promise<number> {
    let updated = 0;
    for (const candidate of new Set(candidateIds)) {
      const key = `${searchId}:${candidate}`;
      const row = this.triage.get(key);
      if (!row) continue;
      this.triage.set(key, { ...row, attempts: row.attempts + 1 });
      updated += 1;
    }
    return updated;
  }

  async loadProfiles(
    orgId: string,
    ids: readonly string[],
    columns: "card",
  ): Promise<CardProfile[]>;
  async loadProfiles(
    orgId: string,
    ids: readonly string[],
    columns: "full",
  ): Promise<FullProfile[]>;
  async loadProfiles(
    orgId: string,
    ids: readonly string[],
    columns: ProfileColumns,
  ): Promise<CardProfile[] | FullProfile[]> {
    const wanted = new Set(ids);
    const rows = [...this.candidates.values()].filter(
      (candidate) =>
        candidate.org_id === orgId && candidate.status === "active" && wanted.has(candidate.id),
    );
    if (columns === "card") {
      return rows.map((candidate) => ({
        id: candidate.id,
        org_id: candidate.org_id,
        full_name: candidate.full_name,
        location: candidate.location,
        headline: candidate.headline,
        years_experience: candidate.years_experience,
        experiences: candidate.experiences,
        education: candidate.education,
        skills: candidate.skills,
      }));
    }
    return rows.map((candidate) => ({
      id: candidate.id,
      org_id: candidate.org_id,
      full_name: candidate.full_name,
      headline: candidate.headline,
      summary: candidate.summary,
      skills: candidate.skills,
      languages: candidate.languages,
      location: candidate.location,
      years_experience: candidate.years_experience,
      availability: candidate.availability,
      education: candidate.education,
      experiences: candidate.experiences,
      search_text: candidate.search_text,
    }));
  }

  async mergeResults(
    orgId: string,
    searchId: string,
    entries: readonly MatchResult[],
  ): Promise<number> {
    const search = this.searches.get(searchId);
    if (!search || search.org_id !== orgId) throw new Error("search not found");
    const merged = [...(this.results.get(searchId) ?? [])];
    for (const entry of entries) {
      const index = merged.findIndex((stored) => stored.candidateId === entry.candidateId);
      const stored = merged[index];
      if (!stored) merged.push(entry);
      else if (!(stored.assessment && !entry.assessment)) merged[index] = entry;
    }
    this.results.set(searchId, merged);
    this.searches.set(searchId, {
      ...search,
      result_count: merged.length,
      assessed_count: merged.filter((entry) => entry.assessment).length,
      match_count: merged.filter((entry) => entry.assessment?.decision === "fit").length,
      near_count: merged.filter((entry) => entry.assessment?.decision === "borderline").length,
    });
    return merged.length;
  }

  async getResults(searchId: string): Promise<MatchResult[]> {
    return [...(this.results.get(searchId) ?? [])];
  }

  async listShortlistItemsFor(
    orgId: string,
    briefId: string,
    candidateIds: readonly string[],
  ): Promise<ShortlistItemJobRow[]> {
    const shortlistId = this.shortlists.get(briefId);
    if (!shortlistId) return [];
    const wanted = new Set(candidateIds);
    return [...this.shortlistItems.values()].filter(
      (item) =>
        item.org_id === orgId && item.shortlist_id === shortlistId && wanted.has(item.candidate_id),
    );
  }

  async patchShortlistItemMatch(id: string, orgId: string, match: MatchResult): Promise<void> {
    const item = this.shortlistItems.get(id);
    if (!item || item.org_id !== orgId) throw new Error(`shortlist item ${id} missing`);
    this.shortlistItems.set(id, { ...item, match });
  }
}

type PromptKind = "brief" | "triage" | "screen" | "assess" | "challenge" | "rank";

interface Captured {
  kind: PromptKind;
  user: string;
}

function kindOf(system: string): PromptKind {
  if (system === triageSystemPrompt()) return "triage";
  if (system === screenSystemPrompt()) return "screen";
  if (system === assessmentSystemPrompt()) return "assess";
  if (system === challengeSystemPrompt()) return "challenge";
  if (system === rankingSystemPrompt()) return "rank";
  if (system.includes("You read ONE job brief")) return "brief";
  throw new Error("unknown prompt");
}

/**
 * A failure a smaller batch may get past: no cause, as model.ts throws
 * when no valid JSON came back. What the call billed rides on the error
 * as `usage`, the field model.ts attaches once its owner adds it (the
 * runner reads it structurally until then, so this is what it records).
 */
function contentFailure(): ModelError {
  return Object.assign(new ModelError("The model did not answer valid JSON: fake"), {
    usage: { ...FAILED_USAGE },
  });
}

interface TriageWire {
  cards: { ref: string; headline?: string; skills?: string }[];
}
interface ScreenWire {
  cards: { ref: string; years: number | null }[];
}
interface AssessWire {
  brief: { role: { id: string } | null; requirements: { id: string }[] };
  candidate: { headline: string | null; skills: string[] };
}
interface RankWire {
  candidates: { candidateId: string; decision: string }[];
}

/**
 * The fake model: one canned answer per prompt kind, read off the
 * payload (the refs, the headlines, the ids), with the markers that
 * make a batch fail, a reading fail once or for good, a second opinion
 * doubt. Every payload sent is kept for the honesty check.
 */
class FakeModel {
  readonly calls: Captured[] = [];
  /** When set, every call fails as the provider does (with the headers its refusal carries, when any). */
  provider: { status: number; headers?: Record<string, string> } | null = null;
  /** Called after each answered call. */
  onCall: ((call: Captured) => void) | null = null;
  private retried = false;

  async complete<S extends ZodTypeAny>(request: ModelRequest<S>): Promise<JsonAnswer<z.output<S>>> {
    const kind = kindOf(request.system);
    const call: Captured = { kind, user: request.user };
    this.calls.push(call);
    if (this.provider) {
      throw new ModelError("The model call failed", { cause: { ...this.provider } });
    }
    const raw = this.answer(kind, request.user);
    const parsed = request.schema.safeParse(raw);
    if (!parsed.success) {
      throw new ModelError(
        `fake answer refused: ${JSON.stringify(parsed.error.issues).slice(0, 300)}`,
      );
    }
    this.onCall?.(call);
    return {
      value: parsed.data as z.output<S>,
      usage: { ...ANSWERED_USAGE },
    };
  }

  private answer(kind: PromptKind, user: string): unknown {
    switch (kind) {
      case "brief":
        return {
          profile: {
            domain: "contrôle de gestion",
            seniority: "senior",
            yearsMin: 5,
            yearsMax: null,
            missions: ["Pilotage budgétaire", "Reporting mensuel", "Consolidation"],
            equivalentTitles: ["Contrôleur de gestion", "Business controller"],
            adjacentProfiles: ["Analyste financier : analyse, ne pilote pas"],
            context: { sector: "Industrie", product: null, clients: null, scope: null },
            mustHaves: ["SAP"],
            niceToHaves: [],
            successFactors: ["Rigueur"],
            questions: ["Périmètre piloté"],
            assumptions: [],
          },
          criteria: [
            {
              kind: "role",
              label: "Contrôleur de gestion",
              value: "contrôle de gestion : pilotage budgétaire, reporting, consolidation",
              required: true,
              weight: 3,
            },
            { kind: "skill", label: "SAP", value: "sap", required: true, weight: 3 },
          ],
          warnings: [],
        };
      case "triage": {
        const payload = JSON.parse(user) as TriageWire;
        const marked = (marker: string) =>
          payload.cards.some((card) => (card.skills ?? "").includes(marker));
        if (marked(MARK_UNREADABLE)) throw contentFailure();
        if (marked(MARK_SPLIT) && payload.cards.length > 10) throw contentFailure();
        return {
          verdicts: payload.cards.map((card) => {
            const headline = card.headline ?? "";
            const verdict = headline.includes("gestion")
              ? "yes"
              : headline.includes("Analyste")
                ? "close"
                : "no";
            return { ref: card.ref, verdict, reason: "Poste tenu" };
          }),
        };
      }
      case "screen": {
        const payload = JSON.parse(user) as ScreenWire;
        return {
          scores: payload.cards.map((card) => ({
            ref: card.ref,
            score: Math.min(100, card.years ?? 50),
            reason: `${card.years ?? 0} ans`,
          })),
        };
      }
      case "assess": {
        const payload = JSON.parse(user) as AssessWire;
        const skills = payload.candidate.skills;
        if (skills.includes(MARK_FAIL)) throw contentFailure();
        if (skills.includes(MARK_RETRY) && !this.retried) {
          this.retried = true;
          throw contentFailure();
        }
        const evidence = payload.candidate.headline ?? "";
        const sap = skills.includes("SAP");
        const dimension = { score: 90, note: "Au niveau attendu", evidence };
        return {
          requirements: [
            ...(payload.brief.role
              ? [{ criterionId: payload.brief.role.id, met: "yes", evidence }]
              : []),
            ...payload.brief.requirements.map((requirement) => ({
              criterionId: requirement.id,
              met: sap ? "yes" : "unknown",
              evidence: sap ? "SAP" : null,
            })),
          ],
          dimensions: {
            role: dimension,
            seniority: dimension,
            context: dimension,
            trajectory: dimension,
            achievements: dimension,
          },
          strengths: ["Pilotage budgétaire"],
          concerns: [],
          questions: ["Périmètre exact"],
          decision: "fit",
          score: 90,
          summary: "Le métier est celui du poste.",
        };
      }
      case "challenge": {
        const payload = JSON.parse(user) as AssessWire;
        if (payload.candidate.skills.includes(MARK_DOUBT)) {
          return {
            verdict: "doubt",
            reason: "Consolidation absente du parcours",
            evidence: payload.candidate.headline,
          };
        }
        return { verdict: "confirmed", reason: "Parcours cohérent", evidence: null };
      }
      case "rank": {
        const payload = JSON.parse(user) as RankWire;
        return {
          ranking: payload.candidates.map((candidate) => ({
            candidateId: candidate.candidateId,
            tier: candidate.decision === "fit" ? "A" : "B",
            note: "Niveau atteint",
          })),
        };
      }
    }
  }
}

function poolOf(db: FakeDb, size: number, marked: boolean): void {
  for (let index = 1; index <= size; index += 1) {
    const candidate = candidateOf(index, marked);
    db.candidates.set(candidate.id, candidate);
  }
}

function depsFor(
  db: FakeDb,
  model: FakeModel | null,
  concurrency = 4,
): RunnerDeps & { sleeps: number[] } {
  const sleeps: number[] = [];
  return {
    db,
    complete: model ? (request) => model.complete(request) : null,
    model: MODEL,
    concurrency,
    recordUsage: usageRecorderOf(db),
    now: () => new Date(NOW),
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    sleeps,
  };
}

/** The row as the runner gets it: claimed. */
async function claimOne(db: FakeDb, id: string = SEARCH): Promise<SearchJobRow> {
  const rows = await db.claimAnalyses("proc:1", new Date(Date.parse(NOW) - 120_000), 10);
  const row = rows.find((candidate) => candidate.id === id);
  if (!row) throw new Error(`search ${id} not claimable`);
  return row;
}

function searchRow(db: FakeDb, id: string = SEARCH): SearchJobRow {
  const row = db.searches.get(id);
  if (!row) throw new Error(`search ${id} missing`);
  return row;
}

function entryOf(db: FakeDb, index: number): MatchResult {
  const entry = (db.results.get(SEARCH) ?? []).find(
    (result) => result.candidateId === candidateId(index),
  );
  if (!entry) throw new Error(`no entry for ${index}`);
  return entry;
}

function cardsOf(call: Captured): number {
  return (JSON.parse(call.user) as { cards: unknown[] }).cards.length;
}

/** The whole pool, the brief unread, the search queued; a person brought one profile back and forced another in. */
function scenario(marked = true): { db: FakeDb; model: FakeModel } {
  const db = new FakeDb();
  const model = new FakeModel();
  poolOf(db, POOL, marked);
  db.briefs.set(BRIEF, briefOf());
  db.searches.set(SEARCH, searchOf());
  db.triage.set(
    `${SEARCH}:${candidateId(PRESET_CLOSE)}`,
    triageRowOf(SEARCH, candidateId(PRESET_CLOSE), { verdict: "close", forced: true }),
  );
  db.triage.set(
    `${SEARCH}:${candidateId(FORCED_YES)}`,
    triageRowOf(SEARCH, candidateId(FORCED_YES), { forced: true }),
  );
  return { db, model };
}

beforeAll(() => {
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterAll(() => {
  vi.restoreAllMocks();
});

describe("runAnalysis", () => {
  it("runs the whole funnel on 95 profiles: the reading, the triage with its splits, the screening, the promotion, the readings, the tiers", async () => {
    const { db, model } = scenario();
    const match = { ...entryStub(42), why: null };
    db.shortlists.set(BRIEF, SHORTLIST);
    db.shortlistItems.set("item-42", {
      id: "item-42",
      org_id: ORG,
      shortlist_id: SHORTLIST,
      candidate_id: candidateId(42),
      match,
    });
    const assessedBefore: MatchResult = {
      ...entryStub(44),
      assessment: { decision: "fit", score: 77, summary: "déjà lu", requirements: [], model: "m" },
    };
    db.shortlistItems.set("item-44", {
      id: "item-44",
      org_id: ORG,
      shortlist_id: SHORTLIST,
      candidate_id: candidateId(44),
      match: assessedBefore,
    });
    const deps = depsFor(db, model);

    const outcome = await runAnalysis(await claimOne(db), deps);
    expect(outcome.status).toBe("done");

    // The row at the end: done, no stage, the progress at its total, the model written, one reading left unread.
    const search = searchRow(db);
    expect(search.status).toBe("done");
    expect(search.stage).toBeNull();
    expect(search.progress_done).toBe(search.progress_total);
    expect(search.finished_at).toBe(NOW);
    expect(search.analysis_model).toBe(MODEL);
    expect(search.pool_size).toBe(POOL);
    expect(search.error).toBe("assess_failed:1");

    // The brief read once, the search's criteria snapshot taken from it.
    expect(model.calls.filter((call) => call.kind === "brief")).toHaveLength(1);
    const brief = db.briefs.get(BRIEF);
    const profile = brief?.role_profile as { sourceHash?: string; title?: string } | null;
    expect(typeof profile?.sourceHash).toBe("string");
    expect(profile?.title).toBe("Contrôleur de gestion H/F");
    const criteria = brief?.criteria as { kind: string; label: string }[];
    expect(criteria.map((criterion) => criterion.kind)).toEqual(["role", "skill"]);
    expect(search.criteria).toEqual(criteria);

    // The triage: three batches (40, 40, 9); the second fails twice and is read in halves then in quarters,
    // the third fails twice and is settled unreadable; the thin cards never reach the model.
    const triageCalls = model.calls.filter((call) => call.kind === "triage");
    expect(triageCalls.map(cardsOf).sort((a, b) => a - b)).toEqual([9, 9, 10, 10, 20, 20, 40, 40]);
    const counts = await db.countTriage(SEARCH);
    expect(counts).toEqual({
      total: POOL,
      pending: 0,
      yes: 47,
      close: 20,
      no: 14,
      unknown: 14,
      scored: 67,
    });
    for (const index of THIN) {
      expect(db.row(index)).toMatchObject({
        verdict: "unknown",
        reason: THIN_CARD_REASON,
        model: null,
        attempts: 0,
      });
    }
    expect(db.row(86)).toMatchObject({
      verdict: "unknown",
      reason: UNREADABLE_REASON,
      attempts: 2,
    });
    expect(db.row(95)).toMatchObject({
      verdict: "unknown",
      reason: UNREADABLE_REASON,
      attempts: 2,
    });
    expect(db.row(43)).toMatchObject({ verdict: "yes", attempts: 2, model: MODEL });
    expect(db.row(51)).toMatchObject({ verdict: "close", attempts: 2 });
    expect(db.row(64)).toMatchObject({ verdict: "close", attempts: 1 });
    expect(db.row(1)).toMatchObject({ verdict: "yes", reason: "Poste tenu", attempts: 0 });
    expect(db.row(PRESET_CLOSE)).toMatchObject({ verdict: "close", forced: true, model: null });

    // The screening: the 67 kept cards in three batches, scored; a card set aside is never scored.
    const screenCalls = model.calls.filter((call) => call.kind === "screen");
    expect(screenCalls.map(cardsOf).sort((a, b) => a - b)).toEqual([17, 25, 25]);
    expect(db.row(43).score).toBe(43);
    expect(db.row(PRESET_CLOSE)).toMatchObject({ score: 72, score_reason: "72 ans" });
    expect(db.row(86).scored_at).toBeNull();

    // The promotion: the thirty best by score and every forced row, with the triage and the screening on the entry.
    const results = db.results.get(SEARCH) ?? [];
    const promoted = results.map((entry) => entry.candidateId).sort();
    const expected = [
      ...Array.from({ length: 31 }, (_, offset) => 39 + offset).filter((index) => index !== 50),
      FORCED_YES,
      PRESET_CLOSE,
    ]
      .map(candidateId)
      .sort();
    expect(expected).toHaveLength(PROMOTE_MAX + 2);
    expect(promoted).toEqual(expected);
    expect(entryOf(db, PRESET_CLOSE).triage).toEqual({ verdict: "close", reason: null });
    expect(entryOf(db, PRESET_CLOSE).screen).toEqual({ score: 72, reason: "72 ans" });
    expect(entryOf(db, FORCED_YES).screen).toEqual({ score: 3, reason: "3 ans" });

    // The readings: one call each, one sent again once, one left unread after two failures.
    const assessCalls = model.calls.filter((call) => call.kind === "assess");
    expect(assessCalls).toHaveLength(34);
    expect(entryOf(db, 69).assessment).toBeUndefined();
    expect(entryOf(db, 68).assessment?.decision).toBe("fit");
    expect(entryOf(db, 42).assessment?.decision).toBe("fit");
    expect(entryOf(db, 41).assessment?.decision).toBe("borderline");
    expect(search.result_count).toBe(32);
    expect(search.assessed_count).toBe(31);
    expect(search.match_count).toBe(14);
    expect(search.near_count).toBe(17);

    // The second opinion on the fifteen retained; one doubt, quoted, sends its profile to "to check".
    expect(model.calls.filter((call) => call.kind === "challenge")).toHaveLength(15);
    const doubted = entryOf(db, 66).assessment;
    expect(doubted?.challenge?.verdict).toBe("doubt");
    expect(doubted?.decision).toBe("borderline");
    expect(doubted?.concerns).toContain("Consolidation absente du parcours");
    expect(entryOf(db, 42).assessment?.challenge?.verdict).toBe("confirmed");

    // The tiering: four groups, then the A's compared once more.
    const rankCalls = model.calls.filter((call) => call.kind === "rank");
    expect(rankCalls).toHaveLength(5);
    const groups = rankCalls.map((call) => (JSON.parse(call.user) as RankWire).candidates.length);
    expect(groups.slice(0, 4).sort((a, b) => a - b)).toEqual([7, 8, 8, 8]);
    expect(groups[4]).toBe(8);
    expect(entryOf(db, 42).assessment?.tier).toBe("A");
    expect(entryOf(db, 42).assessment?.rankNote).toBe("Niveau atteint");
    expect(entryOf(db, 41).assessment?.tier).toBe("B");

    // Every call recorded for the organisation, a failed one with what it billed: the four triage calls
    // the model could not answer, the two readings of the profile it never answered and the one it
    // answered at the second call.
    const byKind = (kind: AiUsageKind) => db.usage.filter((row) => row.kind === kind).length;
    expect(byKind("brief")).toBe(1);
    expect(byKind("triage")).toBe(8);
    expect(byKind("screen")).toBe(3);
    expect(byKind("assess")).toBe(34 + 15 + 5);
    expect(db.usage.filter((row) => row.tokensIn === FAILED_USAGE.tokensIn)).toHaveLength(4 + 3);
    expect(db.usage.every((row) => row.orgId === ORG && row.model === MODEL)).toBe(true);

    // The assessment carried to the shortlist item that lacked one, with the criteria; the one read before is left alone.
    expect(db.shortlistItems.get("item-42")?.match?.assessment?.decision).toBe("fit");
    expect(db.shortlistItems.get("item-42")?.match?.criteria).toEqual(criteria);
    expect(db.shortlistItems.get("item-44")?.match).toEqual(assessedBefore);

    // Honesty: no name, e-mail, phone or photo path in any payload; no place on a triage or screening card.
    for (const call of model.calls) {
      expect(call.user).not.toMatch(/Camille|Durandel|example\.com|\+33|12 34 56|\.png|linkedin/);
      if (call.kind === "triage" || call.kind === "screen") expect(call.user).not.toMatch(/Lyon/);
    }
  });

  it("stops between two batches when asked, then resumes from the pending rows without reading a card twice", async () => {
    const { db, model } = scenario(false);
    const deps = depsFor(db, model, 1);
    model.onCall = (call) => {
      if (call.kind !== "triage") return;
      db.searches.set(SEARCH, { ...searchRow(db), stop_requested: true });
      model.onCall = null;
    };
    const first = await runAnalysis(await claimOne(db), deps);
    expect(first.status).toBe("stopped");
    const stopped = searchRow(db);
    expect(stopped.status).toBe("stopped");
    expect(stopped.stage).toBe("triage");
    expect(stopped.stop_requested).toBe(false);
    expect(stopped.finished_at).toBe(NOW);
    expect((await db.countTriage(SEARCH)).pending).toBe(49);
    expect(model.calls.filter((call) => call.kind === "triage").map(cardsOf)).toEqual([40]);

    // "Reprendre": the web app queues the same row; the runner claims it and goes on.
    db.searches.set(SEARCH, { ...searchRow(db), status: "queued" });
    const second = await runAnalysis(await claimOne(db), deps);
    expect(second.status).toBe("done");
    expect(searchRow(db).status).toBe("done");
    const triageCalls = model.calls.filter((call) => call.kind === "triage").map(cardsOf);
    expect(triageCalls).toEqual([40, 40, 9]);
    expect((await db.countTriage(SEARCH)).pending).toBe(0);
    expect(model.calls.filter((call) => call.kind === "brief")).toHaveLength(1);
    expect(db.results.get(SEARCH)).toHaveLength(PROMOTE_MAX + 2);
  });

  it("ends the batch in flight on a shutdown, leaves the row running with no heartbeat, and the next boot claims it at once", async () => {
    const { db, model } = scenario(false);
    const deps = depsFor(db, model, 1);
    let shuttingDown = false;
    model.onCall = (call) => {
      if (call.kind !== "triage") return;
      shuttingDown = true;
      model.onCall = null;
    };
    const first = await runAnalysis(await claimOne(db), deps, {
      shuttingDown: () => shuttingDown,
    });
    expect(first.status).toBe("interrupted");
    expect(searchRow(db)).toMatchObject({
      status: "running",
      stage: "triage",
      stop_requested: false,
      heartbeat_at: null,
      finished_at: null,
    });
    expect((await db.countTriage(SEARCH)).pending).toBe(49);

    // The next boot: a missing heartbeat is stale whatever the cutoff, so the row is claimed without the two-minute wait.
    const claimed = await db.claimAnalyses("proc:2", new Date(NOW), 10);
    expect(claimed.map((row) => row.id)).toEqual([SEARCH]);
    const row = claimed[0];
    if (!row) throw new Error("the interrupted run was not claimed");
    const second = await runAnalysis(row, deps);
    expect(second.status).toBe("done");
    expect(searchRow(db)).toMatchObject({ status: "done", runner: "proc:2" });
    expect(model.calls.filter((call) => call.kind === "triage").map(cardsOf)).toEqual([40, 40, 9]);
  });

  it("fails with a code the person can act on, the stage kept, and never retries by itself", async () => {
    const missing = scenario();
    missing.db.briefs.clear();
    const gone = await runAnalysis(await claimOne(missing.db), depsFor(missing.db, missing.model));
    expect(gone).toMatchObject({ status: "failed", code: "brief_missing" });
    expect(searchRow(missing.db)).toMatchObject({ status: "failed", error: "brief_missing" });

    const unmodelled = scenario();
    const noModel = await runAnalysis(await claimOne(unmodelled.db), depsFor(unmodelled.db, null));
    expect(noModel).toMatchObject({ status: "failed", code: "model_unavailable" });

    const down = scenario();
    down.model.provider = { status: 503 };
    const deps = depsFor(down.db, down.model);
    const provider = await runAnalysis(await claimOne(down.db), deps);
    expect(provider).toMatchObject({ status: "failed", code: "model_unavailable" });
    expect(deps.sleeps).toEqual([2000, 6000, 15000, 30000, 60000]);
    expect(down.model.calls).toHaveLength(6);
    expect(searchRow(down.db)).toMatchObject({
      status: "failed",
      stage: "reading",
      finished_at: NOW,
    });
    expect(down.db.usage).toHaveLength(0);

    // A rate limit that names its wait is waited for when that is longer than the ladder's step.
    const limited = scenario();
    limited.model.provider = { status: 429, headers: { "retry-after": "10" } };
    const limitedDeps = depsFor(limited.db, limited.model);
    expect(await runAnalysis(await claimOne(limited.db), limitedDeps)).toMatchObject({
      status: "failed",
      code: "model_unavailable",
    });
    expect(limitedDeps.sleeps).toEqual([10000, 10000, 15000, 30000, 60000]);

    // A brief whose text changed since the search read profiles on its earlier reading: a new analysis, never this one.
    const changed = scenario();
    const brief = briefOf();
    changed.db.briefs.set(BRIEF, {
      ...brief,
      role_profile: {
        title: "Contrôleur de gestion",
        domain: "finance",
        seniority: "senior",
        missions: ["a", "b", "c"],
        sourceHash: "deadbeef",
        createdAt: NOW,
      },
    });
    changed.db.triage.set(
      `${SEARCH}:${candidateId(1)}`,
      triageRowOf(SEARCH, candidateId(1), { verdict: "no", reason: "Autre métier" }),
    );
    const refused = await runAnalysis(
      await claimOne(changed.db),
      depsFor(changed.db, changed.model),
    );
    expect(refused).toMatchObject({ status: "failed", code: "brief_changed" });
    expect(changed.model.calls).toHaveLength(0);
  });
});

describe("AnalysisRunner", () => {
  it("claims the queued rows and the stale running ones at boot, never a fresh one, never more than its room", async () => {
    const db = new FakeDb();
    const model = new FakeModel();
    poolOf(db, 3, false);
    db.briefs.set(BRIEF, briefOf());
    const stale = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const queued = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const fresh = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    db.searches.set(
      stale,
      searchOf({
        id: stale,
        status: "running",
        stage: "triage",
        runner: "old:1",
        started_at: "2026-10-15T09:00:00.000Z",
        heartbeat_at: "2026-10-15T09:50:00.000Z",
        created_at: "2026-10-15T09:00:00.000Z",
      }),
    );
    db.searches.set(queued, searchOf({ id: queued, created_at: "2026-10-15T09:30:00.000Z" }));
    db.searches.set(
      fresh,
      searchOf({
        id: fresh,
        status: "running",
        runner: "other:2",
        heartbeat_at: "2026-10-15T09:59:30.000Z",
        created_at: "2026-10-15T09:45:00.000Z",
      }),
    );
    const runner = new AnalysisRunner(depsFor(db, model), {
      intervalMs: 0,
      maxRuns: 2,
      name: "proc:1",
    });
    expect(await runner.claim()).toBe(2);
    expect(runner.running).toBe(2);
    expect(await runner.claim()).toBe(0);
    expect(await runner.drain(5_000)).toBe(true);
    expect(runner.running).toBe(0);
    expect(searchRow(db, stale)).toMatchObject({ status: "done", runner: "proc:1" });
    expect(searchRow(db, queued)).toMatchObject({ status: "done", runner: "proc:1" });
    expect(searchRow(db, fresh)).toMatchObject({ status: "running", runner: "other:2" });
    expect(await runner.claim()).toBe(0);
    runner.stop();
    expect(await runner.claim()).toBe(0);
  });

  it("runs one more pass after a claim asked while a pass ran: a row stored after the pass read the table waits for no scan", async () => {
    const db = new FakeDb();
    const model = new FakeModel();
    poolOf(db, 3, false);
    db.briefs.set(BRIEF, briefOf());
    const runner = new AnalysisRunner(depsFor(db, model), {
      intervalMs: 0,
      maxRuns: 2,
      name: "proc:1",
    });
    // The pass reads the table before the row is stored; the poke lands while it runs.
    const pass = runner.claim();
    runner.poke(SEARCH);
    db.searches.set(SEARCH, searchOf());
    expect(await pass).toBe(0);
    // The pass that follows claims the row (and, against the fake model, may well have run it already).
    await tick();
    expect(await runner.drain(5_000)).toBe(true);
    expect(searchRow(db)).toMatchObject({ status: "done", runner: "proc:1" });
    runner.stop();
  });
});

/** A results entry as the promotion writes one, before any reading. */
function entryStub(index: number): MatchResult {
  return {
    candidateId: candidateId(index),
    score: 50,
    coverage: 1,
    blocked: false,
    verdicts: [],
    why: null,
    retrieval: { textRank: null, vectorRank: null },
  };
}
