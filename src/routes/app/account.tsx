/**
 * The person's account: display name, preferred language, password
 * (the new-password form leads after a reset link), sign out, and the
 * deletion of the account behind a confirmation.
 */
import { useEffect, useState, type FormEvent } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { KeyRound, LogOut } from "lucide-react";

import { ConfirmDialog } from "@/components/app-shell/confirm-dialog";
import { LocaleChips } from "@/components/app-shell/locale-chips";
import { PageHeader } from "@/components/app-shell/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth/auth-context";
import { requireSupabase } from "@/lib/auth/supabase-client";
import { useQuery } from "@/lib/data/use-query";
import type { Locale } from "@/lib/db/types";
import { useI18n } from "@/lib/i18n";
import { useOrg } from "@/lib/org/org-context";
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
  const navigate = useNavigate();
  const userId = user?.id ?? "";

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

  async function saveName(event: FormEvent) {
    event.preventDefault();
    if (savingName || !userId) return;
    setSavingName(true);
    try {
      const supabase = await requireSupabase();
      await updateProfile(supabase, userId, { display_name: displayName.trim() || null });
      toast.success(t("common.saved"));
      await Promise.all([profile.refresh(), refresh()]);
    } catch (error) {
      console.error(error);
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
    } catch (error) {
      console.error(error);
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
      } catch (error) {
        // The account is gone: a refused sign-out changes nothing.
        console.error(error);
      }
      void navigate({ to: "/" });
    } catch (error) {
      console.error(error);
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
      <PageHeader eyebrow={user?.email ?? ""} title={t("nav.account")} description={t("account.subtitle")} />

      <div className="space-y-8">
        {passwordRecovery ? passwordForm : null}

        <form onSubmit={saveName} className="sheet p-6 sm:p-8">
          <h2 className="font-display text-xl text-ink">{t("account.displayName")}</h2>
          <p className="mt-1 text-sm leading-5 text-muted-foreground">{t("account.displayName.help")}</p>
          <div className="mt-6 grid gap-6 sm:grid-cols-2">
            <div className="min-w-0 space-y-2">
              <Label htmlFor="account-email">{t("account.email")}</Label>
              <Input id="account-email" value={user?.email ?? ""} readOnly disabled />
            </div>
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
          </div>
          <div className="mt-8">
            <Button type="submit" disabled={savingName || profile.loading}>
              {t("common.save")}
            </Button>
          </div>
        </form>

        <section className="sheet p-6 sm:p-8">
          <h2 className="font-display text-xl text-ink">{t("account.locale")}</h2>
          <p className="mt-1 text-sm leading-5 text-muted-foreground">{t("account.locale.help")}</p>
          <div className="mt-6">
            <LocaleChips value={savedLocale} onChange={(next) => void chooseLocale(next)} disabled={savingLocale || profile.loading} />
          </div>
        </section>

        {!passwordRecovery ? passwordForm : null}

        <section className="sheet p-6 sm:p-8">
          <h2 className="font-display text-xl text-ink">{t("common.signOut")}</h2>
          <Button variant="outline" className="mt-6" onClick={() => void doSignOut()} disabled={signingOut}>
            <LogOut />
            {t("common.signOut")}
          </Button>
        </section>

        <section className="sheet border-negative/40 p-6 sm:p-8">
          <h2 className="font-display text-xl text-negative">{t("account.danger")}</h2>
          <p className="mt-1 max-w-2xl text-sm leading-5 text-muted-foreground">{t("account.danger.text")}</p>
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
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (password.length < PASSWORD_MIN) {
      toast.error(t("auth.password.help"));
      return;
    }
    if (password !== confirm) {
      toast.error(t("account.password.mismatch"));
      return;
    }
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
    <form onSubmit={submit} className={lead ? "sheet border-primary/40 p-6 sm:p-8" : "sheet p-6 sm:p-8"}>
      <h2 className="font-display text-xl text-ink">{lead ? t("auth.newPassword") : t("account.password.change")}</h2>
      {lead ? <p className="mt-1 text-sm leading-5 text-muted-foreground">{t("account.password.recovery")}</p> : null}
      <div className="mt-6 grid gap-6 sm:grid-cols-2">
        <div className="min-w-0 space-y-2">
          <Label htmlFor="new-password">{t("auth.newPassword")}</Label>
          <Input
            id="new-password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={PASSWORD_MIN}
            required
            disabled={busy}
          />
          <p className="text-[13px] leading-5 text-muted-foreground">{t("auth.password.help")}</p>
        </div>
        <div className="min-w-0 space-y-2">
          <Label htmlFor="confirm-password">{t("account.password.confirm")}</Label>
          <Input
            id="confirm-password"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            minLength={PASSWORD_MIN}
            required
            disabled={busy}
          />
        </div>
      </div>
      <div className="mt-8">
        <Button type="submit" variant={lead ? "default" : "outline"} disabled={busy || !password || !confirm}>
          <KeyRound />
          {lead ? t("common.save") : t("account.password.change")}
        </Button>
      </div>
    </form>
  );
}
