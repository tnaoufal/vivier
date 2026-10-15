/**
 * The criteria of a brief as data: the kinds, the weights, the guard
 * that names a criterion about a protected characteristic (such a row
 * is never saved, never sent to a model, never shown: the parser and
 * the clean-up both leave it out; a role's definition, a text about a
 * job, is read with the narrower list, since a job's domain is written
 * with words the full one bans), the role criterion (the job itself:
 * one per brief, required and essential by default, its value the
 * definition the assessment reads first, or the brief's title when no
 * model wrote one), and the small helpers the editor, the proposals
 * and the two apps share. The parser of a stored column (zod) is each
 * app's own (src/lib/briefs/criteria.ts in the web app). Pure, no
 * dependency, tested in criteria.test.ts.
 */
import type { BriefCriterion, BriefSource, CriterionKind } from "./types.js";

export type Weight = BriefCriterion["weight"];

export const WEIGHTS: readonly Weight[] = [1, 2, 3];

export const CRITERION_KINDS: readonly CriterionKind[] = [
  "role",
  "skill",
  "experience",
  "language",
  "location",
  "education",
  "availability",
  "other",
];

export const LABEL_MAX = 80;
/** A value is a thing to find in a profile; a role's value is its definition, which needs the room. */
export const VALUE_MAX = 600;
/** What a role criterion is unless the team changes it: required, essential. */
export const ROLE_REQUIRED = true;
export const ROLE_WEIGHT: Weight = 3;
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

// ---------------------------------------------------------------------
// protected characteristics
// ---------------------------------------------------------------------

/**
 * The words that name a protected characteristic, as whole words, case
 * and accents apart. CORE is what no criterion may carry: age, birth,
 * sex and gender, origin, nationality, religion, disability, pregnancy,
 * marital status, union membership, sexual orientation. WIDER adds the
 * words that name one only in some readings: family, children,
 * politics, a photo. Every criterion is refused on both lists; a role
 * (its definition is prose about a job) on CORE alone, since a job's
 * domain and sector are written with the wider words ("famille de
 * produits", "politique commerciale", "petite enfance", a photographer)
 * and none of them says anything about a person. The assessment prompt
 * forbids using any of it whatever the text carries.
 */
const PROTECTED_CORE = [
  "age", "ages", "aged", "date de naissance", "birth", "born", "sexe", "sex", "gender", "femme", "homme",
  "female", "male", "origine", "origines", "origin", "origins", "ethnic", "ethnie", "ethnique", "race",
  "racial", "nationalite", "nationality", "religion", "religieux", "religieuse", "religious", "confession",
  "handicap", "handicape", "handicapee", "disability", "disabled", "enceinte", "grossesse", "pregnancy",
  "pregnant", "marital", "marie", "mariee", "married", "syndicat", "syndical", "syndicale", "syndique",
  "trade union", "orientation sexuelle", "sexual orientation",
];
const PROTECTED_WIDER = ["famille", "familiale", "family", "enfants", "children", "politique", "political", "photo", "photographie"];

function wordsPattern(words: readonly string[]): RegExp {
  return new RegExp(`(?<![\\p{L}])(${words.join("|")})(?![\\p{L}])`, "u");
}

const PROTECTED = wordsPattern([...PROTECTED_CORE, ...PROTECTED_WIDER]);
const PROTECTED_ROLE = wordsPattern(PROTECTED_CORE);

/**
 * True when a label or value names a protected characteristic: such a
 * criterion is never kept, whether the model proposed it or a person
 * typed it (the editor says so under the row). A role is read on the
 * core list alone (see above); any other kind, or none given, on both.
 */
export function protectedCriterion(label: string, value: string, kind: CriterionKind = "other"): boolean {
  const pattern = kind === "role" ? PROTECTED_ROLE : PROTECTED;
  return pattern.test(fold(label)) || pattern.test(fold(value));
}

