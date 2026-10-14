import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import {
  EXPORT_PHOTO_TTL_SECONDS,
  PHOTO_CACHE_MARGIN_MS,
  PHOTO_URL_TTL_SECONDS,
  SignedUrlCache,
  expiryOf,
  exportPhoto,
  photoSigner,
  signedPhotoUrl,
} from "./photos";

const TTL = PHOTO_URL_TTL_SECONDS * 1000;

describe("SignedUrlCache", () => {
  it("remembers a URL until a minute before it expires", () => {
    const cache = new SignedUrlCache(TTL);
    cache.remember("o1/c1.png", "https://signed/1", 1_000);
    expect(cache.lookup("o1/c1.png", 1_000)).toBe("https://signed/1");
    expect(cache.lookup("o1/c1.png", 1_000 + TTL - PHOTO_CACHE_MARGIN_MS - 1)).toBe("https://signed/1");
    expect(cache.lookup("o1/c1.png", 1_000 + TTL - PHOTO_CACHE_MARGIN_MS)).toBeNull();
    // An expired entry is gone for good.
    expect(cache.size).toBe(0);
  });

  it("keeps paths apart and forgets on demand", () => {
    const cache = new SignedUrlCache(TTL);
    cache.remember("a", "ua", 0);
    cache.remember("b", "ub", 0);
    expect(cache.lookup("a", 1)).toBe("ua");
    expect(cache.lookup("c", 1)).toBeNull();
    cache.forget("a");
    expect(cache.lookup("a", 1)).toBeNull();
    expect(cache.lookup("b", 1)).toBe("ub");
    cache.clear();
    expect(cache.size).toBe(0);
  });

  it("signs once for every caller of the same path, then answers from memory", async () => {
    const cache = new SignedUrlCache(TTL);
    let calls = 0;
    const sign = async (path: string, expiresIn: number) => {
      calls += 1;
      expect(expiresIn).toBe(PHOTO_URL_TTL_SECONDS);
      return `https://signed/${path}/${calls}`;
    };
    const clock = () => 5_000;
    const [first, second] = await Promise.all([
      cache.resolve("o1/c1.png", sign, clock),
      cache.resolve("o1/c1.png", sign, clock),
    ]);
    expect(first).toBe("https://signed/o1/c1.png/1");
    expect(second).toBe(first);
    expect(await cache.resolve("o1/c1.png", sign, clock)).toBe(first);
    expect(calls).toBe(1);
    // Another path is its own request.
    expect(await cache.resolve("o1/c2.png", sign, clock)).toBe("https://signed/o1/c2.png/2");
  });

  it("forgets a failed signing so the next call tries again", async () => {
    const cache = new SignedUrlCache(TTL);
    let fail = true;
    const sign = async (path: string) => {
      if (fail) throw new Error("storage down");
      return `https://signed/${path}`;
    };
    await expect(cache.resolve("p", sign)).rejects.toThrow("storage down");
    fail = false;
    expect(await cache.resolve("p", sign)).toBe("https://signed/p");
  });
});

/** The slice of supabase-js the signer touches. */
function fakeSupabase(answer: { signedUrl?: string } | null, error: { message: string } | null = null) {
  const calls: { bucket: string; path: string; expiresIn: number }[] = [];
  const client = {
    storage: {
      from: (bucket: string) => ({
        createSignedUrl: async (path: string, expiresIn: number) => {
          calls.push({ bucket, path, expiresIn });
          return { data: answer, error };
        },
      }),
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

describe("photoSigner", () => {
  it("signs in the photos bucket and refuses an empty answer", async () => {
    const ok = fakeSupabase({ signedUrl: "https://signed/x" });
    expect(await photoSigner(ok.client)("o1/c1.png", 600)).toBe("https://signed/x");
    expect(ok.calls).toEqual([{ bucket: "photos", path: "o1/c1.png", expiresIn: 600 }]);
    const empty = fakeSupabase(null);
    await expect(photoSigner(empty.client)("o1/c1.png", 600)).rejects.toThrow("no signed URL");
    const failed = fakeSupabase(null, { message: "denied" });
    await expect(photoSigner(failed.client)("o1/c1.png", 600)).rejects.toEqual({ message: "denied" });
  });

  it("serves a page's rows through the cache", async () => {
    const cache = new SignedUrlCache(TTL);
    const supabase = fakeSupabase({ signedUrl: "https://signed/y" });
    expect(await signedPhotoUrl(supabase.client, "o1/c1.png", cache)).toBe("https://signed/y");
    expect(await signedPhotoUrl(supabase.client, "o1/c1.png", cache)).toBe("https://signed/y");
    expect(supabase.calls.length).toBe(1);
  });
});

describe("exportPhoto", () => {
  it("signs one hour outside the cache, and says when the link dies", async () => {
    const now = new Date("2026-10-14T10:00:00Z");
    const supabase = fakeSupabase({ signedUrl: "https://signed/export" });
    expect(await exportPhoto(supabase.client, "o1/c1.png", now)).toEqual({
      path: "o1/c1.png",
      url: "https://signed/export",
      expiresAt: "2026-10-14T11:00:00.000Z",
    });
    expect(supabase.calls[0]?.expiresIn).toBe(EXPORT_PHOTO_TTL_SECONDS);
    expect(await exportPhoto(supabase.client, null, now)).toBeNull();
    expect(expiryOf(now, 60)).toBe("2026-10-14T10:01:00.000Z");
  });
});
