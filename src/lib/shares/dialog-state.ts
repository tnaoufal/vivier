/**
 * The state of the share dialog, as a pure reducer, in one step: who
 * goes into the dossier (the retained candidates ticked first), the
 * addresses the link is emailed to and the words that go with it, then
 * the link once the share exists and what left. Nothing to prepare,
 * nothing to review: the dossier takes the reading as the shortlist
 * stores it. Nothing here talks to the network; the dialog dispatches
 * what the server answered.
 */
import { SHARE_ITEMS_MAX } from "./draft";

export const RECIPIENTS_MAX = 10;
export const TITLE_MAX = 200;

export interface CreatedShare {
  shareId: string;
  url: string;
  expiresAt: string;
}

export interface SendOutcome {
  sent: number;
  failed: string[];
}

export interface DialogState {
  /** Candidate ids ticked, in the order of ticking. */
  selected: string[];
  /** The addresses as typed, comma-separated. */
  recipients: string;
  message: string;
  busy: boolean;
  /** The link, once the share exists. */
  share: CreatedShare | null;
  /** What left by email, once sent; null when no email was asked for. */
  outcome: SendOutcome | null;
}

export type DialogAction =
  | { type: "reset" }
  | { type: "setSelected"; candidateIds: string[] }
  | { type: "toggleCandidate"; candidateId: string }
  | { type: "setRecipients"; value: string }
  | { type: "setMessage"; value: string }
  | { type: "setBusy"; value: boolean }
  | { type: "created"; share: CreatedShare }
  | { type: "sent"; outcome: SendOutcome }
  | { type: "failed" };

export function initialState(): DialogState {
  return {
    selected: [],
    recipients: "",
    message: "",
    busy: false,
    share: null,
    outcome: null,
  };
}

/** A plain shape check, the server validates for real. */
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isEmail(value: string): boolean {
  return value.length <= 254 && EMAIL_PATTERN.test(value);
}

/** Addresses typed in one go, split on commas, semicolons and blanks; lower-cased, each once. */
export function parseRecipients(raw: string): { valid: string[]; invalid: string[] } {
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const part of raw.split(/[\s,;]+/)) {
    const email = part.trim().toLowerCase();
    if (!email) continue;
    if (isEmail(email)) {
      if (!valid.includes(email)) valid.push(email);
    } else if (!invalid.includes(email)) {
      invalid.push(email);
    }
  }
  return { valid, invalid };
}

export function dialogReducer(state: DialogState, action: DialogAction): DialogState {
  switch (action.type) {
    case "reset":
      return initialState();
    case "setSelected":
      return { ...state, selected: [...new Set(action.candidateIds)].slice(0, SHARE_ITEMS_MAX) };
    case "toggleCandidate": {
      if (state.selected.includes(action.candidateId)) {
        return { ...state, selected: state.selected.filter((id) => id !== action.candidateId) };
      }
      if (state.selected.length >= SHARE_ITEMS_MAX) return state;
      return { ...state, selected: [...state.selected, action.candidateId] };
    }
    case "setRecipients":
      return { ...state, recipients: action.value };
    case "setMessage":
      return { ...state, message: action.value };
    case "setBusy":
      return { ...state, busy: action.value };
    case "created":
      return { ...state, share: action.share };
    case "sent":
      return { ...state, outcome: action.outcome, busy: false };
    case "failed":
      return { ...state, busy: false };
    default:
      return state;
  }
}

/** The dossier's title: the brief's, clipped; the fallback when the brief has none. */
export function shareTitleOf(briefTitle: string, fallback: string): string {
  const title = briefTitle.replace(/\s+/g, " ").trim().slice(0, TITLE_MAX);
  return title || fallback.slice(0, TITLE_MAX);
}

export type RecipientsProblem = "invalid" | "tooMany";

/** What stops the addresses from being sent to, if anything: a malformed one, or more than the limit. */
export function recipientsProblem(recipients: string): RecipientsProblem | null {
  const { valid, invalid } = parseRecipients(recipients);
  if (invalid.length) return "invalid";
  if (valid.length > RECIPIENTS_MAX) return "tooMany";
  return null;
}

/**
 * The one button may go: someone ticked, nothing running, no link yet,
 * and the addresses (when emails can go out) clean. Without an email
 * sender the field is off and whatever it holds is not read.
 */
export function canShare(state: DialogState, emailReady: boolean): boolean {
  if (state.busy || state.share !== null) return false;
  if (state.selected.length === 0 || state.selected.length > SHARE_ITEMS_MAX) return false;
  return !emailReady || recipientsProblem(state.recipients) === null;
}

/** The addresses the link goes to: none without an email sender or with a problem among them. */
export function recipientsToSend(state: DialogState, emailReady: boolean): string[] {
  if (!emailReady || recipientsProblem(state.recipients) !== null) return [];
  return parseRecipients(state.recipients).valid;
}
