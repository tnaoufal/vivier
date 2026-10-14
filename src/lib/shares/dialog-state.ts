/**
 * The state of the share dialog, as a pure reducer: the three steps
 * (content, review, send), the choices of the first step, the edits of
 * the second (the headline, the synthesis, and the three lists of
 * points: strengths, attention, the interview questions), the link and
 * the recipients of the third. Nothing here talks to the network; the
 * dialog dispatches what the server answered.
 */
import type { ShareBrief, ShareItem } from "@/lib/db/types";

import { SHARE_ITEMS_MAX } from "./draft";
import { DEFAULT_EXPIRY_DAYS, type ExpiryDays } from "./state";

export type Step = "content" | "review" | "send";
export const STEPS: readonly Step[] = ["content", "review", "send"];
/** The lists of a sheet the review step edits point by point. */
export type ListField = "strengths" | "attention" | "questions";

export const TITLE_MAX = 200;
export const INTRO_MAX = 8000;
export const RECIPIENTS_MAX = 10;

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
  step: Step;
  /** Candidate ids ticked on the first step, in the shortlist's order of ticking. */
  selected: string[];
  title: string;
  intro: string;
  includeCvs: boolean;
  expiresInDays: ExpiryDays;
  useModel: boolean;
  items: ShareItem[];
  /** The brief as the cover will show it, answered with the draft; null before. */
  brief: ShareBrief | null;
  modelUsed: boolean;
  modelFailed: boolean;
  share: CreatedShare | null;
  recipients: string[];
  recipientDraft: string;
  message: string;
  outcome: SendOutcome | null;
  busy: boolean;
}

export type DialogAction =
  | { type: "reset"; title: string }
  | { type: "setSelected"; candidateIds: string[] }
  | { type: "toggleCandidate"; candidateId: string }
  | { type: "setTitle"; title: string }
  | { type: "setIntro"; intro: string }
  | { type: "setIncludeCvs"; value: boolean }
  | { type: "setExpiresInDays"; days: ExpiryDays }
  | { type: "setUseModel"; value: boolean }
  | { type: "setBusy"; value: boolean }
  | { type: "drafted"; items: ShareItem[]; brief: ShareBrief | null; modelUsed: boolean; modelFailed: boolean }
  | { type: "backToContent" }
  | { type: "setItemHeadline"; index: number; headline: string }
  | { type: "setItemSummary"; index: number; summary: string }
  | { type: "addPoint"; index: number; field: ListField }
  | { type: "setPoint"; index: number; field: ListField; at: number; value: string }
  | { type: "removePoint"; index: number; field: ListField; at: number }
  | { type: "removeItem"; index: number }
  | { type: "created"; share: CreatedShare }
  | { type: "setRecipientDraft"; value: string }
  | { type: "commitRecipients" }
  | { type: "removeRecipient"; email: string }
  | { type: "setMessage"; value: string }
  | { type: "sent"; outcome: SendOutcome };

