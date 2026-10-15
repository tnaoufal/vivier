/**
 * Paths into the other areas (candidates, briefs) that the dashboard and
 * the feed link to. Kept as plain strings on purpose: those routes are
 * built by other teams and their files may not exist yet when this area
 * is typechecked, so no route literal here is checked against the tree.
 */

export const CANDIDATES_PATH: string = "/app/candidates";
/** The pool's page with its import dialog opened on arrival (the page reads `import=1` once and drops it). */
export const CANDIDATES_IMPORT_HREF: string = "/app/candidates?import=1";
export const BRIEFS_PATH: string = "/app/briefs";
export const NEW_BRIEF_PATH: string = "/app/briefs/new";

export function briefPath(briefId: string): string {
  return `/app/briefs/${encodeURIComponent(briefId)}`;
}

export function candidatePath(candidateId: string): string {
  return `/app/candidates/${encodeURIComponent(candidateId)}`;
}
