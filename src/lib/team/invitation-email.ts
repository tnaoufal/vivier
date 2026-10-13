/**
 * The words of the invitation email, in the organisation's language.
 * Pure: the server function hands the result to emailLayout() and Resend.
 * Role names match messages.ts (role.*) so the email and the page agree.
 */
import type { Locale, OrgRole } from "@/lib/db/types";

export interface InvitationEmailInput {
  locale: Locale;
  orgName: string;
  /** The inviter's display name or email; never empty (the caller falls back). */
  inviterName: string;
  role: Exclude<OrgRole, "owner">;
  link: string;
}

export interface InvitationEmailContent {
  subject: string;
  title: string;
  paragraphs: string[];
  button: { label: string; url: string };
  footer: string;
}

const ROLE_WORDS: Record<Locale, Record<Exclude<OrgRole, "owner">, string>> = {
  fr: { admin: "administrateur", member: "membre", viewer: "lecteur" },
  en: { admin: "administrator", member: "member", viewer: "viewer" },
};

export function invitationEmail(input: InvitationEmailInput): InvitationEmailContent {
  const role = ROLE_WORDS[input.locale][input.role];
  if (input.locale === "en") {
    const title = `You are invited to join ${input.orgName} on Vivier`;
    return {
      subject: title,
      title,
      paragraphs: [
        `${input.inviterName} invites you to join ${input.orgName} as ${role}.`,
        "Vivier is the team's shared talent pool: CVs, briefs and shortlists in one place. Sign in with this email address to accept.",
      ],
      button: { label: "Join", url: input.link },
      footer: "This link expires in 7 days. If you were not expecting this invitation, ignore this email.",
    };
  }
  const title = `Vous êtes invité à rejoindre ${input.orgName} sur Vivier`;
  return {
    subject: title,
    title,
    paragraphs: [
      `${input.inviterName} vous invite à rejoindre ${input.orgName} en tant que ${role}.`,
      "Vivier est le vivier de talents partagé de l'équipe : CV, briefs et shortlists au même endroit. Connectez-vous avec cette adresse email pour accepter.",
    ],
    button: { label: "Rejoindre", url: input.link },
    footer: "Ce lien expire dans 7 jours. Si vous n'attendiez pas cette invitation, ignorez cet email.",
  };
}
