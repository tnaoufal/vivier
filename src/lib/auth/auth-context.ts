/**
 * Auth context, hook and OAuth-hash helpers, kept apart from the provider
 * component so the provider file only exports a component (React Fast
 * Refresh boundary).
 */
import { createContext, useContext } from "react";
import type { Session, User } from "@supabase/supabase-js";

export interface AuthResult {
  /** A sentence for the person (see auth-errors.ts), null on success. */
  error: string | null;
  /** Supabase's error code when it gave one (e.g. `email_not_confirmed`). */
  code?: string | undefined;
}

export interface SignUpResult extends AuthResult {
  /** True when the address already has an account: nothing was created. */
  existingAccount: boolean;
  /** True when the session started at once (no confirmation email to wait for). */
  signedIn: boolean;
}

export interface AuthContextValue {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signInWithPassword: (email: string, password: string) => Promise<AuthResult>;
  signUpWithPassword: (email: string, password: string) => Promise<SignUpResult>;
  signInWithGoogle: () => Promise<AuthResult>;
  sendPasswordReset: (email: string) => Promise<AuthResult>;
  updatePassword: (password: string) => Promise<AuthResult>;
  signOut: () => Promise<void>;
  /** True after the person arrived through a password-reset link. */
  passwordRecovery: boolean;
  clearPasswordRecovery: () => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}

const OAUTH_ERROR_FALLBACK = "Sign-in did not complete. Try again.";

/** A fixed sentence per error code Supabase Auth may send back; the free text of the hash is never shown. */
const OAUTH_ERROR_MESSAGES: Record<string, string> = {
  access_denied: "Sign-in was cancelled before it completed.",
  provider_disabled: "Signing in with this provider is not enabled here.",
  oauth_provider_not_supported: "Signing in with this provider is not enabled here.",
  provider_email_needs_verification:
    "Confirm the email address with the provider first, then sign in again.",
  email_not_confirmed: "Confirm your email address first, then sign in again.",
  signup_disabled: "New accounts cannot be created here at the moment.",
  user_banned: "This account cannot sign in.",
  identity_already_exists: "This provider account is already linked to another account.",
  over_request_rate_limit: "Too many attempts. Wait a minute, then try again.",
};

export function oauthErrorMessage(hash: string): string {
  const params = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  for (const key of ["error_code", "error"]) {
    const code = params.get(key)?.trim().toLowerCase();
    const message = code ? OAUTH_ERROR_MESSAGES[code] : undefined;
    if (message) return message;
  }
  return OAUTH_ERROR_FALLBACK;
}

/**
 * Supabase reports an OAuth failure by redirecting back with
 * `#error_description=...` in the URL hash. Reads and clears it once so
 * the shell can show it as a toast.
 */
export function consumeOAuthErrorFromUrl(): string | null {
  if (typeof window === "undefined" || !window.location.hash) return null;
  const hash = window.location.hash;
  const params = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  if (!params.has("error_description") && !params.has("error")) return null;
  const message = oauthErrorMessage(hash);
  params.delete("error");
  params.delete("error_code");
  params.delete("error_description");
  const rest = params.toString();
  window.history.replaceState(
    null,
    "",
    `${window.location.pathname}${window.location.search}${rest ? `#${rest}` : ""}`,
  );
  return message;
}

let expectedSignOut = false;

/** Marks the sign-out the person asked for, so the provider does not warn about it. */
export function expectSignOut(): void {
  expectedSignOut = true;
}

export function consumeExpectedSignOut(): boolean {
  const was = expectedSignOut;
  expectedSignOut = false;
  return was;
}
