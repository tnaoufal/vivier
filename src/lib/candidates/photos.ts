/**
 * The candidates' photos, read in the browser from the private `photos`
 * bucket through signed URLs. A list of fifty rows would sign fifty
 * URLs on every render, so a small cache keeps each URL by object path
 * for a little less than the ten minutes Storage honours it, and one
 * request in flight serves every row that asks for the same path. The
 * photo identifies a person in the interface only: it is never read
 * into a prompt, never sent to a model. The export signs a longer link
 * (one hour) outside the cache. The cache is pure and tested in
 * photos.test.ts; the React side is use-photo-url.ts.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export const PHOTO_BUCKET = "photos";

/** How long a signed photo URL stays valid: ten minutes, long enough for a page, short enough to leak little. */
export const PHOTO_URL_TTL_SECONDS = 600;

/** The cache lets a URL go a minute before Storage would refuse it, so an image never starts loading on a link about to expire. */
export const PHOTO_CACHE_MARGIN_MS = 60_000;

/** The export's link lives an hour: the person saves the file and may open it later. */
export const EXPORT_PHOTO_TTL_SECONDS = 3600;

/** Signs one object path for `expiresIn` seconds: the part of supabase-js the cache needs, so a test hands in a fake. */
export type UrlSigner = (path: string, expiresIn: number) => Promise<string>;

/**
 * Signed URLs by object path, each remembered until shortly before it
 * expires. `resolve()` answers from the cache, else joins the request
 * already in flight for that path, else signs once and remembers; a
 * failed signing is forgotten so the next call tries again.
 */
export class SignedUrlCache {
  private readonly entries = new Map<string, { url: string; expiresAt: number }>();
  private readonly pending = new Map<string, Promise<string>>();

  constructor(
    private readonly ttlMs: number,
    private readonly marginMs: number = PHOTO_CACHE_MARGIN_MS,
  ) {}

  /** The URL still good for `path` at `now`, or null. */
  lookup(path: string, now: number = Date.now()): string | null {
    const entry = this.entries.get(path);
    if (!entry) return null;
    if (entry.expiresAt <= now) {
      this.entries.delete(path);
      return null;
    }
    return entry.url;
  }

  remember(path: string, url: string, now: number = Date.now()): void {
    this.entries.set(path, { url, expiresAt: now + Math.max(0, this.ttlMs - this.marginMs) });
  }

  forget(path: string): void {
    this.entries.delete(path);
    this.pending.delete(path);
  }

  clear(): void {
    this.entries.clear();
    this.pending.clear();
  }

  get size(): number {
    return this.entries.size;
  }

  async resolve(path: string, sign: UrlSigner, now: () => number = Date.now): Promise<string> {
    const cached = this.lookup(path, now());
    if (cached) return cached;
    const inFlight = this.pending.get(path);
    if (inFlight) return inFlight;
    const request = sign(path, Math.round(this.ttlMs / 1000)).then(
      (url) => {
        this.pending.delete(path);
        this.remember(path, url, now());
        return url;
      },
      (error: unknown) => {
        this.pending.delete(path);
        throw error;
      },
    );
    this.pending.set(path, request);
    return request;
  }
}

/** The one cache of this browser session. */
export const photoUrlCache = new SignedUrlCache(PHOTO_URL_TTL_SECONDS * 1000);

/** supabase-js as a signer of the photos bucket. */
export function photoSigner(supabase: SupabaseClient): UrlSigner {
  return async (path, expiresIn) => {
    const { data, error } = await supabase.storage.from(PHOTO_BUCKET).createSignedUrl(path, expiresIn);
    if (error) throw error;
    const url = data?.signedUrl;
    if (!url) throw new Error("Storage answered no signed URL");
    return url;
  };
}

/** A signed URL of a candidate's photo, from the cache when one is still good. */
export function signedPhotoUrl(
  supabase: SupabaseClient,
  path: string,
  cache: SignedUrlCache = photoUrlCache,
): Promise<string> {
  return cache.resolve(path, photoSigner(supabase));
}

/** The photo as the export carries it: the object path, a link and when that link stops working. */
export interface ExportPhoto {
  path: string;
  url: string;
  expiresAt: string;
}

/** When a link signed at `now` for `expiresIn` seconds stops working. */
export function expiryOf(now: Date, expiresIn: number): string {
  return new Date(now.getTime() + expiresIn * 1000).toISOString();
}

/** The export's photo link, valid one hour; null when the profile has no photo. The cache is not used: this link outlives it. */
export async function exportPhoto(
  supabase: SupabaseClient,
  path: string | null,
  now: Date = new Date(),
): Promise<ExportPhoto | null> {
  if (!path) return null;
  const url = await photoSigner(supabase)(path, EXPORT_PHOTO_TTL_SECONDS);
  return { path, url, expiresAt: expiryOf(now, EXPORT_PHOTO_TTL_SECONDS) };
}
