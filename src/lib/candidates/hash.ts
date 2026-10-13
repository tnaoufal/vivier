/**
 * Content hash of a CV before it is uploaded: SHA-256 as lowercase hex,
 * through Web Crypto, which browsers and Node 22 share. The hash is the
 * documents (org_id, sha256) key, so the same file is never stored twice
 * for an organisation.
 */

export async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** The hash of a file (or any Blob), read fully into memory first. */
export async function hashFile(file: Blob): Promise<string> {
  return sha256Hex(await file.arrayBuffer());
}
