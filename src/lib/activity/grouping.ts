/**
 * The feed's presentation helpers, pure: rows grouped by the day they
 * happened (today, yesterday, then dated), and a sentence split so the
 * actor's name can be set in a heavier weight than the rest. Nothing
 * here changes what a sentence says; describe.ts owns the words.
 */
import type { ActivityRow } from "@/lib/db/types";

export type DayLabel = { kind: "today" } | { kind: "yesterday" } | { kind: "date"; iso: string };

export interface DayGroup<Row extends Pick<ActivityRow, "created_at">> {
  /** The local calendar day, "YYYY-MM-DD", stable as a React key. */
  key: string;
  label: DayLabel;
  rows: Row[];
}

/** The local calendar day of an instant, "YYYY-MM-DD"; an unreadable date reads as the empty key. */
export function dayKey(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Today, yesterday, or the date itself, read against `now` in the local time zone. */
export function labelOfDay(key: string, now: Date = new Date()): DayLabel {
  const today = dayKey(now.toISOString());
  if (key === today) return { kind: "today" };
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 12);
  if (key === dayKey(yesterday.toISOString())) return { kind: "yesterday" };
  return { kind: "date", iso: key };
}

/**
 * Consecutive rows of the same day under one label, in the order given
 * (the feed is newest first, so the groups are too). A row without a
 * readable date joins the group before it rather than making its own.
 */
export function groupByDay<Row extends Pick<ActivityRow, "created_at">>(
  rows: readonly Row[],
  now: Date = new Date(),
): DayGroup<Row>[] {
  const groups: DayGroup<Row>[] = [];
  for (const row of rows) {
    const key = dayKey(row.created_at);
    const last = groups[groups.length - 1];
    if (last && (key === "" || last.key === key)) {
      last.rows.push(row);
      continue;
    }
    groups.push({ key, label: labelOfDay(key, now), rows: [row] });
  }
  return groups;
}

/**
 * A sentence that starts with the actor's name, split in two so the
 * name can be emphasised: ["Ana Lu", " a retenu…"]. A sentence that
 * does not start with the name (a system event: "cv.pdf a été traité")
 * comes back whole as its second part, the first part empty.
 */
export function splitActor(sentence: string, actor: string | null): [string, string] {
  if (actor && actor.length > 0 && sentence.startsWith(actor)) {
    return [actor, sentence.slice(actor.length)];
  }
  return ["", sentence];
}