/**
 * A fresh UUID from the runtime's crypto (every browser and Node 19 or
 * later have it): the package carries no DOM or Node typings, so the
 * global is read untyped, and a runtime without it is an error, never
 * a made-up id.
 */
function randomId(): string {
  const runtime = globalThis as { crypto?: { randomUUID?: () => string } };
  const id = runtime.crypto?.randomUUID?.();
  if (typeof id !== "string" || !id) throw new Error("crypto.randomUUID is not available");
  return id;
}

/** A criterion with a fresh id (crypto.randomUUID(), or the one given for tests). */
export function withId(
  criterion: Omit<BriefCriterion, "id">,
  id: string = randomId(),
): BriefCriterion {
  return { id, ...criterion };
}

/** An empty row for the editor, of a kind. */
export function emptyCriterion(kind: CriterionKind = "skill", id?: string): BriefCriterion {
  const base: Omit<BriefCriterion, "id"> = { kind, label: "", value: "", required: false, weight: 2 };
  return id === undefined ? withId(base) : withId(base, id);
}

/**
 * The role criterion of a brief: the job as the team names it (label)
 * and its definition (value), required and essential unless the team
 * says otherwise. Built by the extraction, by the search of a brief
 * that has none yet, and by the editor when a row's kind becomes "role".
 */
export function roleCriterionOf(label: string, value: string, id?: string): BriefCriterion {
  const base: Omit<BriefCriterion, "id"> = {
    kind: "role",
    label: label.trim().slice(0, LABEL_MAX),
    value: value.trim().slice(0, VALUE_MAX),
    required: ROLE_REQUIRED,
    weight: ROLE_WEIGHT,
  };
  return id === undefined ? withId(base) : withId(base, id);
}

/**
 * The role of a brief without a model's help: the title (or the first
 * line of the description) stands for the label and the definition, and
 * the team edits it. Null when there is no job to name, and null when
 * that title names a protected characteristic: saved, such a row would
 * be dropped on the next read and derived again on every run.
 */
export function roleFromTitle(brief: BriefSource, id?: string): BriefCriterion | null {
  const title = brief.title.trim() || brief.description.trim().split("\n")[0]?.trim() || "";
  if (!title) return null;
  const role = roleCriterionOf(title, title, id);
  return protectedCriterion(role.label, role.value, "role") ? null : role;
}

/** The brief's role criterion (the first of kind "role"), null when the brief has none yet. */
export function roleCriterion(criteria: readonly BriefCriterion[]): BriefCriterion | null {
  return criteria.find((criterion) => criterion.kind === "role") ?? null;
}

/** The list with the role criterion first, the rest in order: the analysis judges the job before anything else. */
export function roleFirst(criteria: readonly BriefCriterion[]): BriefCriterion[] {
  const role = roleCriterion(criteria);
  return role ? [role, ...criteria.filter((criterion) => criterion !== role)] : [...criteria];
}

/** True when a row has both a label and a value: what is saved. */
export function isComplete(criterion: Pick<BriefCriterion, "label" | "value">): boolean {
  return criterion.label.trim().length > 0 && criterion.value.trim().length > 0;
}

/**
 * The rows worth saving: complete ones, trimmed and capped, in order;
 * never one about a protected characteristic, and one role at most (the
 * first: a brief is one job; the editor says so under a second one).
 */
export function cleanCriteria(criteria: readonly BriefCriterion[]): BriefCriterion[] {
  const out: BriefCriterion[] = [];
  for (const criterion of criteria) {
    if (!isComplete(criterion)) continue;
    const label = criterion.label.trim().slice(0, LABEL_MAX);
    const value = criterion.value.trim().slice(0, VALUE_MAX);
    if (protectedCriterion(label, value, criterion.kind)) continue;
    if (criterion.kind === "role" && roleCriterion(out)) continue;
    out.push({ ...criterion, label, value });
  }
  return out;
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
