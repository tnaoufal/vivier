/**
 * One sentence per activity row, in the person's language, naming the
 * actor and what was touched. Pure: the dictionaries are read directly
 * (messages.ts for roles, features/team.ts for the sentences), so this
 * runs the same in tests and in the feed. A name that was not read is
 * replaced by a generic word, never invented.
 */
import type { ActivityRow, Locale } from "@/lib/db/types";
import { team } from "@/lib/i18n/features/team";
import { en as commonEn, fr as commonFr } from "@/lib/i18n/messages";

export type ActivityFamily =
  | "shortlist"
  | "comment"
  | "brief"
  | "document"
  | "candidate"
  | "share"
  | "member";

export const ACTIVITY_FAMILIES: readonly ActivityFamily[] = [
  "shortlist",
  "comment",
  "brief",
  "document",
  "candidate",
  "share",
  "member",
];

/** The family of a kind ("shortlist.added" -> "shortlist"), null for anything unknown. */
export function activityFamily(kind: string): ActivityFamily | null {
  const head = kind.split(".")[0];
  return (ACTIVITY_FAMILIES as readonly string[]).includes(head ?? "") ? (head as ActivityFamily) : null;
}

/** What the sentence builder may name: people, briefs and candidates by id. */
export interface ActivityNames {
  members: Map<string, string>;
  briefs: Map<string, string>;
  candidates: Map<string, string>;
}

export const EMPTY_NAMES: ActivityNames = { members: new Map(), briefs: new Map(), candidates: new Map() };

type TeamKey = keyof typeof team.fr;
type CommonKey = keyof typeof commonFr;
type Key = TeamKey | CommonKey;

function dictionary(locale: Locale): Record<string, string> {
  return locale === "en" ? { ...commonEn, ...team.en } : { ...commonFr, ...team.fr };
}

/** Fills {placeholders}; an unknown placeholder stays visible rather than vanishing. */
export function fill(sentence: string, params: Record<string, string>): string {
  return sentence.replace(/\{(\w+)\}/g, (match, name: string) => params[name] ?? match);
}

function word(locale: Locale, key: Key, params: Record<string, string> = {}): string {
  return fill(dictionary(locale)[key] ?? key, params);
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function personName(locale: Locale, id: string | null, names: ActivityNames): string {
  if (id === null) return word(locale, "activity.system");
  return names.members.get(id) ?? word(locale, "activity.formerMember");
}

export function describeActivity(row: ActivityRow, locale: Locale, names: ActivityNames): string {
  const payload = row.payload ?? {};
  const actor = personName(locale, row.actor_id, names);
  const candidate =
    (row.candidate_id ? names.candidates.get(row.candidate_id) : undefined) ??
    text(payload["name"]) ??
    word(locale, "activity.someCandidate");
  const brief =
    (row.brief_id ? names.briefs.get(row.brief_id) : undefined) ??
    text(payload["title"]) ??
    word(locale, "activity.someBrief");
  const fileName = text(payload["fileName"]) ?? word(locale, "activity.someFile");
  const params = { actor, candidate, brief, fileName };
  const to = text(payload["to"]);

  switch (row.kind) {
    case "shortlist.added":
      return word(locale, "activity.kind.shortlist.added", params);
    case "shortlist.removed":
      return word(locale, "activity.kind.shortlist.removed", params);
    case "shortlist.status":
      if (to === "retained") return word(locale, "activity.kind.shortlist.retained", params);
      if (to === "dismissed") return word(locale, "activity.kind.shortlist.dismissed", params);
      return word(locale, "activity.kind.shortlist.toReview", params);
    case "shortlist.assigned": {
      if (!to) return word(locale, "activity.kind.shortlist.unassigned", params);
      const assignee = names.members.get(to) ?? word(locale, "activity.someone");
      return word(locale, "activity.kind.shortlist.assigned", { ...params, assignee });
    }
    case "comment.added":
      if (row.candidate_id) return word(locale, "activity.kind.comment.candidate", params);
      if (row.brief_id) return word(locale, "activity.kind.comment.brief", params);
      return word(locale, "activity.kind.comment.added", params);
    case "brief.created":
      return word(locale, "activity.kind.brief.created", params);
    case "brief.status":
      if (to === "open") return word(locale, "activity.kind.brief.open", params);
      if (to === "closed") return word(locale, "activity.kind.brief.closed", params);
      return word(locale, "activity.kind.brief.draft", params);
    case "document.uploaded":
      return word(locale, "activity.kind.document.uploaded", params);
    case "document.processed": {
      const method = text(payload["method"]);
      if (method === "model") return word(locale, "activity.kind.document.processedModel", params);
      if (method === "heuristic") return word(locale, "activity.kind.document.processedHeuristic", params);
      return word(locale, "activity.kind.document.processed", params);
    }
    case "document.failed":
      return word(locale, "activity.kind.document.failed", params);
    case "document.needs_ocr":
      return word(locale, "activity.kind.document.needsOcr", params);
    case "document.rejected":
      return word(locale, "activity.kind.document.rejected", params);
    case "candidate.active":
      return word(locale, "activity.kind.candidate.active", params);
    case "candidate.archived":
      return word(locale, "activity.kind.candidate.archived", params);
    case "candidate.consent":
      if (to === "given") return word(locale, "activity.kind.candidate.consentGiven", params);
      if (to === "withdrawn") return word(locale, "activity.kind.candidate.consentWithdrawn", params);
      return word(locale, "activity.kind.candidate.consentUnknown", params);
    case "candidate.deleted":
      return word(locale, "activity.kind.candidate.deleted", params);
    case "share.created":
      return word(locale, "activity.kind.share.created", params);
    case "share.revoked":
      return word(locale, "activity.kind.share.revoked", params);
    case "share.sent":
      return word(locale, "activity.kind.share.sent", params);
    case "member.invited": {
      const role = text(payload["role"]);
      const roleWord = role && isRole(role) ? word(locale, `role.${role}`) : (role ?? "");
      return word(locale, "activity.kind.member.invited", {
        ...params,
        email: text(payload["email"]) ?? word(locale, "activity.someone"),
        role: roleWord,
      });
    }
    case "member.joined":
      return word(locale, "activity.kind.member.joined", params);
    case "member.removed": {
      const removed = text(payload["userId"]) ?? text(payload["user_id"]) ?? row.target_id;
      if (removed && removed === row.actor_id) return word(locale, "activity.kind.member.left", params);
      const name = (removed ? names.members.get(removed) : undefined) ?? word(locale, "activity.someone");
      return word(locale, "activity.kind.member.removed", { ...params, name });
    }
    default:
      return word(locale, "activity.kind.unknown", { ...params, kind: row.kind });
  }
}

function isRole(value: string): value is "owner" | "admin" | "member" | "viewer" {
  return value === "owner" || value === "admin" || value === "member" || value === "viewer";
}
