/**
 * Sign in or create an account, one field at a time in one centred
 * card: the address first (or Google), then the password; a forgotten
 * password sends a reset link to the address already typed. Every error
 * is a sentence under the field it concerns, never a toast. Once a
 * session exists the browser goes to `next` (the page that asked) or to
 * the app.
 */
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { ArrowRight, Check, CircleAlert, Eye, EyeOff, Mail } from "lucide-react";

import { BrandIcon } from "@/components/brand-mark";
import { PublicFrame } from "@/components/public-frame";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth/auth-context";
import { safeNext } from "@/lib/auth/safe-next";
import { isSupabaseConfigured } from "@/lib/auth/supabase-client";
import { useI18n } from "@/lib/i18n";

type Intent = "signIn" | "signUp";
type Step = "email" | "password" | "reset" | "sent";
type SentKind = "signUp" | "reset";

/** The same shape the database checks; refused here before any call. */
const EMAIL_SHAPE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const PASSWORD_MIN = 8;

export const Route = createFileRoute("/sign-in")({
  validateSearch: (search: Record<string, unknown>): { next?: string } =>
    typeof search["next"] === "string" ? { next: search["next"] } : {},
  head: () => ({ meta: [{ name: "robots", content: "noindex" }] }),
  component: SignInPage,
});

/** The Google "G" in one path, in the current colour: the ink on paper, paper on the ink. */
function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-4" fill="currentColor">
      <path d="M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48z" />
    </svg>
  );
}

/** A sentence under a field, announced when it appears: an alert icon and the words, in the ink. */
function FieldError({ id, text }: { id: string; text: string | null }) {
  if (!text) return null;
  return (
    <p id={id} role="alert" className="fade-in flex items-start gap-1.5 text-meta text-ink">
      <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      {text}
    </p>
  );
}

