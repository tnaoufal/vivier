/**
 * Pure helpers behind the product's motion: the durations of the charter
 * (the same numbers as the tokens of styles.css), the stagger of a list
 * that unfolds row by row, and the reading of the person's reduced-motion
 * preference. Nothing here touches the DOM beyond a media query the
 * caller hands in, so every helper runs in a node test; the React hook
 * that follows the preference lives in components/app-shell/page-transition.
 */
import type { CSSProperties } from "react";

/** Milliseconds: hover 120, panels and page changes 180, dialogs 240, lists 320. */
export const DURATION = { fast: 120, base: 180, slow: 240, slower: 320 } as const;

/** The wait between two staggered rows, and the row past which no row waits longer. */
export const STAGGER_MS = 40;
export const STAGGER_CAP = 15;

/**
 * The delay of the row at `index` in a list that unfolds: 0 for the first
 * row, then `step` more per row up to `cap` (a long list must not keep
 * its last rows invisible for seconds). A negative or fractional index is
 * read as the row before it.
 */
export function staggerDelay(
  index: number,
  step: number = STAGGER_MS,
  cap: number = STAGGER_CAP,
): number {
  const row = Math.max(0, Math.floor(Number.isFinite(index) ? index : 0));
  return Math.min(row, Math.max(0, cap)) * Math.max(0, step);
}

export type StaggerStyle = CSSProperties & { "--i": number };

/** The inline style a `rise-in` element reads its turn from: `--i`, capped like `staggerDelay`. */
export function staggerVars(index: number, cap: number = STAGGER_CAP): StaggerStyle {
  const row = Math.max(0, Math.floor(Number.isFinite(index) ? index : 0));
  return { "--i": Math.min(row, Math.max(0, cap)) };
}

export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/** The part of a MediaQueryList the helpers use, so a test can hand in a fake. */
export interface MediaQueryLike {
  matches: boolean;
  addEventListener(type: "change", listener: () => void): void;
  removeEventListener(type: "change", listener: () => void): void;
}

/** The browser's reduced-motion query; null on the server or in a browser without matchMedia. */
export function reducedMotionQuery(): MediaQueryLike | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
  try {
    return window.matchMedia(REDUCED_MOTION_QUERY);
  } catch {
    return null;
  }
}

/** True when the query says the person asked for less motion; false without a query (motion is the default). */
export function readsReducedMotion(query: MediaQueryLike | null | undefined): boolean {
  return query?.matches === true;
}

/** The live preference, read once. */
export function prefersReducedMotion(): boolean {
  return readsReducedMotion(reducedMotionQuery());
}

/**
 * Calls `onChange` whenever the preference flips, and returns the way to
 * stop. Shaped for `useSyncExternalStore`: without a query (server,
 * tests) there is nothing to follow and the returned function does nothing.
 */
export function subscribeReducedMotion(
  onChange: () => void,
  query: MediaQueryLike | null = reducedMotionQuery(),
): () => void {
  if (!query) return () => {};
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/** A duration the code drives itself (a timer, a measured transition): zero when motion is reduced. */
export function effectiveDuration(ms: number, reduced: boolean): number {
  return reduced ? 0 : Math.max(0, ms);
}
