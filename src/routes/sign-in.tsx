/**
 * Sign in or create an account (email + password, or Google), in one
 * centred card. Once a session exists the browser goes to `next` (the
 * page that asked) or to the app.
 */
import { useEffect, useState, type FormEvent } from "react";
import { Link, createFileRoute, useRouter } from "@tanstack/react-router";

import { BrandMark } from "@/components/brand-mark";
import { LocaleToggle, ThemeToggle } from "@/components/app-shell/toggles";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth/auth-context";
import { safeNext } from "@/lib/auth/safe-next";
import { isSupabaseConfigured } from "@/lib/auth/supabase-client";
import { useI18n } from "@/lib/i18n";
import { toast } from "@/lib/toast";

type Mode = "signIn" | "signUp" | "reset";

export const Route = createFileRoute("/sign-in")({
  validateSearch: (search: Record<string, unknown>): { next?: string } =>
    typeof search["next"] === "string" ? { next: search["next"] } : {},
  head: () => ({ meta: [{ name: "robots", content: "noindex" }] }),
  component: SignInPage,
});

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-4">
      <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.2 1.3-1.6 3.8-5.5 3.8-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.2.8 3.9 1.5l2.7-2.6C16.9 3 14.7 2 12 2 6.5 2 2 6.5 2 12s4.5 10 10 10c5.8 0 9.6-4.1 9.6-9.8 0-.7-.1-1.2-.2-1.7H12z" />
    </svg>
  );
}

function SignInPage() {
  const { t } = useI18n();
  const { user, loading, signInWithPassword, signUpWithPassword, signInWithGoogle, sendPasswordReset } = useAuth();
  const router = useRouter();
  const { next } = Route.useSearch();
  const [mode, setMode] = useState<Mode>("signIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  // `next` is a free path, so it goes through the history rather than a typed `to`.
  useEffect(() => {
    if (!loading && user) router.history.replace(safeNext(next));
  }, [loading, next, router, user]);

  async function google() {
    if (busy) return;
    setBusy(true);
    try {
      const result = await signInWithGoogle();
      if (result.error) toast.error(result.error);
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      if (mode === "reset") {
        const result = await sendPasswordReset(email.trim());
        if (result.error) toast.error(result.error);
        else toast.success(t("auth.reset.sent"));
        return;
      }
      if (mode === "signUp") {
        const result = await signUpWithPassword(email.trim(), password);
        if (result.error) toast.error(result.error);
        else if (result.existingAccount) toast.error(t("auth.signUp.exists"));
        else if (!result.signedIn) toast.success(t("auth.signUp.sent"));
        return;
      }
      const result = await signInWithPassword(email.trim(), password);
      if (result.error) toast.error(result.error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="flex items-center justify-between px-4 py-4 sm:px-8">
        <BrandMark size="sm" />
        <div className="flex items-center gap-1">
          <LocaleToggle />
          <ThemeToggle />
        </div>
      </header>
      <main className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="sheet w-full max-w-md p-8">
          <h1 className="font-display text-2xl text-ink">{t("auth.title")}</h1>
          <p className="mt-2 text-[15px] leading-6 text-muted-foreground">{t("auth.subtitle")}</p>
          {!isSupabaseConfigured ? (
            <p className="mt-8 text-sm leading-5 text-muted-foreground">{t("auth.notConfigured")}</p>
          ) : (
            <form onSubmit={submit} className="mt-8 space-y-6">
              {mode !== "reset" ? (
                <>
                  <Button type="button" variant="outline" className="w-full" onClick={() => void google()} disabled={busy}>
                    <GoogleIcon />
                    {t("auth.continueWithGoogle")}
                  </Button>
                  <div className="flex items-center gap-3 text-[13px] leading-5 text-muted-foreground">
                    <span className="h-px flex-1 bg-border" />
                    {t("auth.or")}
                    <span className="h-px flex-1 bg-border" />
                  </div>
                </>
              ) : null}
              <div className="space-y-2">
                <Label htmlFor="email">{t("auth.email")}</Label>
                <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </div>
              {mode !== "reset" ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <Label htmlFor="password">{t("auth.password")}</Label>
                    {mode === "signIn" ? (
                      <button type="button" className="cursor-pointer text-[13px] font-medium leading-5 text-primary hover:underline" onClick={() => setMode("reset")}>
                        {t("auth.forgot")}
                      </button>
                    ) : null}
                  </div>
                  <Input
                    id="password"
                    type="password"
                    autoComplete={mode === "signUp" ? "new-password" : "current-password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    minLength={8}
                    required
                  />
                  {mode === "signUp" ? <p className="text-[13px] leading-5 text-muted-foreground">{t("auth.password.help")}</p> : null}
                </div>
              ) : null}
              <Button type="submit" className="w-full" disabled={busy}>
                {mode === "signUp" ? t("auth.signUp") : mode === "reset" ? t("common.send") : t("auth.signIn")}
              </Button>
              {mode === "signUp" ? <p className="text-[13px] leading-5 text-muted-foreground">{t("auth.terms")}</p> : null}
              <p className="text-center text-sm text-muted-foreground">
                {mode === "signIn" ? (
                  <>
                    {t("auth.noAccount")}{" "}
                    <button type="button" className="cursor-pointer font-medium text-primary hover:underline" onClick={() => setMode("signUp")}>
                      {t("auth.signUp")}
                    </button>
                  </>
                ) : (
                  <>
                    {t("auth.hasAccount")}{" "}
                    <button type="button" className="cursor-pointer font-medium text-primary hover:underline" onClick={() => setMode("signIn")}>
                      {t("auth.signIn")}
                    </button>
                  </>
                )}
              </p>
            </form>
          )}
        </div>
      </main>
      <footer className="px-4 py-6 text-center text-[13px] leading-5 text-muted-foreground">
        <Link to="/privacy" className="hover:text-ink hover:underline">
          {t("nav.privacy")}
        </Link>
        {" · "}
        <Link to="/terms" className="hover:text-ink hover:underline">
          {t("nav.terms")}
        </Link>
      </footer>
    </div>
  );
}
