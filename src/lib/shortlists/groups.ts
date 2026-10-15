/**
 * The pure side of the brief page's list pane, tested on its own: the
 * four groups a brief's profiles fall in (the matches, the near
 * profiles, the shortlist, the profiles set aside), the group a URL
 * names (`g`, or the old `tab`), their counts as the segmented control
 * says them (the near profiles the screening scored but nobody read
 * count with the near ones; a profile retained from a row counts on
 * the shortlist before the next read confirms it), what one row of a
 * group stands for (`ReadingSubject`: a result the model read in full,
 * a profile the screening scored, one the triage set aside, an item of
 * the shortlist), the row the URL selects (the one it names when the
 * list holds it, else the first), and how long a run took. Nothing
 * here reads anything.
 */
import type { MatchResult, TriageVerdict } from "@/lib/db/types";

import type { BoardItem } from "./queries";

export type BriefGroup = "matches" | "near" | "shortlist" | "aside";

export const BRIEF_GROUPS: readonly BriefGroup[] = ["matches", "near", "shortlist", "aside"];

export function isBriefGroup(value: unknown): value is BriefGroup {
  return typeof value === "string" && (BRIEF_GROUPS as readonly string[]).includes(value);
}

/** The group a search names: `g`, else the old `tab` (matches or shortlist, the two views of before), else the matches. */
export function groupOfSearch(search: Readonly<Record<string, unknown>>): BriefGroup {
  const group = search["g"];
  if (isBriefGroup(group)) return group;
  const tab = search["tab"];
  if (tab === "shortlist") return "shortlist";
  return "matches";
}

export interface GroupCounts {
  matches: number;
  near: number;
  shortlist: number;
  aside: number;
}

/**
 * The figure of each group: the matches; the near profiles read in
 * full with the ones the screening scored but nobody read; the
 * candidates on the shortlist as last read, with the ones a row just
 * added until the read confirms them (each counted once); the profiles
 * set aside (the triage's, and the readings' no_fit).
 */
export function groupCountsOf(input: {
  matches: number;
  near: number;
  screened: number;
  shortlisted: Iterable<string>;
  pending?: Iterable<string> | undefined;
  setAside: number;
}): GroupCounts {
  const onShortlist = new Set(input.shortlisted);
  for (const id of input.pending ?? []) onShortlist.add(id);
  return {
    matches: atLeastZero(input.matches),
    near: atLeastZero(input.near) + atLeastZero(input.screened),
    shortlist: onShortlist.size,
    aside: atLeastZero(input.setAside),
  };
}

function atLeastZero(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

/** What one row of a group stands for, and what the detail pane reads. */
export type ReadingSubject =
  /** A result the model read in full: a match, a near profile or one set aside after the reading. */
  | { kind: "result"; candidateId: string; result: MatchResult }
  /** A profile the screening scored that nobody read in full. */
  | { kind: "screened"; candidateId: string; score: number; reason: string | null }
  /** A profile the triage set aside: another job, or a card it could not judge. */
  | {
      kind: "triage";
      candidateId: string;
      verdict: Extract<TriageVerdict, "no" | "unknown">;
      reason: string | null;
    }
  /** A candidate on the shortlist. */
  | { kind: "item"; candidateId: string; item: BoardItem };

/** The candidate ids of the rows, in their order. */
export function subjectIds(subjects: readonly Pick<ReadingSubject, "candidateId">[]): string[] {
  return subjects.map((subject) => subject.candidateId);
}

export interface Selection {
  /** The row's place in the list, -1 for none. */
  index: number;
  id: string | null;
  /** True when the URL names no row of the list although the list has rows: it is rewritten to `id`. */
  stale: boolean;
}

/** The row a group selects for the URL: the one it names when the list holds it, else the first; none for an empty list. */
export function selectionOf(ids: readonly string[], wanted: string | null | undefined): Selection {
  if (ids.length === 0) return { index: -1, id: null, stale: false };
  const index = typeof wanted === "string" ? ids.indexOf(wanted) : -1;
  if (index >= 0) return { index, id: wanted ?? null, stale: false };
  return { index: 0, id: ids[0] ?? null, stale: true };
}

/** How long a run took, in milliseconds: null without both ends, when one is not a date, or when they are out of order. */
export function runDurationMs(
  startedAt: string | null | undefined,
  finishedAt: string | null | undefined,
): number | null {
  if (!startedAt || !finishedAt) return null;
  const started = Date.parse(startedAt);
  const finished = Date.parse(finishedAt);
  if (!Number.isFinite(started) || !Number.isFinite(finished) || finished < started) return null;
  return finished - started;
}

export type DurationParts =
  | { unit: "seconds"; count: number }
  | { unit: "minutes"; count: number }
  | { unit: "hours"; count: number; minutes: number };

/** A duration as the figures a line shows: the seconds under a minute, the minutes (rounded up) under an hour, else hours and minutes. */
export function durationParts(ms: number): DurationParts {
  const seconds = Math.max(0, Math.round((Number.isFinite(ms) ? ms : 0) / 1000));
  if (seconds < 60) return { unit: "seconds", count: seconds };
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return { unit: "minutes", count: minutes };
  return { unit: "hours", count: Math.floor(minutes / 60), minutes: minutes % 60 };
}
