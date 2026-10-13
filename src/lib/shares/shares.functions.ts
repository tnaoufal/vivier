/**
 * Server side of sharing a shortlist: what this deployment can do (a
 * model, an email sender), the draft of a presentation from the chosen
 * candidates (the model's summaries when asked for and available), the
 * share row itself (its token minted and hashed here, shown once), the
 * emails that carry the link, and the revocation (the public read a
 * link opens is public.functions.ts). Every handler reads the caller
 * from the access token through requireMember() and works only on the
 * organisation it verified; every one runs behind the rate limiter.
 */
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";

import type { ShareItem, ShareRow } from "@/lib/db/types";
import { emailLayout, emailSetup, sendRecorded } from "@/lib/email/email.server";
import { completeJson, modelConfigured } from "@/lib/model/model.server";
import { AppError, appErrorCode } from "@/lib/platform/errors";
import { enforceRateLimit } from "@/lib/platform/rate-limit.server";
import { settings, siteOriginOf } from "@/lib/platform/settings.server";
import { db, requireMember } from "@/lib/platform/supabase.server";
import { recordUsage } from "@/lib/platform/usage.server";

import {
  cleanItems,
  DRAFT_COLUMNS,
  HEADLINE_MAX,
  latestDocumentByCandidate,
  mergeDraft,
  NAME_MAX,
  orderedCandidates,
  plainDraft,
  POINT_MAX,
  POINTS_MAX,
  SHARE_ITEMS_MAX,
  SUMMARY_MAX,
  summaryAnswer,
  summaryMaxTokens,
  summaryPayload,
  summarySystemPrompt,
  type DocumentPick,
  type DraftCandidate,
} from "./draft";
import { MESSAGE_MAX, shareEmail } from "./email";
import { isShareUrl, shareUrlOf } from "./links";
import {
  briefIdOf,
  errorText,
  inList,
  loadOrg,
  loadShare,
  loadShortlist,
  log,
  recordActivity,
  senderName,
} from "./shares.server";
import { EXPIRY_MAX_DAYS, EXPIRY_MIN_DAYS, expiresAtFrom, shareState } from "./state";
import { randomToken, sha256Hex } from "./token";

// ---------------------------------------------------------------------
// inputs
// ---------------------------------------------------------------------

const orgInput = z.object({
  accessToken: z.string().min(1).max(4096),
  orgId: z.uuid(),
});

const draftInput = orgInput.extend({
  shortlistId: z.uuid(),
  candidateIds: z.array(z.uuid()).min(1).max(SHARE_ITEMS_MAX),
  useModel: z.boolean(),
});

const itemInput = z.object({
  candidateId: z.uuid(),
  name: z.string().min(1).max(NAME_MAX),
  headline: z.string().max(HEADLINE_MAX).nullable(),
  summary: z.string().max(SUMMARY_MAX),
  strengths: z.array(z.string().max(POINT_MAX)).max(POINTS_MAX),
  attention: z.array(z.string().max(POINT_MAX)).max(POINTS_MAX),
  documentId: z.uuid().nullable(),
});

const createInput = orgInput.extend({
  shortlistId: z.uuid(),
  title: z.string().min(1).max(200),
  intro: z.string().max(8000),
  items: z.array(itemInput).min(1).max(SHARE_ITEMS_MAX),
  includeCvs: z.boolean(),
  expiresInDays: z.number().int().min(EXPIRY_MIN_DAYS).max(EXPIRY_MAX_DAYS),
});

const sendInput = orgInput.extend({
  shareId: z.uuid(),
  url: z.url().max(2048),
  recipients: z.array(z.email().max(254)).min(1).max(10),
  message: z.string().max(MESSAGE_MAX),
});

const revokeInput = orgInput.extend({ shareId: z.uuid() });

// ---------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------

/** The origin the browser is on, for a link when SITE_URL is not set. */
function requestOrigin(): string | null {
  try {
    return new URL(getRequest().url).origin;
  } catch {
    return null;
  }
}

function siteOrigin(): string {
  return siteOriginOf(settings().siteUrl) ?? requestOrigin() ?? "";
}

// ---------------------------------------------------------------------
// capabilities
// ---------------------------------------------------------------------

export interface ShareCapabilities {
  /** True when a model is set up: the summaries can be drafted. */
  model: boolean;
  /** True when Resend and SITE_URL are set: the link can be emailed. */
  email: boolean;
}

