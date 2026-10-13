/**
 * Thin React wrapper around Supabase Auth's own session state.
 *
 * Email/password and Google are the two providers (both must be turned on
 * in the Supabase project's Auth settings). The SDK loads lazily (see
 * supabase-client.ts): on mount only when a session is already stored in
 * this browser or an OAuth callback is pending, otherwise on the first
 * sign-in action.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "@tanstack/react-router";
import type { Session } from "@supabase/supabase-js";

import { useI18n } from "@/lib/i18n";
import { toast } from "@/lib/toast";

import {
  AuthContext,
  consumeExpectedSignOut,
  consumeOAuthErrorFromUrl,
  expectSignOut,
  type AuthContextValue,
} from "./auth-context";
import { friendlyAuthError } from "./auth-errors";
import { setCurrentAccessToken } from "./session-token";
import { hasStoredSupabaseSession, isSupabaseConfigured, loadSupabase } from "./supabase-client";

/** Where an email link (confirmation, Google, reset) brings the browser back. */
function callbackUrl(path = "/app"): string {
  return `${window.location.origin}${path}`;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(isSupabaseConfigured);
  const [listening, setListening] = useState(false);
  const [passwordRecovery, setPasswordRecovery] = useState(false);
  const router = useRouter();
  const hadSessionRef = useRef(false);
  // The locale through a ref: the auth subscription is created once and must not follow it.
  const { locale, t } = useI18n();
  const localeRef = useRef(locale);
  localeRef.current = locale;
  const tRef = useRef(t);
  tRef.current = t;

  useEffect(() => {
    const description = consumeOAuthErrorFromUrl();
    if (description) toast.error(description);
  }, []);

  useEffect(() => {
    setCurrentAccessToken(session?.access_token ?? null);
  }, [session]);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    if (!hasStoredSupabaseSession() && !listening) {
      setLoading(false);
      return;
    }

    let active = true;
    let unsubscribe = () => {};
    void loadSupabase()
      .then((supabase) => {
        if (!active || !supabase) return;
        void supabase.auth
          .getSession()
          .then(({ data }) => {
            if (!active) return;
            setCurrentAccessToken(data.session?.access_token ?? null);
            setSession(data.session);
            if (data.session) hadSessionRef.current = true;
            setLoading(false);
          })
          .catch(() => {
            if (active) setLoading(false);
          });
        const {
          data: { subscription },
        } = supabase.auth.onAuthStateChange((event, next) => {
          setCurrentAccessToken(next?.access_token ?? null);
          setSession(next);
          if (event === "PASSWORD_RECOVERY") {
            setPasswordRecovery(true);
            if (window.location.pathname !== "/app/account") {
              router
                .navigate({ to: "/app/account" })
                .catch(() => window.location.assign("/app/account"));
            }
          }
          if (next) hadSessionRef.current = true;
          if (event === "SIGNED_OUT") {
            const expected = consumeExpectedSignOut();
            if (!expected && hadSessionRef.current) {
              toast.error(tRef.current("auth.sessionEnded"));
            }
            hadSessionRef.current = false;
          }
        });
        unsubscribe = () => subscription.unsubscribe();
      })
      .catch(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [listening, router]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user: session?.user ?? null,
      session,
      loading,
      signInWithPassword: async (email, password) => {
        const supabase = await loadSupabase();
        if (!supabase) return { error: tRef.current("auth.notConfigured") };
        setListening(true);
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        return error ? { error: friendlyAuthError(error, localeRef.current), code: error.code } : { error: null };
      },
      signUpWithPassword: async (email, password) => {
        const supabase = await loadSupabase();
        if (!supabase) return { error: tRef.current("auth.notConfigured"), existingAccount: false, signedIn: false };
        setListening(true);
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: callbackUrl("/app") },
        });
        if (error) {
          return { error: friendlyAuthError(error, localeRef.current), code: error.code, existingAccount: false, signedIn: false };
        }
        // An address that already has an account answers a user without identities.
        const existingAccount = Boolean(data.user && (data.user.identities?.length ?? 0) === 0);
        return { error: null, existingAccount, signedIn: Boolean(data.session) };
      },
      signInWithGoogle: async () => {
        const supabase = await loadSupabase();
        if (!supabase) return { error: tRef.current("auth.notConfigured") };
        setListening(true);
        const { error } = await supabase.auth.signInWithOAuth({
          provider: "google",
          options: { redirectTo: callbackUrl("/app") },
        });
        return error ? { error: friendlyAuthError(error, localeRef.current), code: error.code } : { error: null };
      },
      sendPasswordReset: async (email) => {
        const supabase = await loadSupabase();
        if (!supabase) return { error: tRef.current("auth.notConfigured") };
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: callbackUrl("/app/account"),
        });
        return error ? { error: friendlyAuthError(error, localeRef.current), code: error.code } : { error: null };
      },
      updatePassword: async (password) => {
        const supabase = await loadSupabase();
        if (!supabase) return { error: tRef.current("auth.notConfigured") };
        const { error } = await supabase.auth.updateUser({ password });
        if (!error) setPasswordRecovery(false);
        return error ? { error: friendlyAuthError(error, localeRef.current), code: error.code } : { error: null };
      },
      signOut: async () => {
        const supabase = await loadSupabase();
        if (!supabase) return;
        expectSignOut();
        await supabase.auth.signOut();
        setSession(null);
        setCurrentAccessToken(null);
      },
      passwordRecovery,
      clearPasswordRecovery: () => setPasswordRecovery(false),
    }),
    [loading, passwordRecovery, session],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
