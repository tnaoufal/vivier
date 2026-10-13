/**
 * The criteria of a brief as data: the kinds, the weights, a parser that
 * reads briefs.criteria (JSON the browser wrote, or the model proposed)
 * defensively, and the small helpers the editor, the proposals and the
 * server share. Pure, no React, tested in criteria.test.ts.
 */
import { z } from "zod";

import type { BriefCriterion, CriterionKind } from "@/lib/db/types";

export const CRITERION_KINDS: readonly CriterionKind[] = [
  "skill",
  "experience",
  "language",
  "location",
  "education",
  "availability",
  "other",
];

export type Weight = BriefCriterion["weight"];

export const WEIGHTS: readonly Weight[] = [1, 2, 3];

export const LABEL_MAX = 80;
export const VALUE_MAX = 200;
/** More rows than this would not be read by anyone; the editor and the parser stop there. */
export const CRITERIA_MAX = 40;

export function isCriterionKind(value: unknown): value is CriterionKind {
  return typeof value === "string" && (CRITERION_KINDS as readonly string[]).includes(value);
}

/** 1, 2 or 3 from any number (a model may answer 2.0 or 4), 2 when it is not a number. */
export function toWeight(value: unknown): Weight {
  if (typeof value !== "number" || !Number.isFinite(value)) return 2;
  const rounded = Math.round(value);
  if (rounded <= 1) return 1;
  if (rounded >= 3) return 3;
  return 2;
}

const storedCriterion = z.object({
  id: z.string().min(1).max(64),
  kind: z.enum(["skill", "experience", "language", "location", "education", "availability", "other"]),
  label: z.string().max(LABEL_MAX * 4),
  value: z.string().max(VALUE_MAX * 4),
  required: z.boolean(),
  weight: z.union([z.literal(1), z.literal(2), z.literal(3)]),
});

/**
 * The criteria of a briefs.criteria value: invalid entries are dropped,
 * labels and values trimmed and capped, duplicate ids kept once (the
 * first). Never throws: a brief with a damaged column still opens.
 */
export function parseCriteria(value: unknown): BriefCriterion[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: BriefCriterion[] = [];
  for (const item of value) {
    const parsed = storedCriterion.safeParse(item);
    if (!parsed.success) continue;
    const label = parsed.data.label.trim().slice(0, LABEL_MAX);
    const criterionValue = parsed.data.value.trim().slice(0, VALUE_MAX);
    if (!label || !criterionValue || seen.has(parsed.data.id)) continue;
    seen.add(parsed.data.id);
    out.push({
      id: parsed.data.id,
      kind: parsed.data.kind,
      label,
      value: criterionValue,
      required: parsed.data.required,
      weight: parsed.data.weight,
    });
    if (out.length >= CRITERIA_MAX) break;
  }
  return out;
}

/** A criterion with a fresh id (crypto.randomUUID(), or the one given for tests). */
export function withId(
  criterion: Omit<BriefCriterion, "id">,
  id: string = crypto.randomUUID(),
): BriefCriterion {
  return { id, ...criterion };
}

/** An empty row for the editor, of a kind. */
export function emptyCriterion(kind: CriterionKind = "skill", id?: string): BriefCriterion {
  const base: Omit<BriefCriterion, "id"> = { kind, label: "", value: "", required: false, weight: 2 };
  return id === undefined ? withId(base) : withId(base, id);
}

/** True when a row has both a label and a value: what is saved. */
export function isComplete(criterion: Pick<BriefCriterion, "label" | "value">): boolean {
  return criterion.label.trim().length > 0 && criterion.value.trim().length > 0;
}

/** The rows worth saving: complete ones, trimmed and capped, in order. */
export function cleanCriteria(criteria: readonly BriefCriterion[]): BriefCriterion[] {
  return criteria.filter(isComplete).map((criterion) => ({
    ...criterion,
    label: criterion.label.trim().slice(0, LABEL_MAX),
    value: criterion.value.trim().slice(0, VALUE_MAX),
  }));
}

/** True when two lists would save the same JSON (same order, same fields). */
export function sameCriteria(a: readonly BriefCriterion[], b: readonly BriefCriterion[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((criterion, index) => {
    const other = b[index];
    return (
      other !== undefined &&
      other.id === criterion.id &&
      other.kind === criterion.kind &&
      other.label === criterion.label &&
      other.value === criterion.value &&
      other.required === criterion.required &&
      other.weight === criterion.weight
    );
  });
}

/** True when the list already holds a criterion with the same kind and value (case and accents apart). */
export function hasSimilar(criteria: readonly BriefCriterion[], candidate: Pick<BriefCriterion, "kind" | "value">): boolean {
  const key = fold(candidate.value);
  return criteria.some((criterion) => criterion.kind === candidate.kind && fold(criterion.value) === key);
}

function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function kindKey(kind: CriterionKind): `briefs.kind.${CriterionKind}` {
  return `briefs.kind.${kind}`;
}

export function weightKey(weight: Weight): `briefs.weight.${Weight}` {
  return `briefs.weight.${weight}`;
}
