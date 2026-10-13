/**
 * The link of a presentation and the check the email sender runs on
 * the one the browser sends back (the token is not stored, so the
 * browser is the only one who still has the URL): it must be on this
 * site and shaped like a share link, or no email goes out.
 */
import { TOKEN_PATTERN } from "./token";

export const SHARE_PATH = "/share/";

export function shareUrlOf(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, "")}${SHARE_PATH}${token}`;
}

/** The path of the CV endpoint behind a presentation, relative to the site. */
export function shareCvPath(token: string, documentId: string): string {
  return `/api/share/${encodeURIComponent(token)}/cv/${encodeURIComponent(documentId)}`;
}

/** True when `url` is `<origin>/share/<token>` exactly, with no query or hash. */
export function isShareUrl(url: string, origin: string | null): boolean {
  if (!origin) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.origin !== origin) return false;
  if (parsed.search || parsed.hash) return false;
  if (!parsed.pathname.startsWith(SHARE_PATH)) return false;
  const token = parsed.pathname.slice(SHARE_PATH.length);
  return TOKEN_PATTERN.test(token);
}
