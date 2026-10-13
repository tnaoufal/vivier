/**
 * Transactional email through Resend (README "Email"): invitations and
 * shared shortlists, nothing else, nothing marketing. Every send is a
 * row in email_sends written here with the service role; the row id is
 * the idempotency key so a retry never sends twice. RESEND_API_KEY lives
 * only in the Cloudflare dashboard. Without it, callers answer
 * SETUP:email and the page says the email is not set up.
 */
import { BRAND } from "@/lib/brand";
import type { EmailSendRow } from "@/lib/db/types";
import { AppError } from "@/lib/server/errors";
import { settings, siteOriginOf } from "@/lib/server/settings.server";
import { db } from "@/lib/server/supabase.server";

export interface OutgoingEmail {
  /** The email_sends row id, sent as the idempotency key. */
  id: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string | null;
}

export interface EmailSender {
  send(message: OutgoingEmail): Promise<{ id: string }>;
}

export function resendSender(input: {
  apiKey: string;
  from: string;
  replyTo: string | null;
  fetchImpl?: typeof fetch;
}): EmailSender {
  const fetchImpl = input.fetchImpl ?? fetch;
  return {
    send: async (message) => {
      const response = await fetchImpl("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${input.apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": message.id,
        },
        body: JSON.stringify({
          from: input.from,
          to: [message.to],
          ...(message.replyTo || input.replyTo ? { reply_to: message.replyTo ?? input.replyTo } : {}),
          subject: message.subject,
          html: message.html,
          text: message.text,
        }),
      });
      if (response.status === 409) return { id: "" };
      if (!response.ok) throw new Error(`Resend answered HTTP ${response.status}`);
      const json = (await response.json()) as { id?: unknown };
      return { id: typeof json.id === "string" ? json.id : "" };
    },
  };
}

export interface EmailSetup {
  sender: EmailSender;
  siteUrl: string;
}

/** The sender and the site origin for links, or a SETUP error when either is missing. */
export function emailSetup(): EmailSetup {
  const s = settings();
  const siteUrl = siteOriginOf(s.siteUrl);
  if (!s.resend.apiKey || !siteUrl) throw new AppError("SETUP:email");
  return {
    sender: resendSender({ apiKey: s.resend.apiKey, from: s.resend.from ?? BRAND.emailFrom, replyTo: s.resend.replyTo }),
    siteUrl,
  };
}

export interface SendInput {
  orgId: string;
  kind: EmailSendRow["kind"];
  shareId?: string | null;
  invitationId?: string | null;
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string | null;
  createdBy: string;
}

/**
 * Records the send, sends, records the outcome. The row exists before
 * the send (status queued) so a crash in between leaves a trace; the
 * outcome is sent or failed with a short reason, never the key.
 */
export async function sendRecorded(setup: EmailSetup, input: SendInput): Promise<EmailSendRow> {
  const client = db();
  const [row] = await client.insert<EmailSendRow>("email_sends", [
    {
      org_id: input.orgId,
      kind: input.kind,
      share_id: input.shareId ?? null,
      invitation_id: input.invitationId ?? null,
      to_email: input.to,
      subject: input.subject,
      status: "queued",
      created_by: input.createdBy,
    },
  ]);
  if (!row) throw new Error("email_sends answered no row");
  try {
    const { id } = await setup.sender.send({
      id: row.id,
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
      replyTo: input.replyTo ?? null,
    });
    const [sent] = await client.patch<EmailSendRow>(
      "email_sends",
      { id: row.id },
      { status: "sent", provider_id: id || null, sent_at: new Date().toISOString() },
    );
    return sent ?? { ...row, status: "sent" };
  } catch (error) {
    const reason = error instanceof Error ? error.message.slice(0, 200) : "send failed";
    await client.patch("email_sends", { id: row.id }, { status: "failed", error: reason }).catch(() => undefined);
    console.error("[email]", JSON.stringify({ event: "send_failed", id: row.id, kind: input.kind, error: reason }));
    throw new Error("EMAIL:failed");
  }
}

/** Escapes text for an HTML email body. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * The one email layout: a white card, the product name, a title, the
 * paragraphs, one button. Inline styles only (email clients). `paragraphs`
 * are plain text, escaped here.
 */
export function emailLayout(input: {
  title: string;
  paragraphs: string[];
  button?: { label: string; url: string } | null;
  footer: string;
}): { html: string; text: string } {
  const paragraphsHtml = input.paragraphs
    .map((p) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.55;color:#1f2a24">${escapeHtml(p)}</p>`)
    .join("");
  const buttonHtml = input.button
    ? `<p style="margin:22px 0 6px"><a href="${escapeHtml(input.button.url)}" style="display:inline-block;background:#2f7a5b;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 22px;border-radius:999px">${escapeHtml(input.button.label)}</a></p><p style="margin:0 0 14px;font-size:12px;color:#6b7470;word-break:break-all">${escapeHtml(input.button.url)}</p>`
    : "";
  const html = `<!doctype html><html><body style="margin:0;background:#f4f7f5;padding:28px 12px;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center"><table role="presentation" width="560" style="max-width:560px;width:100%;background:#ffffff;border:1px solid #e3e9e5;border-radius:16px" cellspacing="0" cellpadding="0"><tr><td style="padding:28px 32px"><p style="margin:0 0 18px;font-size:13px;font-weight:700;letter-spacing:.02em;color:#2f7a5b">${escapeHtml(BRAND.name)}</p><h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:#141c17">${escapeHtml(input.title)}</h1>${paragraphsHtml}${buttonHtml}<p style="margin:22px 0 0;font-size:12px;line-height:1.5;color:#6b7470">${escapeHtml(input.footer)}</p></td></tr></table></td></tr></table></body></html>`;
  const text = [input.title, "", ...input.paragraphs, ...(input.button ? ["", `${input.button.label}: ${input.button.url}`] : []), "", input.footer].join("\n");
  return { html, text };
}