function SignInPage() {
  const { t } = useI18n();
  const {
    user,
    loading,
    signInWithPassword,
    signUpWithPassword,
    signInWithGoogle,
    sendPasswordReset,
  } = useAuth();
  const router = useRouter();
  const { next } = Route.useSearch();
  const emailErrorId = useId();
  const passwordErrorId = useId();
  const subtitleId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [intent, setIntent] = useState<Intent>("signIn");
  const [step, setStep] = useState<Step>("email");
  const [sentKind, setSentKind] = useState<SentKind>("signUp");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // `next` is a free path, so it goes through the history rather than a typed `to`.
  useEffect(() => {
    if (!loading && user) router.history.replace(safeNext(next));
  }, [loading, next, router, user]);

  // The email and password steps focus their field; the other two have none, so the heading takes
  // focus (the control that led there is gone) and is read with its sentence.
  useEffect(() => {
    if (step === "reset" || step === "sent") headingRef.current?.focus();
  }, [step]);

  function go(target: Step) {
    setError(null);
    setStep(target);
  }

  function switchIntent(target: Intent) {
    setIntent(target);
    setPassword("");
    go("email");
  }

  async function google() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await signInWithGoogle();
      if (result.error) setError(result.error);
    } finally {
      setBusy(false);
    }
  }

  function continueWithEmail(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (!EMAIL_SHAPE.test(email.trim())) {
      setError(t("auth.email.invalid"));
      return;
    }
    go("password");
  }

  async function submitPassword(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (password.length < PASSWORD_MIN) {
      setError(t("auth.password.short"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const address = email.trim();
      if (intent === "signUp") {
        const result = await signUpWithPassword(address, password);
        if (result.error) setError(result.error);
        else if (result.existingAccount) setError(t("auth.signUp.exists"));
        else if (!result.signedIn) {
          setSentKind("signUp");
          go("sent");
        }
        return;
      }
      const result = await signInWithPassword(address, password);
      if (result.error) setError(result.error);
    } finally {
      setBusy(false);
    }
  }

  async function sendReset(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await sendPasswordReset(email.trim());
      if (result.error) setError(result.error);
      else {
        setSentKind("reset");
        go("sent");
      }
    } finally {
      setBusy(false);
    }
  }

  const title =
    step === "sent"
      ? t("auth.checkInbox")
      : step === "reset"
        ? t("auth.reset.title")
        : step === "password"
          ? intent === "signUp"
            ? t("auth.step.password.signUp")
            : t("auth.step.password.signIn")
          : intent === "signUp"
            ? t("auth.signUp.title")
            : t("auth.title");
  // Only the steps that report something keep a sentence under the title: what was just sent.
  const subtitle =
    step === "sent" ? (sentKind === "reset" ? t("auth.reset.sent") : t("auth.signUp.sent")) : null;

  /** The address already typed, with the way back to change it. */
  const emailLine = (
    <div className="flex items-center gap-3 rounded-md border border-border bg-muted/40 py-2 pl-3 pr-2">
      <Mail className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate text-sm text-ink">{email.trim()}</span>
      <Button type="button" variant="ghost" size="sm" onClick={() => go("email")} disabled={busy}>
        {t("auth.changeEmail")}
      </Button>
    </div>
  );

  let body: ReactNode;
  if (!isSupabaseConfigured) {
    body = <p className="mt-8 text-sm text-muted-foreground">{t("auth.notConfigured")}</p>;
  } else if (step === "sent") {
    body = (
      <div className="mt-8">
        <Button
          type="button"
          variant="outline"
          className="w-full"
          onClick={() => switchIntent("signIn")}
        >
          {t("auth.reset.back")}
        </Button>
      </div>
    );
  } else if (step === "reset") {
    body = (
      <form onSubmit={sendReset} className="mt-8 space-y-5" noValidate>
        {emailLine}
        <FieldError id={emailErrorId} text={error} />
        <Button type="submit" className="w-full" disabled={busy}>
          {t("auth.reset.send")}
        </Button>
        <p className="text-center text-sm text-muted-foreground">
          <button
            type="button"
            className="cursor-pointer rounded-sm font-medium text-ink underline underline-offset-4 hover:decoration-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => go("password")}
            disabled={busy}
          >
            {t("auth.reset.back")}
          </button>
        </p>
      </form>
    );
  } else if (step === "password") {
    body = (
      <form onSubmit={submitPassword} className="mt-8 space-y-5" noValidate>
        {emailLine}
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="password">{t("auth.password")}</Label>
            {intent === "signIn" ? (
              <button
                type="button"
                className="cursor-pointer rounded-sm text-meta font-medium text-ink underline underline-offset-4 hover:decoration-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => go("reset")}
                disabled={busy}
              >
                {t("auth.forgot")}
              </button>
            ) : null}
          </div>
          <div className="relative">
            <Input
              id="password"
              type={showPassword ? "text" : "password"}
              autoComplete={intent === "signUp" ? "new-password" : "current-password"}
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (error) setError(null);
              }}
              minLength={PASSWORD_MIN}
              required
              autoFocus
              disabled={busy}
              className="pr-12"
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? passwordErrorId : undefined}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="absolute right-1 top-1 text-muted-foreground"
              onClick={() => setShowPassword((shown) => !shown)}
              aria-label={showPassword ? t("auth.password.hide") : t("auth.password.show")}
              aria-pressed={showPassword}
            >
              {showPassword ? <EyeOff /> : <Eye />}
            </Button>
          </div>
          <FieldError id={passwordErrorId} text={error} />
        </div>
        <Button type="submit" className="w-full" disabled={busy || !password}>
          {intent === "signUp" ? t("auth.signUp") : t("auth.signIn")}
        </Button>
        {intent === "signUp" ? (
          <p className="text-meta text-muted-foreground">{t("auth.terms")}</p>
        ) : null}
      </form>
    );
  } else {
    body = (
      <form onSubmit={continueWithEmail} className="mt-8 space-y-5" noValidate>
        <Button
          type="button"
          variant="outline"
          className="w-full"
          icon={<GoogleIcon />}
          onClick={() => void google()}
          disabled={busy}
        >
          {t("auth.continueWithGoogle")}
        </Button>
        <div className="flex items-center gap-3 text-meta text-muted-foreground">
          <span className="h-px flex-1 bg-border" />
          {t("auth.or")}
          <span className="h-px flex-1 bg-border" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="email">{t("auth.email")}</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              if (error) setError(null);
            }}
            required
            autoFocus
            disabled={busy}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? emailErrorId : undefined}
          />
          <FieldError id={emailErrorId} text={error} />
        </div>
        <Button
          type="submit"
          className="w-full"
          icon={<ArrowRight />}
          disabled={busy || !email.trim()}
        >
          {t("auth.continue")}
        </Button>
      </form>
    );
  }

  return (
    <PublicFrame width="sm" center>
      <div className="sheet rise-in p-6">
        <div className="flex size-12 items-center justify-center rounded-full bg-muted text-ink">
          {step === "sent" ? (
            <Check className="size-6" aria-hidden="true" />
          ) : (
            <BrandIcon className="size-7" />
          )}
        </div>
        <h1
          ref={headingRef}
          tabIndex={-1}
          aria-describedby={subtitle ? subtitleId : undefined}
          className="mt-5 font-display text-2xl text-ink outline-none"
        >
          {title}
        </h1>
        {subtitle ? (
          <p id={subtitleId} className="mt-2 text-body text-muted-foreground break-words">
            {subtitle}
          </p>
        ) : null}
        {body}
        {isSupabaseConfigured && (step === "email" || step === "password") ? (
          <p className="mt-6 text-center text-sm text-muted-foreground">
            {intent === "signIn" ? t("auth.noAccount") : t("auth.hasAccount")}{" "}
            <button
              type="button"
              className="cursor-pointer rounded-sm font-medium text-ink underline underline-offset-4 hover:decoration-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => switchIntent(intent === "signIn" ? "signUp" : "signIn")}
              disabled={busy}
            >
              {intent === "signIn" ? t("auth.signUp") : t("auth.signIn")}
            </button>
          </p>
        ) : null}
      </div>
    </PublicFrame>
  );
}
