/**
 * The signed-in user's access token, readable without a hook. The auth
 * provider keeps it current; the server functions that are gated by plan
 * (drafts, trade marks, WHOIS) send it along so the server can tell who is
 * asking. Null while signed out. Never stored, never logged.
 */
import { hasStoredSupabaseSession, loadSupabase } from "./supabase-client";

let current: string | null = null;

export function setCurrentAccessToken(token: string | null): void {
  current = token;
}

export function getAccessToken(): string | null {
  return current;
}

/** `{ accessToken }` when signed in, `{}` otherwise: spread into a server call's data. */
export function withAccessToken(): { accessToken?: string } {
  return current ? { accessToken: current } : {};
}

/**
 * The token as the SDK holds it now: `getSession()` refreshes a session
 * whose token expired while the tab was idle, so a gated call made right
 * after a long pause carries a token the server still accepts. Falls back
 * to the last token the provider set when the SDK cannot answer; null when
 * no session is stored in this browser.
 */
export async function freshAccessToken(): Promise<string | null> {
  if (!hasStoredSupabaseSession()) return current;
  try {
    const supabase = await loadSupabase();
    if (!supabase) return current;
    const { data, error } = await supabase.auth.getSession();
    if (error) return current;
    current = data.session?.access_token ?? null;
    return current;
  } catch {
    return current;
  }
}
