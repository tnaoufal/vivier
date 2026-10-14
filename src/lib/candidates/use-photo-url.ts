/**
 * The React side of photos.ts: the signed URL of a candidate's photo for
 * an Avatar, null while it is being signed, when the organisation does
 * not show photos, when the profile has none, or when signing failed
 * (the initials stay: a photo is a convenience, never a blocker). The
 * first render already answers from the cache, so a list that re-renders
 * never flickers back to initials.
 */
import { useEffect, useState } from "react";

import { requireSupabase } from "@/lib/auth/supabase-client";

import { photoUrlCache, signedPhotoUrl } from "./photos";

interface Signed {
  path: string;
  url: string;
}

export function usePhotoUrl(path: string | null | undefined, enabled: boolean = true): string | null {
  const key = enabled && path ? path : null;
  const [signed, setSigned] = useState<Signed | null>(() => {
    const cached = key ? photoUrlCache.lookup(key) : null;
    return key && cached ? { path: key, url: cached } : null;
  });

  useEffect(() => {
    if (!key) return;
    const cached = photoUrlCache.lookup(key);
    if (cached) {
      setSigned({ path: key, url: cached });
      return;
    }
    let live = true;
    void (async () => {
      try {
        const supabase = await requireSupabase();
        const url = await signedPhotoUrl(supabase, key);
        if (live) setSigned({ path: key, url });
      } catch (error) {
        console.warn("[photos] sign failed", error);
      }
    })();
    return () => {
      live = false;
    };
  }, [key]);

  return key && signed?.path === key ? signed.url : null;
}
