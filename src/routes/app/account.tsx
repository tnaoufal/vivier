/**
 * The person's account: the profile (display name next to the sign-in
 * address), the preferences (language, appearance), the password (the
 * new-password form leads after a reset link), the session, and the
 * deletion of the account behind a confirmation.
 */
import { useEffect, useState, type FormEvent } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { KeyRound, LogOut, Moon, Sun } from "lucide-react";

import { Avatar } from "@/components/app-shell/avatar";
import { ConfirmDialog } from "@/components/app-shell/confirm-dialog";
import { LocaleChips } from "@/components/app-shell/locale-chips";
import { PageHeader } from "@/components/app-shell/page-header";
import { useTheme } from "@/components/theme-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Segmented } from "@/components/ui/tabs";
import { useAuth } from "@/lib/auth/auth-context";
import { requireSupabase } from "@/lib/auth/supabase-client";
import { useQuery } from "@/lib/data/use-query";
import type { Locale } from "@/lib/db/types";
import { useI18n } from "@/lib/i18n";
import { memberName, useOrg } from "@/lib/org/org-context";
import { readProfile, updateProfile } from "@/lib/team/team";
import { toast } from "@/lib/toast";

export const Route = createFileRoute("/app/account")({
  component: AccountPage,
});

const PASSWORD_MIN = 8;

function AccountPage() {
  const { t, locale, setLocale } = useI18n();
  const { user, passwordRecovery, clearPasswordRecovery, updatePassword, signOut } = useAuth();
  const { refresh } = useOrg();
  const { theme, setTheme } = useTheme();
  const navigate = useNavigate();
  const userId = user?.id ?? "";
  const email = user?.email ?? "";

  const profile = useQuery(`profile:${userId}`, async () => readProfile(await requireSupabase(), userId), Boolean(userId));
  const [displayName, setDisplayName] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [savingLocale, setSavingLocale] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (profile.data) setDisplayName(profile.data.display_name ?? "");
  }, [profile.data]);

  const savedLocale: Locale = profile.data?.locale ?? locale;
  const shownName = memberName(profile.data ?? undefined, email.split("@")[0] ?? "");

  async function saveName(event: FormEvent) {
    event.preventDefault();
    if (savingName || !userId) return;
    setSavingName(true);
    try {
      const supabase = await requireSupabase();
      await updateProfile(supabase, userId, { display_name: displayName.trim() || null });
      toast.success(t("common.saved"));
      await Promise.all([profile.refresh(), refresh()]);
    } catch (caught) {
      console.error(caught);
      toast.error(t("common.error"));
    } finally {
      setSavingName(false);
    }
  }

  async function chooseLocale(next: Locale) {
    if (savingLocale || !userId || next === savedLocale) return;
    setSavingLocale(true);
    try {
      const supabase = await requireSupabase();
      await updateProfile(supabase, userId, { locale: next });
      setLocale(next);
      await profile.refresh();
    } catch (caught) {
      console.error(caught);
      toast.error(t("common.error"));
    } finally {
      setSavingLocale(false);
    }
  }

  async function doSignOut() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await signOut();
      void navigate({ to: "/" });
    } finally {
      setSigningOut(false);
    }
  }

  async function confirmDelete() {
    if (deleting) return;
    setDeleting(true);
    try {
      const supabase = await requireSupabase();
      const { error } = await supabase.rpc("delete_my_account");
      if (error) throw error;
      setDeleteOpen(false);
      toast.success(t("account.deleted"));
      try {
        await signOut();
      } catch (caught) {
        // The account is gone: a refused sign-out changes nothing.
        console.error(caught);
      }
      void navigate({ to: "/" });
    } catch (caught) {
      console.error(caught);
      toast.error(t("common.error"));
    } finally {
      setDeleting(false);
    }
  }

  const passwordForm = (
    <PasswordForm
      lead={passwordRecovery}
      onSubmit={async (password) => {
        const result = await updatePassword(password);
        if (result.error) {
          toast.error(result.error);
          return false;
        }
        toast.success(t("auth.newPassword.set"));
        clearPasswordRecovery();
        return true;
      }}
    />
  );

  return (
    <>
      <PageHeader eyebrow={email} title={t("nav.account")} description={t("account.subtitle")} />

      <div className="space-y-8">
        {passwordRecovery ? passwordForm : null}

        <form onSubmit={saveName} className="sheet p-6 sm:p-8" aria-labelledby="account-profile-title">
          <div className="flex items-center gap-4">
            <Avatar name={shownName} size="lg" />
            <div className="min-w-0">
              <h2 id="account-profile-title" className="font-display text-xl text-ink">
                {t("account.profile")}
              </h2>
              <p className="mt-0.5 text-sm text-muted-foreground">{t("account.displayName.help")}</p>
            </div>
          </div>
          <div className="mt-6 grid gap-6 sm:grid-cols-2">
            <div className="min-w-0 space-y-2">
              <Label htmlFor="account-name">{t("account.displayName")}</Label>
              <Input
                id="account-name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                maxLength={120}
                autoComplete="name"
                disabled={savingName || profile.loading}
              />
            </div>
            <div className="min-w-0 space-y-2">
              <Label htmlFor="account-email">{t("account.email")}</Label>
              <Input id="account-email" value={email} readOnly disabled />
            </div>
          </div>
          <div className="mt-8">
            <Button type="submit" variant={passwordRecovery ? "outline" : "primary"} disabled={savingName || profile.loading}>
              {t("common.save")}
            </Button>
          </div>
        </form>

        <section className="sheet p-6 sm:p-8" aria-labelledby="account-preferences-title">
          <h2 id="account-preferences-title" className="font-display text-xl text-ink">
            {t("account.preferences")}
          </h2>
          <div className="mt-6 grid gap-8 sm:grid-cols-2">
            <div className="min-w-0 space-y-2">
              <Label>{t("account.locale")}</Label>
              <LocaleChips value={savedLocale} onChange={(next) => void chooseLocale(next)} disabled={savingLocale || profile.loading} />
              <p className="text-meta text-muted-foreground">{t("account.locale.help")}</p>
            </div>
            <div className="min-w-0 space-y-2">
              <Label>{t("account.theme")}</Label>
              <Segmented
                value={theme}
                onChange={setTheme}
                aria-label={t("account.theme")}
                options={[
                  { value: "light", label: t("common.theme.light"), icon: <Sun /> },
                  { value: "dark", label: t("common.theme.dark"), icon: <Moon /> },
                ]}
              />
              <p className="text-meta text-muted-foreground">{t("account.theme.help")}</p>
            </div>
          </div>
        </section>

        {!passwordRecovery ? passwordForm : null}

        <section className="sheet p-6 sm:p-8" aria-labelledby="account-session-title">
          <h2 id="account-session-title" className="font-display text-xl text-ink">
            {t("account.session")}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground break-words">{t("account.session.help", { email })}</p>
          <Button variant="outline" className="mt-6" icon={<LogOut />} onClick={() => void doSignOut()} disabled={signingOut}>
            {t("common.signOut")}
          </Button>
        </section>

        <section className="sheet border-negative/40 p-6 sm:p-8" aria-labelledby="account-danger-title">
          <h2 id="account-danger-title" className="font-display text-xl text-negative">
            {t("account.danger")}
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{t("account.danger.text")}</p>
          <Button variant="destructive" className="mt-6" onClick={() => setDeleteOpen(true)} disabled={deleting}>
            {t("account.danger")}
          </Button>
        </section>
      </div>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t("account.delete.title")}
        text={t("account.delete.text")}
        confirmLabel={t("common.delete")}
        destructive
        busy={deleting}
        onConfirm={confirmDelete}
      />
    </>
  );
}