export const shareCapabilities = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => orgInput.parse(data))
  .handler(async ({ data }): Promise<ShareCapabilities> => {
    await requireMember(data.accessToken, data.orgId, "viewer");
    let email = false;
    try {
      emailSetup();
      email = true;
    } catch (error) {
      if (appErrorCode(error) !== "SETUP:email") throw error;
    }
    return { model: modelConfigured(), email };
  });

// ---------------------------------------------------------------------
// the draft
// ---------------------------------------------------------------------

export interface DraftResult {
  items: ShareItem[];
  briefTitle: string;
  orgName: string;
  /** True when the summaries come from the model. */
  modelUsed: boolean;
  /** True when the model was asked and did not answer: the items are the plain draft. */
  modelFailed: boolean;
}

export const draftShare = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => draftInput.parse(data))
  .handler(async ({ data }): Promise<DraftResult> => {
    const member = await requireMember(data.accessToken, data.orgId, "member");
    await enforceRateLimit("share", { userKey: member.userId });
    const client = db();
    const [org, shortlist] = await Promise.all([
      loadOrg(client, member.orgId),
      loadShortlist(client, member.orgId, data.shortlistId),
    ]);
    const ids = [...new Set(data.candidateIds)];
    const rows = await client.select<DraftCandidate>(
      `candidates?select=${DRAFT_COLUMNS}&org_id=eq.${encodeURIComponent(member.orgId)}&id=${inList(ids)}`,
    );
    const candidates = orderedCandidates(ids, rows);
    if (!candidates.length) throw new AppError("NOT_FOUND");
    const documents = await client.select<DocumentPick>(
      `documents?select=id,candidate_id&org_id=eq.${encodeURIComponent(member.orgId)}&status=eq.processed&candidate_id=${inList(candidates.map((c) => c.id))}&order=processed_at.desc.nullslast,created_at.desc`,
    );
    let items = plainDraft(candidates, latestDocumentByCandidate(documents), org.locale);
    let modelUsed = false;
    let modelFailed = false;
    if (data.useModel && modelConfigured()) {
      await enforceRateLimit("model", { userKey: member.userId });
      try {
        const answer = await completeJson({
          system: summarySystemPrompt(org.locale),
          user: JSON.stringify(summaryPayload(shortlist.brief, candidates)),
          schema: summaryAnswer,
          maxTokens: summaryMaxTokens(candidates.length),
        });
        await recordUsage(member.orgId, "summary", answer.usage);
        items = mergeDraft(items, answer.value);
        modelUsed = true;
      } catch (error) {
        log("draft_model_failed", { shortlistId: shortlist.id, candidates: candidates.length, error: errorText(error) });
        modelFailed = true;
      }
    }
    return { items, briefTitle: shortlist.brief.title, orgName: org.name, modelUsed, modelFailed };
  });

// ---------------------------------------------------------------------
// the share
// ---------------------------------------------------------------------

export interface CreateResult {
  shareId: string;
  /** The only time the link exists in clear: the row keeps its hash. */
  url: string;
  expiresAt: string;
}

export const createShare = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => createInput.parse(data))
  .handler(async ({ data }): Promise<CreateResult> => {
    const member = await requireMember(data.accessToken, data.orgId, "member");
    await enforceRateLimit("share", { userKey: member.userId });
    const title = data.title.trim();
    if (!title) throw new AppError("INPUT:invalid");
    const client = db();
    const shortlist = await loadShortlist(client, member.orgId, data.shortlistId);
    const items = cleanItems(data.items);
    if (!items.length) throw new AppError("INPUT:invalid");

    // Every candidate must be the organisation's: the ids are re-verified, never trusted.
    const candidateIds = [...new Set(items.map((item) => item.candidateId))];
    const owned = await client.select<{ id: string }>(
      `candidates?select=id&org_id=eq.${encodeURIComponent(member.orgId)}&id=${inList(candidateIds)}`,
    );
    if (owned.length !== candidateIds.length) throw new AppError("INPUT:invalid");

    // A CV link is kept only for a document of the organisation attached to that very candidate.
    const documentOwner = new Map<string, string | null>();
    const documentIds = [...new Set(items.flatMap((item) => (item.documentId ? [item.documentId] : [])))];
    if (data.includeCvs && documentIds.length) {
      const documents = await client.select<DocumentPick>(
        `documents?select=id,candidate_id&org_id=eq.${encodeURIComponent(member.orgId)}&id=${inList(documentIds)}`,
      );
      for (const document of documents) documentOwner.set(document.id, document.candidate_id);
    }
    const stored: ShareItem[] = items.map((item) => ({
      ...item,
      documentId:
        data.includeCvs && item.documentId && documentOwner.get(item.documentId) === item.candidateId
          ? item.documentId
          : null,
    }));

    const token = randomToken();
    const tokenHash = await sha256Hex(token);
    const [share] = await client.insert<Pick<ShareRow, "id" | "expires_at">>("shares", [
      {
        org_id: member.orgId,
        shortlist_id: shortlist.id,
        token_hash: tokenHash,
        title,
        intro: data.intro.trim(),
        items: stored,
        include_cvs: data.includeCvs,
        expires_at: expiresAtFrom(data.expiresInDays),
        created_by: member.userId,
      },
    ]);
    if (!share) throw new Error("shares answered no row");

    await recordActivity(client, {
      orgId: member.orgId,
      actorId: member.userId,
      kind: "share.created",
      shareId: share.id,
      briefId: shortlist.briefId,
      payload: { title, items: stored.length },
    });

    return { shareId: share.id, url: shareUrlOf(siteOrigin(), token), expiresAt: share.expires_at };
  });

