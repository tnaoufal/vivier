/**
 * Mentions in comments, pure and tested on its own. A mention is written
 * "@Name" in the body (the name as the team sees it) and recorded as the
 * member's id in comments.mentions[]. This module reads the "@Name"
 * tokens of a body against the members map (ids out, segments to
 * render), and helps the composer: the "@query" being typed at the
 * caret, the members it matches, the text once one is picked.
 */

export interface MentionMember {
  id: string;
  name: string;
}

export type MentionSegment =
  | { kind: "text"; text: string }
  | { kind: "mention"; text: string; userId: string };

/** Accents and case away, so "@Jose" finds "José". */
export function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
}

function isWordChar(char: string | undefined): boolean {
  return char !== undefined && /[\p{L}\p{N}_]/u.test(char);
}

function usable(members: readonly MentionMember[]): MentionMember[] {
  return members
    .filter((member) => member.id && member.name.trim().length > 0)
    .map((member) => ({ id: member.id, name: member.name.trim() }))
    .sort((a, b) => b.name.length - a.name.length);
}

/**
 * Splits a body into plain text and the "@Name" tokens that name a
 * member. Longest names are tried first, so "@Ana Lopez" is not read as
 * "@Ana" followed by " Lopez"; a token must end at a word boundary, so
 * "@Ana" does not match inside "@Anaïs".
 */
export function renderMentions(body: string, members: readonly MentionMember[]): MentionSegment[] {
  const candidates = usable(members);
  const segments: MentionSegment[] = [];
  let text = "";
  let index = 0;
  while (index < body.length) {
    const char = body[index] ?? "";
    if (char === "@" && (index === 0 || !isWordChar(body[index - 1]))) {
      const found = candidates.find((member) => {
        const end = index + 1 + member.name.length;
        const slice = body.slice(index + 1, end);
        return slice.length === member.name.length && fold(slice) === fold(member.name) && !isWordChar(body[end]);
      });
      if (found) {
        if (text) segments.push({ kind: "text", text });
        text = "";
        const end = index + 1 + found.name.length;
        segments.push({ kind: "mention", text: body.slice(index, end), userId: found.id });
        index = end;
        continue;
      }
    }
    text += char;
    index += 1;
  }
  if (text) segments.push({ kind: "text", text });
  return segments;
}

/** The ids of the members a body mentions, each once, in order of appearance. */
export function parseMentions(body: string, members: readonly MentionMember[]): string[] {
  const ids: string[] = [];
  for (const segment of renderMentions(body, members)) {
    if (segment.kind === "mention" && !ids.includes(segment.userId)) ids.push(segment.userId);
  }
  return ids;
}

export const MENTION_QUERY_MAX = 40;

export interface MentionQuery {
  /** Index of the "@" in the text. */
  start: number;
  /** What was typed after it, up to the caret. */
  query: string;
}

/**
 * The "@query" being typed just before the caret, or null when the
 * caret is not inside one: no "@" before it, an "@" glued to a word
 * (an email address), a line break since, or too long a query.
 */
export function mentionQuery(text: string, caret: number): MentionQuery | null {
  const before = text.slice(0, Math.max(0, Math.min(caret, text.length)));
  const start = before.lastIndexOf("@");
  if (start < 0) return null;
  if (start > 0 && isWordChar(before[start - 1])) return null;
  const query = before.slice(start + 1);
  if (query.length > MENTION_QUERY_MAX || /[\r\n]/.test(query)) return null;
  return { start, query };
}

/** The members whose name (or one of its words) starts with the query; the first `limit` when it is empty. */
export function filterMembers(
  members: readonly MentionMember[],
  query: string,
  limit = 6,
): MentionMember[] {
  const needle = fold(query.trim());
  const sorted = [...members]
    .filter((member) => member.id && member.name.trim())
    .sort((a, b) => a.name.localeCompare(b.name));
  const matches = needle
    ? sorted.filter((member) => {
        const name = fold(member.name);
        return name.startsWith(needle) || name.split(/\s+/).some((word) => word.startsWith(needle));
      })
    : sorted;
  return matches.slice(0, Math.max(0, limit));
}

/** Replaces the "@query" (from `start` to the caret) with "@Name " and says where the caret lands. */
export function insertMention(
  text: string,
  start: number,
  caret: number,
  name: string,
): { text: string; caret: number } {
  const inserted = `@${name.trim()} `;
  const next = text.slice(0, start) + inserted + text.slice(Math.max(start, caret));
  return { text: next, caret: start + inserted.length };
}
