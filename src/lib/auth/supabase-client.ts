/**
 * Browser Supabase client, loaded on demand.
 *
 * Runs Supabase Auth (email/password + Google OAuth) and, once signed in,
 * reads and writes the organisation's rows under Row Level Security
 * (supabase/migrations). The SDK is imported lazily: the landing page
 * never needs it, so the library only loads when a session already exists
 * in this browser or when the person opens the sign-in flow.
 *
 * VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY are safe to ship to the
 * browser: the publishable key is gated entirely by RLS, not a secret.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env["VITE_SUPABASE_URL"] as string | undefined;
const supabasePublishableKey = import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"] as
  | string
  | undefined;

export const isSupabaseConfigured = Boolean(supabaseUrl && supabasePublishableKey);

let clientPromise: Promise<SupabaseClient | null> | undefined;

/** Resolves the shared client, importing the SDK on first use. */
export function loadSupabase(): Promise<SupabaseClient | null> {
  if (!isSupabaseConfigured) return Promise.resolve(null);
  if (!clientPromise) {
    const attempt: Promise<SupabaseClient | null> = import("@supabase/supabase-js").then(
      ({ createClient }) => createClient(supabaseUrl!, supabasePublishableKey!),
    );
    // A failed chunk load (offline, a deploy in between) must not pin every
    // later call to the same rejection: the next call imports again.
    attempt.catch(() => {
      if (clientPromise === attempt) clientPromise = undefined;
    });
    clientPromise = attempt;
  }
  return clientPromise;
}

/** The client, or a thrown sentence when this deployment has no accounts. */
export async function requireSupabase(): Promise<SupabaseClient> {
  const client = await loadSupabase();
  if (!client) throw new Error("AUTH:not_configured");
  return client;
}

/**
 * True when supabase-js left a session in this browser (its storage key is
 * `sb-<project-ref>-auth-token`), or when an OAuth round trip is in flight.
 */
export function hasStoredSupabaseSession(): boolean {
  if (typeof window === "undefined") return false;
  if (hasPendingAuthCallback(window.location)) return true;
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key && key.startsWith("sb-") && key.includes("-auth-token")) return true;
    }
  } catch {
    // Storage may be blocked; treat as signed out.
  }
  return false;
}

/** Pure check for an OAuth/magic-link callback in the URL, kept testable. */
export function hasPendingAuthCallback(location: { search: string; hash: string }): boolean {
  const query = new URLSearchParams(location.search);
  if (query.has("code")) return true;
  const hash = location.hash.startsWith("#") ? location.hash.slice(1) : location.hash;
  return new URLSearchParams(hash).has("access_token");
}
