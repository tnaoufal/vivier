import { createFileRoute } from "@tanstack/react-router";

import { enforceRateLimit } from "@/lib/platform/rate-limit.server";
import { db, SupabaseRequestError } from "@/lib/platform/supabase.server";
import { findShareByToken, itemsOf, log } from "@/lib/shares/shares.server";
import { shareState } from "@/lib/shares/state";
import { isTokenShaped } from "@/lib/shares/token";

/**
 * The CV behind a presentation: GET /api/share/<token>/cv/<documentId>
 * answers a redirect to a signed link of the private `cvs` object,
 * valid two minutes, when the token opens an active share that includes
 * CVs and carries this document. Anything else is a plain 404: the
 * answer never says whether the share, the document or the file exists,
 * and never carries a storage path. Throttled like the page itself.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PATH = /^\/api\/share\/([^/]+)\/cv\/([^/]+)$/;
const SIGNED_URL_SECONDS = 120;

function answer(status: number, error: string): Response {
  return Response.json({ error }, { status, headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
}

function segment(value: string | undefined): string {
  if (!value) return "";
  try {
    return decodeURIComponent(value);
  } catch {
    return "";
  }
}

async function serveCv(request: Request): Promise<Response> {
  const match = PATH.exec(new URL(request.url).pathname);
  const token = segment(match?.[1]);
  const documentId = segment(match?.[2]);
  if (!isTokenShaped(token) || !UUID.test(documentId)) return answer(404, "Not found");
  try {
    await enforceRateLimit("share");
  } catch {
    return answer(429, "Too many requests");
  }
  try {
    const client = db();
    const share = await findShareByToken(client, token);
    if (!share || shareState(share) !== "active" || !share.include_cvs) return answer(404, "Not found");
    if (!itemsOf(share).some((item) => item.documentId === documentId)) return answer(404, "Not found");
    const [document] = await client.select<{ id: string; storage_path: string }>(
      `documents?select=id,storage_path&id=eq.${documentId}&org_id=eq.${encodeURIComponent(share.org_id)}&limit=1`,
    );
    if (!document) return answer(404, "Not found");
    const url = await client.signUrl("cvs", document.storage_path, SIGNED_URL_SECONDS);
    return new Response(null, {
      status: 302,
      headers: { Location: url, "Cache-Control": "no-store", "X-Robots-Tag": "noindex" },
    });
  } catch (error) {
    // The name and status only: a message could name the object.
    log("cv_failed", {
      documentId,
      error: error instanceof SupabaseRequestError ? `${error.name} ${error.status}` : error instanceof Error ? error.name : "unknown",
    });
    return answer(500, "The file could not be served");
  }
}

export const Route = createFileRoute("/api/share/$token/cv/$documentId")({
  server: {
    handlers: {
      GET: ({ request }) => serveCv(request),
    },
  },
});