/** New password twice; `lead` marks the form that follows a reset link (then its button is the page's primary). */
function PasswordForm({ lead, onSubmit }: { lead: boolean; onSubmit: (password: string) => Promise<boolean> }) {
  const { t } = useI18n();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (password.length < PASSWORD_MIN) {
      setError(t("auth.password.help"));
      return;
    }
    if (password !== confirm) {
      setError(t("account.password.mismatch"));
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const done = await onSubmit(password);
      if (done) {
        setPassword("");
        setConfirm("");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className={lead ? "sheet border-primary/40 p-6 sm:p-8" : "sheet p-6 sm:p-8"} aria-labelledby="account-password-title">
      <h2 id="account-password-title" className="font-display text-xl text-ink">
        {lead ? t("auth.newPassword") : t("account.password.change")}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">{lead ? t("account.password.recovery") : t("auth.password.help")}</p>
      <div className="mt-6 grid gap-6 sm:grid-cols-2">
        <div className="min-w-0 space-y-2">
          <Label htmlFor="new-password">{t("auth.newPassword")}</Label>
          <Input
            id="new-password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              if (error) setError(null);
            }}
            minLength={PASSWORD_MIN}
            required
            disabled={busy}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "account-password-error" : undefined}
          />
        </div>
        <div className="min-w-0 space-y-2">
          <Label htmlFor="confirm-password">{t("account.password.confirm")}</Label>
          <Input
            id="confirm-password"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => {
              setConfirm(e.target.value);
              if (error) setError(null);
            }}
            minLength={PASSWORD_MIN}
            required
            disabled={busy}
            aria-invalid={error ? true : undefined}
          />
        </div>
      </div>
      {error ? (
        <p id="account-password-error" role="alert" className="fade-in mt-3 text-meta text-negative">
          {error}
        </p>
      ) : null}
      <div className="mt-8">
        <Button type="submit" variant={lead ? "primary" : "outline"} icon={<KeyRound />} disabled={busy || !password || !confirm}>
          {lead ? t("common.save") : t("account.password.change")}
        </Button>
      </div>
    </form>
  );
}
