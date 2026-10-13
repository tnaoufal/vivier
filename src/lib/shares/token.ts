/**
 * Share tokens: 32 random bytes encoded base64url for the link, their
 * SHA-256 (hex) for the row. The raw token is shown once, at creation,
 * and never stored: shares.token_hash is all the database keeps, so a
 * leaked table does not open a single presentation. Web Crypto only: it
 * exists in the Worker, in Node 22 and in the browser.
 */

/** Base64url (RFC 4648 §5) without padding. */
export function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i] ?? 0);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** A fresh token of `byteLength` random bytes (32 by default: 43 characters). */
export function randomToken(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64url(bytes);
}

/** Lower-case hex SHA-256 of the UTF-8 text. */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** What a token in a link may look like; anything else is refused before any read. */
export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

export function isTokenShaped(value: string): boolean {
  return TOKEN_PATTERN.test(value);
}
