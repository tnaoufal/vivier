/**
 * Server side of the team: inviting someone (the token is minted and
 * hashed here, the row written with the service role, the email sent when
 * Resend is set up) and the public preview an invitation link shows
 * before the person signs in. Both run behind the rate limiter; the
 * invite needs an administrator of the organisation.
 */
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";

import type { InvitationRow, OrganizationRow, ProfileRow } from "@/lib/db/types";
import { emailLayout, emailSetup, sendRecorded, type EmailSetup } from "@/lib/email/email.server";
import { AppError, appErrorCode } from "@/lib/server/errors";
import { enforceRateLimit } from "@/lib/server/rate-limit.server";
import { settings, siteOriginOf } from "@/lib/server/settings.server";
import { SupabaseRequestError, db, requireMember } from "@/lib/server/supabase.server";

import { invitationEmail } from "./invitation-email";
import { seatsAvailable } from "./seats";
import { isTokenShaped, randomToken, sha256Hex } from "./token";

const inviteInput = z.object({
  accessToken: z.string(),
  orgId: z.uuid(),
  email: z.email().max(254),
  role: z.enum(["admin", "member", "viewer"]),
});

export interface InviteResult {
  invitationId: string;
  /** The link the person opens; shown to the inviter when no email went out. */
  link: string;
  emailed: boolean;
}

type OrgForInvite = Pick<OrganizationRow, "id" | "name" | "locale" | "seat_limit">;

/** The origin the browser is on, for a link when SITE_URL is not set. */
function requestOrigin(): string | null {
  try {
    return new URL(getRequest().url).origin;
  } catch {
    return null;
  }
}

function log(event: string, detail: Record<string, unknown>): void {
  console.error("[team]", JSON.stringify({ event, ...detail }));
}

export const inviteMember = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => inviteInput.parse(data))
  .handler(async ({ data }): Promise<InviteResult> => {
    const member = await requireMember(data.accessToken, data.orgId, "admin");
    await enforceRateLimit("email", { userKey: member.userId });
    const client = db();
    const email = data.email.trim().toLowerCase();

    const [org] = await client.select<OrgForInvite>(
      `organizations?select=id,name,locale,seat_limit&id=eq.${encodeURIComponent(data.orgId)}&limit=1`,
    );
    if (!org) throw new AppError("NOT_FOUND");

    const used = await client.rpc<unknown>("seats_used", { p_org: data.orgId });
    if (!seatsAvailable(Number(used), org.seat_limit)) throw new AppError("ORG:seats");

    const profiles = await client.select<{ id: string }>(
      `profiles?select=id&email=eq.${encodeURIComponent(email)}&limit=1`,
    );
    const existing = profiles[0];
    if (existing) {
      const memberships = await client.select<{ user_id: string }>(
        `memberships?select=user_id&org_id=eq.${encodeURIComponent(data.orgId)}&user_id=eq.${encodeURIComponent(existing.id)}&limit=1`,
      );
      if (memberships.length) throw new Error("TEAM:already_member");
    }

    const token = randomToken();
    const tokenHash = await sha256Hex(token);
    let invitation: InvitationRow | undefined;
    try {
      [invitation] = await client.insert<InvitationRow>("invitations", [
        { org_id: data.orgId, email, role: data.role, token_hash: tokenHash, invited_by: member.userId },
      ]);
    } catch (error) {
      if (error instanceof SupabaseRequestError && error.code === "23505") throw new Error("TEAM:duplicate");
      throw error;
    }
    if (!invitation) throw new Error("invitations answered no row");

    try {
      await client.insert("activities", [
        {
          org_id: data.orgId,
          actor_id: member.userId,
          kind: "member.invited",
          target_type: "invitation",
          target_id: invitation.id,
          payload: { email, role: data.role },
        },
      ]);
    } catch (error) {
      log("activity_failed", { invitationId: invitation.id, error: String(error).slice(0, 200) });
    }

    let setup: EmailSetup | null = null;
    try {
      setup = emailSetup();
    } catch (error) {
      if (appErrorCode(error) !== "SETUP:email") throw error;
    }
    const origin = setup?.siteUrl ?? siteOriginOf(settings().siteUrl) ?? requestOrigin() ?? "";
    const link = `${origin}/invite/${token}`;

    let emailed = false;
    if (setup) {
      try {
        const [inviter] = await client.select<Pick<ProfileRow, "display_name" | "email">>(
          `profiles?select=display_name,email&id=eq.${encodeURIComponent(member.userId)}&limit=1`,
        );
        const inviterName = inviter?.display_name?.trim() || inviter?.email || member.email || "Vivier";
        const content = invitationEmail({
          locale: org.locale,
          orgName: org.name,
          inviterName,
          role: data.role,
          link,
        });
        const { html, text } = emailLayout({
          title: content.title,
          paragraphs: content.paragraphs,
          button: content.button,
          footer: content.footer,
        });
        await sendRecorded(setup, {
          orgId: data.orgId,
          kind: "invitation",
          invitationId: invitation.id,
          to: email,
          subject: content.subject,
          html,
          text,
          createdBy: member.userId,
        });
        emailed = true;
      } catch (error) {
        // A failed send must not fail the invitation: the inviter gets the link instead.
        log("invitation_email_failed", {
          invitationId: invitation.id,
          error: error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200),
        });
      }
    }

    return { invitationId: invitation.id, link, emailed };
  });

const previewInput = z.object({ token: z.string().min(16).max(128) });

export type InvitationPreview =
  | { notFound: true }
  | {
      notFound: false;
      orgName: string;
      role: "admin" | "member" | "viewer";
      email: string;
      expired: boolean;
      used: boolean;
    };

interface PreviewRow {
  email: string;
  role: "admin" | "member" | "viewer";
  expires_at: string;
  accepted_at: string | null;
  organizations: { name: string } | null;
}

/** What the link shows anyone who opens it: the organisation and the role, nothing more. */
export const previewInvitation = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => previewInput.parse(data))
  .handler(async ({ data }): Promise<InvitationPreview> => {
    await enforceRateLimit("share");
    if (!isTokenShaped(data.token)) return { notFound: true };
    const hash = await sha256Hex(data.token);
    const rows = await db().select<PreviewRow>(
      `invitations?select=email,role,expires_at,accepted_at,organizations(name)&token_hash=eq.${hash}&limit=1`,
    );
    const row = rows[0];
    if (!row) return { notFound: true };
    return {
      notFound: false,
      orgName: row.organizations?.name ?? "",
      role: row.role,
      email: row.email,
      expired: new Date(row.expires_at).getTime() < Date.now(),
      used: row.accepted_at !== null,
    };
  });
