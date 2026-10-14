/**
 * The order the drawer shows a profile's skills in: the ones a skill
 * criterion of the brief names come first, the rest keep the CV's order
 * (the charter's "the ones relevant to the brief first"). Only `skill`
 * criteria count, since a role's definition would name almost anything;
 * a skill and a criterion match when one holds the other as whole words,
 * accents and case aside, so "R" never reads as "React" and "C" never as
 * "C++". The order only decides which chips show before "+ N"; nothing
 * is scored. Pure, tested in skills.test.ts.
 */
import type { BriefCriterion } from "@/lib/db/types";

import { fold } from "./mentions";

function norm(value: string): string {
  return fold(value).replace(/\s+/g, " ").trim();
}

/** A letter, a digit, or the signs a skill's name carries ("C++", "C#"). */
function isWordChar(char: string | undefined): boolean {
  return char !== undefined && /[\p{L}\p{N}+#]/u.test(char);
}

/** `inner` inside `outer` as whole words: nothing word-like right before or after it. */
function holdsWords(outer: string, inner: string): boolean {
  for (let at = outer.indexOf(inner); at >= 0; at = outer.indexOf(inner, at + 1)) {
    if (!isWordChar(outer[at - 1]) && !isWordChar(outer[at + inner.length])) return true;
  }
  return false;
}

export function relevantFirst(
  skills: readonly string[],
  criteria: readonly Pick<BriefCriterion, "kind" | "label" | "value">[],
): string[] {
  const terms = criteria
    .filter((criterion) => criterion.kind === "skill")
    .flatMap((criterion) => [norm(criterion.label), norm(criterion.value)])
    .filter((term) => term.length > 0);
  if (!terms.length) return [...skills];
  const named = (skill: string): boolean => {
    const own = norm(skill);
    return own.length > 0 && terms.some((term) => holdsWords(term, own) || holdsWords(own, term));
  };
  return [...skills.filter(named), ...skills.filter((skill) => !named(skill))];
}