export function initialState(title: string): DialogState {
  return {
    step: "content",
    selected: [],
    title: title.slice(0, TITLE_MAX),
    intro: "",
    includeCvs: true,
    expiresInDays: DEFAULT_EXPIRY_DAYS,
    useModel: false,
    items: [],
    brief: null,
    modelUsed: false,
    modelFailed: false,
    share: null,
    recipients: [],
    recipientDraft: "",
    message: "",
    outcome: null,
    busy: false,
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

function updateItem(items: ShareItem[], index: number, update: (item: ShareItem) => ShareItem): ShareItem[] {
  return items.map((item, i) => (i === index ? update(item) : item));
}

function updateList(list: string[], at: number, value: string | null): string[] {
  if (value === null) return list.filter((_, i) => i !== at);
  return list.map((entry, i) => (i === at ? value : entry));
}

function withList(item: ShareItem, field: ListField, list: string[]): ShareItem {
  if (field === "strengths") return { ...item, strengths: list };
  if (field === "attention") return { ...item, attention: list };
  return { ...item, questions: list };
}

export function dialogReducer(state: DialogState, action: DialogAction): DialogState {
  switch (action.type) {
    case "reset":
      return initialState(action.title);
    case "setSelected":
      return { ...state, selected: [...new Set(action.candidateIds)].slice(0, SHARE_ITEMS_MAX) };
    case "toggleCandidate": {
      if (state.selected.includes(action.candidateId)) {
        return { ...state, selected: state.selected.filter((id) => id !== action.candidateId) };
      }
      if (state.selected.length >= SHARE_ITEMS_MAX) return state;
      return { ...state, selected: [...state.selected, action.candidateId] };
    }
    case "setTitle":
      return { ...state, title: action.title.slice(0, TITLE_MAX) };
    case "setIntro":
      return { ...state, intro: action.intro.slice(0, INTRO_MAX) };
    case "setIncludeCvs":
      return { ...state, includeCvs: action.value };
    case "setExpiresInDays":
      return { ...state, expiresInDays: action.days };
    case "setUseModel":
      return { ...state, useModel: action.value };
    case "setBusy":
      return { ...state, busy: action.value };
    case "drafted":
      return {
        ...state,
        step: "review",
        items: action.items,
        brief: action.brief,
        modelUsed: action.modelUsed,
        modelFailed: action.modelFailed,
        busy: false,
      };
    case "backToContent":
      return state.step === "review" ? { ...state, step: "content" } : state;
    case "setItemHeadline":
      return { ...state, items: updateItem(state.items, action.index, (item) => ({ ...item, headline: action.headline })) };
    case "setItemSummary":
      return { ...state, items: updateItem(state.items, action.index, (item) => ({ ...item, summary: action.summary })) };
    case "addPoint":
      return {
        ...state,
        items: updateItem(state.items, action.index, (item) => withList(item, action.field, [...item[action.field], ""])),
      };
    case "setPoint":
      return {
        ...state,
        items: updateItem(state.items, action.index, (item) =>
          withList(item, action.field, updateList(item[action.field], action.at, action.value)),
        ),
      };
    case "removePoint":
      return {
        ...state,
        items: updateItem(state.items, action.index, (item) =>
          withList(item, action.field, updateList(item[action.field], action.at, null)),
        ),
      };
    case "removeItem":
      return { ...state, items: state.items.filter((_, i) => i !== action.index) };
    case "created":
      return { ...state, step: "send", share: action.share, busy: false };
    case "setRecipientDraft":
      return { ...state, recipientDraft: action.value };
    case "commitRecipients": {
      const { valid, invalid } = parseRecipients(state.recipientDraft);
      const recipients = [...state.recipients];
      for (const email of valid) {
        if (recipients.length >= RECIPIENTS_MAX) break;
        if (!recipients.includes(email)) recipients.push(email);
      }
      return { ...state, recipients, recipientDraft: invalid.join(", ") };
    }
    case "removeRecipient":
      return { ...state, recipients: state.recipients.filter((email) => email !== action.email) };
    case "setMessage":
      return { ...state, message: action.value };
    case "sent":
      return { ...state, outcome: action.outcome, busy: false };
    default:
      return state;
  }
}

export function titleOk(title: string): boolean {
  const length = title.trim().length;
  return length > 0 && length <= TITLE_MAX;
}

/** The first step may go on: something ticked, a title, nothing running. */
export function canPrepare(state: DialogState): boolean {
  return !state.busy && state.selected.length > 0 && state.selected.length <= SHARE_ITEMS_MAX && titleOk(state.title);
}

/** The review may become a link: every item named, a title, nothing running. */
export function canCreate(state: DialogState): boolean {
  return (
    !state.busy &&
    titleOk(state.title) &&
    state.items.length > 0 &&
    state.items.length <= SHARE_ITEMS_MAX &&
    state.items.every((item) => item.name.trim().length > 0)
  );
}

/** The email may go: a link exists, someone to send to, nothing running. */
export function canSend(state: DialogState): boolean {
  return !state.busy && state.share !== null && state.recipients.length > 0 && state.recipients.length <= RECIPIENTS_MAX;
}

export function stepIndex(step: Step): number {
  return STEPS.indexOf(step);
}