// ---------------------------------------------------------------------
// the emails
// ---------------------------------------------------------------------

export interface SendResult {
  sent: number;
  /** The addresses whose email did not leave; each one is also a failed row in email_sends. */
  failed: string[];
}

export const sendShare = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => sendInput.parse(data))
  .handler(async ({ data }): Promise<SendResult> => {
    const member = await requireMember(data.accessToken, data.orgId, "member");
    await enforceRateLimit("email", { userKey: member.userId });
    const client = db();
    const share = await loadShare(client, member.orgId, data.shareId);
    if (shareState(share) !== "active") throw new Error("SHARE:inactive");
    const setup = emailSetup();
    // The token is not stored, so the browser sends the link back: it must be this site's share link.
    if (!isShareUrl(data.url, setup.siteUrl)) throw new AppError("INPUT:invalid");

    const [org, sender] = await Promise.all([loadOrg(client, member.orgId), senderName(client, member)]);
    const content = shareEmail({
      locale: org.locale,
      orgName: org.name,
      senderName: sender,
      title: share.title,
      message: data.message,
      expiresAt: share.expires_at,
      url: data.url,
    });
    const { html, text } = emailLayout({
      title: content.title,
      paragraphs: content.paragraphs,
      button: content.button,
      footer: content.footer,
    });

    const recipients = [...new Set(data.recipients.map((email) => email.trim().toLowerCase()))];
    let sent = 0;
    const failed: string[] = [];
    for (const to of recipients) {
      try {
        await sendRecorded(setup, {
          orgId: member.orgId,
          kind: "share",
          shareId: share.id,
          to,
          subject: content.subject,
          html,
          text,
          replyTo: member.email,
          createdBy: member.userId,
        });
        sent += 1;
      } catch (error) {
        // One failed address does not stop the others; the row says failed and why.
        failed.push(to);
        log("send_failed", { shareId: share.id, error: errorText(error) });
      }
    }

    if (sent > 0) {
      await recordActivity(client, {
        orgId: member.orgId,
        actorId: member.userId,
        kind: "share.sent",
        shareId: share.id,
        briefId: briefIdOf(share),
        payload: { recipients: sent, title: share.title },
      });
    }
    return { sent, failed };
  });

// ---------------------------------------------------------------------
// revocation
// ---------------------------------------------------------------------

export interface RevokeResult {
  revokedAt: string;
}

export const revokeShare = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => revokeInput.parse(data))
  .handler(async ({ data }): Promise<RevokeResult> => {
    const member = await requireMember(data.accessToken, data.orgId, "member");
    await enforceRateLimit("share", { userKey: member.userId });
    const client = db();
    const share = await loadShare(client, member.orgId, data.shareId);
    if (share.revoked_at) return { revokedAt: share.revoked_at };
    const revokedAt = new Date().toISOString();
    await client.patch("shares", { id: share.id, org_id: member.orgId }, { revoked_at: revokedAt });
    await recordActivity(client, {
      orgId: member.orgId,
      actorId: member.userId,
      kind: "share.revoked",
      shareId: share.id,
      briefId: briefIdOf(share),
      payload: { title: share.title },
    });
    return { revokedAt };
  });
