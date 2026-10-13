/**
 * Paths into the areas the brief page links to (candidates, shortlists),
 * as plain strings: those routes belong to other teams and their files
 * may not be in the tree when this area is typechecked, so no route
 * literal here is checked against it.
 */

export function candidatePath(candidateId: string): string {
  return `/app/candidates/${encodeURIComponent(candidateId)}`;
}

export function shortlistPath(shortlistId: string): string {
  return `/app/shortlists/${encodeURIComponent(shortlistId)}`;
}
