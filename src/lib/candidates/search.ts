/**
 * The list's search box as a PostgREST `or` filter over the name, the
 * headline and the location. The typed text goes into an ilike pattern,
 * so the characters that would break the filter syntax (commas,
 * parentheses, quotes, backslashes) and the pattern's own wildcard (%)
 * are replaced by spaces first. Pure, tested in search.test.ts.
 */

export const SEARCH_COLUMNS = ["full_name", "headline", "location"] as const;

const UNSAFE = /[,()"\\%]/g;

/** The text as it may sit inside the filter: no syntax characters, one space between words. */
export function cleanSearch(text: string): string {
  return text.replace(UNSAFE, " ").replace(/\s+/g, " ").trim();
}

/** The argument of supabase-js `.or()` for the text, or null when nothing is left to match. */
export function searchOrFilter(text: string): string | null {
  const clean = cleanSearch(text);
  if (!clean) return null;
  return SEARCH_COLUMNS.map((column) => `${column}.ilike.%${clean}%`).join(",");
}
