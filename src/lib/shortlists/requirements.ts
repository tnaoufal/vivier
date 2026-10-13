/**
 * What the card and the drawer of a shortlist item show of its match,
 * read from the match the item carries: the assessed score (the model's,
 * 0..100; the deterministic score is another scale and reads apart as a
 * muted number), one row per requirement for the shared RequirementList
 * (from the assessment when a model answered, else from the
 * deterministic verdicts), and the model's sentences. The rows follow
 * the criteria the match carries when it has them (the search's, as
 * they were), else the brief's as given. Pure and tested; a thing the
 * match does not say is "unknown", never a lack.
 */
import type { RequirementRow } from "@/components/app-shell/requirement-list";
import { parseCriteria } from "@/lib/briefs/criteria";
import type { BriefCriterion, CriterionVerdict, MatchResult, RequirementMet } from "@/lib/db/types";

import { isVerdict } from "./tally";

const VERDICT_TO_MET: Record<CriterionVerdict, RequirementMet> = {
  match: "yes",
  partial: "partial",
  missing: "no",
  not_stated: "unknown",
};

const MET_VALUES: readonly RequirementMet[] = ["yes", "partial", "no", "unknown"];

export type MatchLike = Pick<MatchResult, "verdicts" | "assessment"> & Partial<Pick<MatchResult, "criteria">>;

/** The criteria the rows follow: the match's own snapshot when it carries one, else the brief's as given. */
export function criteriaOf(criteria: readonly BriefCriterion[], match: Pick<MatchLike, "criteria">): readonly BriefCriterion[] {
  const own = parseCriteria(match.criteria);
  return own.length ? own : criteria;
}

/** The model's answer as the row stores it, else "unknown": a value the schema does not know is not read as a lack. */
function asMet(value: unknown): RequirementMet {
  return typeof value === "string" && (MET_VALUES as readonly string[]).includes(value) ? (value as RequirementMet) : "unknown";
}

function metOfVerdict(value: unknown): RequirementMet {
  return isVerdict(value) ? VERDICT_TO_MET[value] : "unknown";
}

function evidenceOf(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** The assessment's fit score 0..100, rounded; null when no model assessed the item (the ring then shows a dash). */
export function assessedScore(match: Pick<MatchResult, "assessment"> | null | undefined): number | null {
  const score = match?.assessment?.score;
  if (typeof score !== "number" || !Number.isFinite(score)) return null;
  return Math.round(Math.max(0, Math.min(100, score)));
}

/**
 * One row per criterion (the match's own when it carries them, else the
 * brief's), in that order: the assessment's answer when the model gave
 * one, else the deterministic verdict (found → yes, in part → partial,
 * absent → no, not stated → unknown), else unknown. A requirement the
 * match still speaks about although the criteria dropped it is kept at
 * the end under `unknownLabel`, so nothing the match says disappears.
 * No match, no rows.
 */
export function requirementRowsOf(
  criteria: readonly BriefCriterion[],
  match: MatchLike | null | undefined,
  unknownLabel: string,
): RequirementRow[] {
  if (!match) return [];
  const assessed = new Map<string, { met: unknown; evidence: unknown }>();
  // Guarded like the verdicts: a stored assessment that drifted from the schema must not take the drawer down.
  const requirements = match.assessment?.requirements;
  for (const row of Array.isArray(requirements) ? requirements : []) {
    if (row && typeof row.criterionId === "string" && !assessed.has(row.criterionId)) assessed.set(row.criterionId, row);
  }
  const verdicts = new Map<string, { verdict: unknown; evidence: unknown }>();
  for (const row of Array.isArray(match.verdicts) ? match.verdicts : []) {
    if (row && typeof row.criterionId === "string" && !verdicts.has(row.criterionId)) verdicts.set(row.criterionId, row);
  }

  const rows: RequirementRow[] = [];
  const seen = new Set<string>();
  for (const criterion of criteriaOf(criteria, match)) {
    seen.add(criterion.id);
    const answer = assessed.get(criterion.id);
    const verdict = verdicts.get(criterion.id);
    if (answer) {
      rows.push({ id: criterion.id, label: criterion.label, required: criterion.required, met: asMet(answer.met), evidence: evidenceOf(answer.evidence) });
    } else {
      rows.push({
        id: criterion.id,
        label: criterion.label,
        required: criterion.required,
        met: verdict ? metOfVerdict(verdict.verdict) : "unknown",
        evidence: verdict ? evidenceOf(verdict.evidence) : null,
      });
    }
  }
  for (const [id, answer] of assessed) {
    if (seen.has(id)) continue;
    seen.add(id);
    rows.push({ id, label: unknownLabel, required: false, met: asMet(answer.met), evidence: evidenceOf(answer.evidence) });
  }
  for (const [id, verdict] of verdicts) {
    if (seen.has(id)) continue;
    seen.add(id);
    rows.push({ id, label: unknownLabel, required: false, met: metOfVerdict(verdict.verdict), evidence: evidenceOf(verdict.evidence) });
  }
  return rows;
}

/** The model's sentences on the match: the assessment's summary, else the search's "why"; null when no model spoke. */
export function modelReading(match: Pick<MatchResult, "why" | "assessment"> | null | undefined): string | null {
  if (!match) return null;
  return text(match.assessment?.summary) ?? text(match.why);
}
