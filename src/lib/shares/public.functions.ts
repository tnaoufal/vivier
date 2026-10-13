/**
 * The public read behind a presentation link: no sign-in, throttled,
 * the token hashed before any lookup. Answers the presentation when
 * the share is active (and counts the view, best effort), or says why
 * the link no longer opens: missing, revoked, expired. Never the row's
 * ids, never a CV link when CVs were not included.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import type { Locale, ShareItem } from "@/lib/db/types";
import { enforceRateLimit } from "@/lib/platform/rate-limit.server";
import { db } from "@/lib/platform/supabase.server";

import { errorText, findShareByToken, itemsOf, log, orgOf } from "./shares.server";
import { shareState } from "./state";

// Any string: a malformed or truncated link answers "missing" (findShareByToken
// checks the shape), never a validation error that would land on the error page.
const tokenInput = z.object({ token: z.string().max(128) });

export type PublicShare =
  | { state: "missing" }
  | { state: "revoked" }
  | { state: "expired" }
  | {
      state: "ok";
      orgName: string;
      locale: Locale;
      title: string;
      intro: string;
      items: ShareItem[];
      createdAt: string;
      expiresAt: string;
    };

export const getShare = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => tokenInput.parse(data))
  .handler(async ({ data }): Promise<PublicShare> => {
    await enforceRateLimit("share");
    const client = db();
    const row = await findShareByToken(client, data.token);
    if (!row) return { state: "missing" };
    const state = shareState(row);
    if (state === "revoked") return { state: "revoked" };
    if (state === "expired") return { state: "expired" };
    // Best effort: a view that cannot be counted still opens the page.
    await client
      .patch("shares", { id: row.id }, { view_count: row.view_count + 1, last_viewed_at: new Date().toISOString() })
      .catch((error: unknown) => log("view_count_failed", { shareId: row.id, error: errorText(error) }));
    const org = orgOf(row);
    return {
      state: "ok",
      orgName: org?.name ?? "",
      locale: org?.locale === "en" ? "en" : "fr",
      title: row.title,
      intro: row.intro,
      items: itemsOf(row),
      createdAt: row.created_at,
      expiresAt: row.expires_at,
    };
  });
