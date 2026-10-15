/**
 * The bounded funnel's small rules, shared by the runner and the page:
 * a card with nothing to judge (no headline, no titled position) is
 * "unknown" without a model call (isThinCard, THIN_CARD_REASON); a
 * batch the model cannot answer is read again in halves (splitBatch),
 * and a part of BATCH_MIN cards or fewer that failed BATCH_FAILURES_MAX
 * times settles its cards "unknown" with UNREADABLE_REASON
 * (settlesUnknown), so no batch is retried forever; lotsOf() cuts a
 * list into lots of a size. Pure, no data access; tested in
 * funnel.test.ts.
 */
import type { TriageCard } from "./triage.js";

/** A part of this many cards or fewer is not split further: it fails as a whole, twice at most. */
export const BATCH_MIN = 10;
/** How many times a part of BATCH_MIN cards or fewer may fail before its cards are settled. */
export const BATCH_FAILURES_MAX = 2;
/** The reason stored on a card the model could not read, in the team's language (the reason is shown next to the verdict). */
export const UNREADABLE_REASON = "Fiche illisible par le modèle";
/** The reason stored on a card with nothing to judge, settled without a call. */
export const THIN_CARD_REASON = "Fiche sans poste ni intitulé";

function titled(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * True for a card that carries no headline, no title on the position
 * held today and no title on any earlier position: nothing a model
 * could judge a métier from (a company alone is not a position). Such
 * a card is "unknown" without a call, never "no".
 */
export function isThinCard(card: Pick<TriageCard, "headline" | "current" | "previous">): boolean {
  if (titled(card.headline)) return false;
  if (card.current && titled(card.current.title)) return false;
  return !card.previous.some((position) => titled(position.title));
}

/** The two halves of a batch, the first one larger when the count is odd. */
export function splitBatch<T>(items: readonly T[]): [T[], T[]] {
  const half = Math.ceil(items.length / 2);
  return [items.slice(0, half), items.slice(half)];
}

/** True when a part of `size` cards that failed `failures` times is settled "unknown" instead of being read again. */
export function settlesUnknown(size: number, failures: number): boolean {
  return size <= BATCH_MIN && failures >= BATCH_FAILURES_MAX;
}

/** The items in lots of `size` (one at least), in order. */
export function lotsOf<T>(items: readonly T[], size: number): T[][] {
  const width = Number.isFinite(size) ? Math.max(1, Math.floor(size)) : 1;
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += width)
    out.push(items.slice(index, index + width));
  return out;
}
