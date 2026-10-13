/**
 * The words of the email that carries a presentation link, in the
 * organisation's language. Pure: the server function hands the result
 * to emailLayout() and Resend. The date is written in full so the
 * reader knows when the link stops working without opening it.
 */
import type { Locale } from "@/lib/db/types";

export const MESSAGE_MAX = 2000;

export interface ShareEmailInput {
  locale: Locale;
  orgName: string;
  /** The sender's display name or email; never empty (the caller falls back). */
  senderName: string;
  title: string;
  /** The sender's own words, possibly empty. */
  message: string;
  expiresAt: string;
  url: string;
}

export interface ShareEmailContent {
  subject: string;
  title: string;
  paragraphs: string[];
  button: { label: string; url: string };
  footer: string;
}

/** "13 octobre 2026" / "13 October 2026"; the ISO text itself when unreadable (never a crash). */
export function longDate(locale: Locale, iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(locale === "fr" ? "fr-FR" : "en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

export function shareEmailSubject(locale: Locale, orgName: string, title: string): string {
  return locale === "en"
    ? `${orgName} shares a shortlist with you: ${title}`
    : `${orgName} vous présente une shortlist : ${title}`;
}

/** The sender's message as paragraphs: blank-line separated, trimmed, empty ones dropped, capped. */
export function messageParagraphs(message: string): string[] {
  return message
    .slice(0, MESSAGE_MAX)
    .split(/\n\s*\n/)
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter((part) => part.length > 0);
}

export function shareEmail(input: ShareEmailInput): ShareEmailContent {
  const date = longDate(input.locale, input.expiresAt);
  const message = messageParagraphs(input.message);
  if (input.locale === "en") {
    return {
      subject: shareEmailSubject("en", input.orgName, input.title),
      title: input.title,
      paragraphs: [
        `${input.senderName} (${input.orgName}) is sharing a selection of profiles with you: ${input.title}.`,
        ...message,
        `The link expires on ${date}. The CVs it opens are confidential: please do not forward them.`,
      ],
      button: { label: "Open the presentation", url: input.url },
      footer: "This link is personal. Vivier makes no decision on your behalf.",
    };
  }
  return {
    subject: shareEmailSubject("fr", input.orgName, input.title),
    title: input.title,
    paragraphs: [
      `${input.senderName} (${input.orgName}) vous présente une sélection de profils : ${input.title}.`,
      ...message,
      `Le lien expire le ${date}. Les CV qu'il ouvre sont confidentiels : merci de ne pas les transmettre.`,
    ],
    button: { label: "Ouvrir la présentation", url: input.url },
    footer: "Ce lien est personnel. Vivier ne prend aucune décision à votre place.",
  };
}
