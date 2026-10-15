/**
 * The criteria of a brief as data: the kinds, the weights, the guard,
 * the role criterion and the helpers live in the shared package
 * (packages/analysis/src/criteria.ts, "@vivier/analysis") and are
 * re-exported here so every web import keeps its path. What stays here
 * is the web app's own: the parser that reads briefs.criteria (JSON the
 * browser wrote, or the model proposed) defensively with zod, a row
 * about a protected characteristic left out and counted for the
 * server's log, and the i18n keys of a kind and a weight. Behaviour
 * unchanged; tested in criteria.test.ts (the parser) and next to the
 * package's module (the rest).
 */
import { z } from "zod";

import {
  CRITERIA_MAX,
  isComplete,
  LABEL_MAX,
  protectedCriterion,
  roleCriterion,
  VALUE_MAX,
  type BriefCriterion,
  type CriterionKind,
  type Weight,
} from "@vivier/analysis";

export {
  cleanCriteria,
  CRITERIA_MAX,
  CRITERION_KINDS,
  emptyCriterion,
  hasSimilar,
  isComplete,
  isCriterionKind,
  LABEL_MAX,
  protectedCriterion,
  ROLE_REQUIRED,
  ROLE_WEIGHT,
  roleCriterion,
  roleCriterionOf,
  roleFirst,
  roleFromTitle,
  sameCriteria,
  toWeight,
  VALUE_MAX,
  WEIGHTS,
  withId,
  type Weight,
} from "@vivier/analysis";

const storedCriterion = z.object({
  id: z.string().min(1).max(64),
  kind: z.enum(["role", "skill", "experience", "language", "location", "education", "availability", "other"]),
  label: z.string().max(LABEL_MAX * 4),
  value: z.string().max(VALUE_MAX * 4),
  required: z.boolean(),
  weight: z.union([z.literal(1), z.literal(2), z.literal(3)]),
});

/**
 * The criteria of a briefs.criteria value: invalid entries are dropped,
 * labels and values trimmed and capped, duplicate ids kept once (the
 * first), a second role criterion left out (a brief has one job), and a
 * row about a protected characteristic left out (a row an older client
 * or a write by hand through the API stored: it reaches no payload and
 * no screen; countProtected() lets the server log it). Never throws: a
 * brief with a damaged column still opens.
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
    if (protectedCriterion(label, criterionValue, parsed.data.kind)) continue;
    if (parsed.data.kind === "role" && roleCriterion(out)) continue;
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

/** How many readable entries of a stored criteria column name a protected characteristic: what parseCriteria() left out for that reason. */
export function countProtected(value: unknown): number {
  if (!Array.isArray(value)) return 0;
  let count = 0;
  for (const item of value) {
    const parsed = storedCriterion.safeParse(item);
    if (!parsed.success || !isComplete(parsed.data)) continue;
    if (protectedCriterion(parsed.data.label, parsed.data.value, parsed.data.kind)) count += 1;
  }
  return count;
}

export function kindKey(kind: CriterionKind): `briefs.kind.${CriterionKind}` {
  return `briefs.kind.${kind}`;
}

export function weightKey(weight: Weight): `briefs.weight.${Weight}` {
  return `briefs.weight.${weight}`;
}
